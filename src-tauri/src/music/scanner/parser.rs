//! 单文件解码子模块。把一个磁盘音频文件变成 `Song` 的完整流程在这里：
//!
//! 1. **文件系统层** —— 体积、创建/修改时间；
//! 2. **标签层** —— lofty 读取文本标签、时长、码率、采样率、位深、
//!    容器类型与内嵌歌手头像；
//! 3. **探测层** —— 标签层信息残缺（缺时长/采样率/位深）或容器是 mp4
//!    （要区分 AAC/ALAC）时，改用 symphonia 探测补齐；QMC 加密封装
//!    在探测前透明解密。
//!
//! 除此之外还提供：CUE 音轨的虚拟曲目合成、按路径清单批量解析、
//! 以及“同目录同专辑”分组下的专辑歌手/合辑/折叠语义裁决。

use crate::music::cue::CueTrack;
use super::super::tags::{
    extract_detail_metadata, find_embedded_artist_picture, read_tagged_file_from_path_for_scan,
};
use crate::music::types::Song;
use super::super::utils::{normalize_path, is_supported_library_extension};
use super::{ // 实现
    album_identity_key, display_artist_of, fold_tag_text_into_fields, key_component_normalized,
    reads_as_absent, split_into_artist_names, ALBUM_FALLBACK_TEXT, ARTIST_FALLBACK_TEXT,
    COMPILATION_ARTIST_CEILING, COMPILATION_ARTIST_NAME, ScanOptions,
};
use lofty::file::{FileType};
use lofty::prelude::*; // 实现
use std::collections::{HashSet, HashMap};
use std::fs::{self, File};
use std::path::{PathBuf, Path};
use std::time::{UNIX_EPOCH};
use symphonia::core::codecs::{CODEC_TYPE_NULL};
use symphonia::core::formats::{FormatOptions};
use symphonia::core::io::{MediaSource, MediaSourceStream};
use symphonia::core::meta::{MetadataOptions, Limit};
use symphonia::core::probe::{Hint};
use symphonia::core::units::{TimeBase};

// ---------- 解析草稿 ----------

/// 解析过程中逐步填充的可变草稿。初值为占位/零值，
/// 随后按 文件系统 → 标签 → 探测 的顺序吸收信息，最后一步定稿。
struct DecodedDraft {
    artist: String,
    album: String,
    title: String,
    album_artist: String,
    duration_secs: u32,
    kbps: u32,
    hz: u32,
    depth: Option<u8>,
    bytes_total: u64,
    created_at: Option<u64>,
    modified_at: Option<u64>,
    track_no: Option<String>,
    disc_no: Option<String>,
    note: Option<String>,
    wrapper: Option<String>,
    encoder: Option<String>,
    avatar_png: Option<Vec<u8>>,
}

impl DecodedDraft {
    /// 按扩展名推导容器名，其余字段全部取占位/零初值。
    fn blank_for(format_ext: &str) -> Self {
        Self {
            artist: ARTIST_FALLBACK_TEXT.to_string(),
            album: ALBUM_FALLBACK_TEXT.to_string(),
            title: String::new(),
            album_artist: String::new(),
            duration_secs: 0,
            kbps: 0,
            hz: 0,
            depth: None,
            bytes_total: 0,
            created_at: None,
            modified_at: None,
            track_no: None,
            disc_no: None,
            note: None,
            wrapper: Some(container_from_extension(format_ext)),
            encoder: None,
            avatar_png: None,
        }
    }

    /// 文件系统层：体积与创建/修改时间；读不到就维持初值。
    fn absorb_fs(&mut self, path: &Path) {
        let Ok(meta) = fs::metadata(path) else {
            return;
        };
        self.bytes_total = meta.len();
        self.created_at = meta.created().ok().and_then(to_epoch_seconds);
        self.modified_at = meta.modified().ok().and_then(to_epoch_seconds);
    }

    /// 标签层：lofty 属性 + 文本标签回填 + 明细字段 + 内嵌头像。
    fn absorb_tag_layer(&mut self, tagged: &lofty::file::TaggedFile) {
        let props = tagged.properties();
        self.duration_secs = props.duration().as_secs() as u32;
        self.kbps = props.audio_bitrate().unwrap_or(0);
        self.hz = props.sample_rate().unwrap_or(0);
        self.depth = props.bit_depth().map(|bits| bits as u8);
        self.wrapper = Some(container_of_file_type(tagged.file_type()).to_string());

        fold_tag_text_into_fields(
            tagged,
            &mut self.artist,
            &mut self.album,
            &mut self.title,
            &mut self.album_artist,
        );

        let details = extract_detail_metadata(tagged);
        self.track_no = details.track_number;
        self.disc_no = details.disc_number;
        self.note = details.comment;

        if let Some(picture) = find_embedded_artist_picture(tagged) {
            self.avatar_png = Some(picture.data().to_vec());
        }
    }

    /// 探测层：仅在标签层残缺或 mp4 容器（需辨认编码）时触发。
    fn absorb_probe(&mut self, path: &Path, format_ext: &str) {
        let wrapper_is_mp4 = self.wrapper.as_deref() == Some("mp4");
        let tag_layer_thin =
            self.duration_secs == 0 || self.hz == 0 || self.depth.is_none();
        if !(tag_layer_thin || wrapper_is_mp4) {
            return;
        }

        let probed = probe_identity(path, format_ext);

        if self.duration_secs == 0 {
            self.duration_secs = probed.seconds.unwrap_or(0);
        }
        if self.hz == 0 {
            self.hz = probed.hz.unwrap_or(0);
        }
        if self.depth.is_none() {
            self.depth = probed.depth;
        }
        let wrapper_blank = self
            .wrapper
            .as_deref()
            .map_or(true, |text| text.trim().is_empty());
        if wrapper_blank {
            self.wrapper = probed.wrapper;
        }
        // mp4 强制采用探测到的编码（区分 AAC/ALAC）；其余容器仅缺省时采纳。
        if wrapper_is_mp4 {
            if let Some(name) = probed.encoder {
                self.encoder = Some(name);
            }
        } else if self.encoder.is_none() {
            self.encoder = probed.encoder;
        }
    }

    /// 定稿：补码率估算、标题兜底、专辑歌手回退，装配 `Song`。
    fn finalize(self, path: &Path, path_str: &str, format_ext: &str) -> Option<Song> {
        let mut settled = self;
        if settled.kbps == 0 {
            settled.kbps = average_kbps_guess(settled.bytes_total, settled.duration_secs);
        }
        if settled.title.trim().is_empty() {
            // 标题缺失时用文件主名兜底；连主名都取不到就整体放弃。
            settled.title = path.file_stem()?.to_string_lossy().to_string();
        }
        if settled.album_artist.trim().is_empty() {
            settled.album_artist = settled.artist.clone();
        }

        let names = split_into_artist_names(&settled.artist);
        let grouping_key = album_identity_key(&settled.album, &settled.album_artist);
        let display_name = path.file_name()?.to_string_lossy().to_string();

        Some(Song {
            id: None,
            artist_avatar_bytes: settled.avatar_png,
            name: display_name,
            path: path_str.to_string(),
            title: settled.title,
            artist: settled.artist.clone(),
            artist_names: names.clone(),
            effective_artist_names: names,
            album: settled.album,
            album_artist: settled.album_artist,
            album_key: grouping_key,
            is_various_artists_album: false,
            collapse_artist_credits: false,
            duration: settled.duration_secs,
            cover_thumb_path: None,
            bitrate: settled.kbps,
            sample_rate: settled.hz,
            bit_depth: settled.depth,
            format: format_ext.to_string(),
            container: settled.wrapper,
            codec: settled.encoder,
            file_size: settled.bytes_total,
            track_number: settled.track_no,
            disc_number: settled.disc_no,
            added_at: settled.created_at.or(settled.modified_at),
            file_modified_at: settled.modified_at,
            cue_source_path: None,
            cue_start_offset: None,
            cue_end_offset: None,
            comment: settled.note,
            artist_avatar_path: None,
        })
    }
}

/// 系统时间 → Unix 秒；早于纪元的时刻返回 None。
fn to_epoch_seconds(stamp: std::time::SystemTime) -> Option<u64> {
    stamp
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|delta| delta.as_secs())
}

/// 按帧数与时间基准换算秒数，不足一秒的部分进位。
fn round_up_to_seconds(time_base: TimeBase, frame_count: u64) -> u32 {
    let span = time_base.calc_time(frame_count);
    let whole = span.seconds.saturating_add(u64::from(span.frac > 0.0));
    whole.min(u32::MAX as u64) as u32
}

/// 标签没给码率时，用体积与时长粗估平均码率（kbps）。
fn average_kbps_guess(bytes_total: u64, seconds: u32) -> u32 {
    if bytes_total == 0 || seconds == 0 {
        return 0;
    }
    let total_bits = (bytes_total as u128).saturating_mul(8);
    let guess = total_bits / (seconds as u128) / 1000;
    guess.min(u32::MAX as u128) as u32
}

// ---------- 线程池规划 ----------

/// 依据任务量决定解析线程数；单任务不值得开池。
pub(super) fn plan_parse_workers(task_total: usize) -> usize {
    if task_total <= 1 {
        return 1;
    }
    let cores = std::thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(4);
    worker_budget_for_cores(task_total, cores)
}

/// 已知核心数时的线程预算：8 核及以下留 1 核给系统，更多核留 2 核，
/// 且绝不超过任务数。
pub(super) fn worker_budget_for_cores(task_total: usize, cores: usize) -> usize {
    if task_total <= 1 {
        return 1;
    }
    let reserved = if cores > 8 { 2 } else { 1 };
    let usable = cores.saturating_sub(reserved).max(1);
    task_total.min(usable).max(1)
}

// ---------- 残缺判定 ----------

/// 文本元数据是否残缺（触发重解析的条件之一）。
pub(super) fn text_fields_missing(entry: &Song) -> bool {
    reads_as_absent(&entry.artist, ARTIST_FALLBACK_TEXT)
        || reads_as_absent(&entry.album, ALBUM_FALLBACK_TEXT)
        || entry.artist_names.is_empty()
        || entry.album_artist.trim().is_empty()
        || entry.album_key.trim().is_empty()
        || entry.title.trim().is_empty()
        || entry.duration == 0
}

/// 容器身份是否缺失（format 与 container 双双为空）。
pub(super) fn container_info_absent(entry: &Song) -> bool {
    let wrapper_blank = entry
        .container
        .as_deref()
        .map_or(true, |text| text.trim().is_empty());
    entry.format.trim().is_empty() && wrapper_blank
}

// ---------- 主入口 ----------

/// 把单个音频文件解析成 `Song`；拿不到文件名时返回 None。
///
/// `format` 为小写扩展名；`path_str` 为已归一化的入库路径。
pub(crate) fn parse_song_from_file(
    path: &Path,
    path_str: &str,
    format: &str,
) -> Option<Song> { // 实现
    let mut draft = DecodedDraft::blank_for(format);
    draft.absorb_fs(path);

    // 标签层读取失败不致命：占位初值会被探测层与兜底逻辑接管。
    if let Ok(tagged) = read_tagged_file_from_path_for_scan(path) {
        draft.absorb_tag_layer(&tagged);
    }

    draft.absorb_probe(path, format);
    draft.finalize(path, path_str, format)
}

/// 按路径清单批量解析：路径归一化去重、扩展名白名单、最短时长门槛。
pub(super) fn parse_given_paths(paths: Vec<String>, options: ScanOptions) -> Vec<Song> {
    let mut accepted: Vec<Song> = Vec::new();
    let mut already_seen: HashSet<String> = HashSet::new();

    for raw in paths {
        let normalized = normalize_path(&raw);
        if normalized.is_empty() || !already_seen.insert(normalized.clone()) {
            continue;
        }

        let file_path = PathBuf::from(&normalized);
        if !file_path.is_file() {
            continue;
        }

        let Some(ext) = file_path
            .extension() // 实现
            .and_then(|piece| piece.to_str())
            .map(|piece| piece.to_ascii_lowercase())
        else {
            continue;
        };
        if !is_supported_library_extension(&ext) {
            continue;
        }

        let Some(song) = parse_song_from_file(&file_path, &normalized, &ext) else {
            continue;
        };
        if options.min_duration_secs > 0 && song.duration < options.min_duration_secs {
            continue;
        }

        accepted.push(song);
    }

    accepted
}

// ---------- 容器与编码命名 ----------

/// lofty 识别的文件类型 → 统一容器名。
fn container_of_file_type(file_type: FileType) -> &'static str {
    match file_type { // 实现
        FileType::Aac => "aac", // 实现
        FileType::Aiff => "aiff", // 实现
        FileType::Ape => "ape", // 实现
        FileType::Flac => "flac", // 实现
        FileType::Mpeg => "mpeg", // 实现
        FileType::Mp4 => "mp4", // 实现
        FileType::Mpc => "mpc", // 实现
        FileType::Opus | FileType::Speex | FileType::Vorbis => "ogg", // 实现
        FileType::Wav => "wav", // 实现
        FileType::WavPack => "wavpack", // 实现
        FileType::Custom(name) => name, // 实现
        _ => "unknown", // 实现
    }
}

/// 扩展名 → 容器名（标签读取失败时的兜底推导）。
fn container_from_extension(ext: &str) -> String {
    let lowered = ext.to_ascii_lowercase();
    match lowered.as_str() {
        "aif" | "aiff" => "aiff".to_string(), // 实现
        "m4a" | "m4b" | "m4p" | "mp4" => "mp4".to_string(), // 实现
        "mp1" | "mp2" | "mp3" => "mpeg".to_string(), // 实现
        "oga" | "ogg" | "opus" | "spx" | "speex" | "vorbis" => "ogg".to_string(), // 实现
        "wav" | "wave" => "wav".to_string(), // 实现
        "wv" => "wavpack".to_string(), // 实现
        anything_else => anything_else.to_string(),
    }
}

/// symphonia 编码短名 → 统一编码名（PCM/ADPCM 家族归并）。
fn encoder_label(short_name: &str) -> String {
    let lowered = short_name.to_ascii_lowercase();
    if lowered.starts_with("pcm_") {
        "pcm".to_string() // 实现
    } else if lowered.starts_with("adpcm_") {
        "adpcm".to_string() // 实现
    } else {
        lowered
    }
}

// ---------- symphonia 探测 ----------

/// symphonia 探测得到的音频身份要素；每项都允许单独缺失。
#[derive(Default)]
struct ProbedIdentity {
    wrapper: Option<String>,
    encoder: Option<String>,
    seconds: Option<u32>,
    hz: Option<u32>,
    depth: Option<u8>,
}

impl ProbedIdentity {
    /// 探测中断时的兜底：只保留按扩展名推导的容器名。
    fn from_extension(ext: &str) -> Self {
        Self {
            wrapper: Some(container_from_extension(ext)),
            ..Self::default()
        }
    }
}

/// QMC 系列加密扩展名对应的真实音频格式。
fn qmc_wrapped_format(ext: &str) -> Option<&'static str> {
    let lowered = ext.to_ascii_lowercase();
    let inner = match lowered.as_str() {
        "qmcflac" | "mflac" | "mflac0" => "flac",
        "qmc0" | "qmc3" => "mp3",
        "qmc2" | "qmcogg" | "mgg" | "mgg0" | "mggl" => "ogg",
        _ => return None,
    };
    Some(inner)
}

/// 用 symphonia 探测音频身份；中途失败即返回扩展名兜底结果。
fn probe_identity(path: &Path, ext: &str) -> ProbedIdentity {
    let Ok(file) = File::open(path) else {
        return ProbedIdentity::from_extension(ext);
    };

    // QMC 加密封装：能识别加密方式就套一层解密读取器再交给探测器。
    let actual_ext = qmc_wrapped_format(ext).unwrap_or(ext);
    let media_source: Box<dyn MediaSource> = if qmc_wrapped_format(ext).is_some() {
        match crate::player::qmc2::detect_qmc_crypto(path) {
            Some(crypto) => Box::new(QmcMediaSourceAdapter {
                inner: crate::player::qmc2::QmcDecryptReader::new(file, crypto),
            }),
            None => Box::new(file),
        }
    } else {
        Box::new(file)
    };

    let stream = MediaSourceStream::new(media_source, Default::default());
    let mut hint = Hint::new(); // 实现
    hint.with_extension(actual_ext);

    let probed = match symphonia::default::get_probe().format( // 实现
        &hint,
        stream,
        &FormatOptions::default(), // 实现
        &MetadataOptions { // 实现
            limit_visual_bytes: Limit::Maximum(0), // 实现
            ..Default::default() // 实现
        },
    ) {
        Ok(found) => found,
        Err(_) => return ProbedIdentity::from_extension(ext),
    };

    let Some(first_track) = probed
        .format
        .tracks()
        .iter()
        .find(|candidate| candidate.codec_params.codec != CODEC_TYPE_NULL)
    else {
        return ProbedIdentity::from_extension(ext);
    };

    let seconds = match (
        first_track.codec_params.time_base,
        first_track.codec_params.n_frames,
    ) {
        (Some(time_base), Some(frames)) if frames > 0 => { // 实现
            Some(round_up_to_seconds(time_base, frames))
        }
        _ => None,
    };
    let depth = first_track
        .codec_params // 实现
        .bits_per_sample // 实现
        .or(first_track.codec_params.bits_per_coded_sample)
        .and_then(|bits| u8::try_from(bits).ok());
    let encoder = symphonia::default::get_codecs()
        .get_codec(first_track.codec_params.codec)
        .map(|descriptor| encoder_label(descriptor.short_name));

    ProbedIdentity {
        wrapper: Some(container_from_extension(ext)),
        encoder,
        seconds,
        hz: first_track.codec_params.sample_rate,
        depth,
    }
}

/// 把 QMC 解密读取器适配成 symphonia 的 `MediaSource`。
struct QmcMediaSourceAdapter {
    inner: crate::player::qmc2::QmcDecryptReader<File>,
}

impl std::io::Read for QmcMediaSourceAdapter {
    fn read(&mut self, sink: &mut [u8]) -> std::io::Result<usize> {
        self.inner.read(sink)
    }
}

impl std::io::Seek for QmcMediaSourceAdapter {
    fn seek(&mut self, position: std::io::SeekFrom) -> std::io::Result<u64> {
        self.inner.seek(position)
    }
}

impl MediaSource for QmcMediaSourceAdapter {
    fn is_seekable(&self) -> bool {
        true
    }
    fn byte_len(&self) -> Option<u64> {
        None
    }
}

// ---------- 专辑分组语义 ----------

/// 对“同目录同专辑”的一组曲目裁决专辑歌手、合辑与折叠标记。
///
/// 裁决顺序：
/// - 有标签专辑歌手（且与该曲自身歌手不同）时以其为准；仅当标签之间
///   冲突且主歌手也冲突才判合辑；
/// - 否则看主歌手分布：唯一则直接采用；分散时按出现票数选主导者
///   （票数并列取名字倒序更大者），全员互异或超阈值判合辑；
/// - 超阈值同时折叠展示歌手列表。
fn resolve_album_group(group: &[Song]) -> (String, bool, bool) {
    let tagged_album_artists: Vec<String> = group
        .iter()
        .filter_map(|entry| {
            let candidate = entry.album_artist.trim();
            (!candidate.is_empty() && !candidate.eq_ignore_ascii_case(&entry.artist))
                .then(|| candidate.to_string())
        })
        .collect();

    let lead_names: Vec<String> = group.iter().map(display_artist_of).collect();
    let distinct_leads: HashSet<String> =
        lead_names.iter().map(|name| name.to_lowercase()).collect();

    if let Some(first_tagged) = tagged_album_artists.first() {
        let tagged_variants: HashSet<String> = tagged_album_artists
            .iter()
            .map(|name| name.to_lowercase()) // 实现
            .collect();
        let conflicting =
            tagged_variants.len() > 1 && distinct_leads.len() > 1;
        let fold_leads = distinct_leads.len() > COMPILATION_ARTIST_CEILING;
        let album_artist = if conflicting {
            COMPILATION_ARTIST_NAME.to_string()
        } else {
            first_tagged.clone()
        };
        return (album_artist, conflicting, fold_leads);
    }

    // 主歌手唯一：直接采用。
    if distinct_leads.len() <= 1 {
        let sole = lead_names
            .first()
            .cloned()
            .unwrap_or_else(|| ARTIST_FALLBACK_TEXT.to_string());
        return (sole, false, false);
    }

    // 主歌手分散：数票选主导者，并列时取名字倒序更大者（历史约定）。
    let mut votes: HashMap<String, usize> = HashMap::new();
    for name in &lead_names {
        *votes.entry(name.clone()).or_insert(0) += 1;
    }
    let dominant = votes
        .into_iter() // 实现
        .max_by(|(left_name, left_votes), (right_name, right_votes)| {
            left_votes
                .cmp(right_votes)
                .then_with(|| right_name.cmp(left_name)) // 实现
        })
        .map(|(name, _)| name) // 实现
        .unwrap_or_else(|| ARTIST_FALLBACK_TEXT.to_string());

    let everyone_distinct = distinct_leads.len() == group.len();
    let fold_leads = distinct_leads.len() > COMPILATION_ARTIST_CEILING;
    let is_compilation = fold_leads || everyone_distinct;

    (
        if is_compilation {
            COMPILATION_ARTIST_NAME.to_string()
        } else {
            dominant
        },
        is_compilation,
        fold_leads,
    )
}

/// 对解析结果按「父目录 + 专辑」分堆并落地专辑语义。
///
/// 分堆键为 `父目录::小写专辑名`；堆内统一写入专辑歌手、专辑键、
/// 合辑与折叠标记，折叠时展示歌手列表替换为合辑标签。
pub(super) fn apply_album_grouping(songs: &mut [Song]) {
    let mut buckets: HashMap<String, Vec<usize>> = HashMap::new();
    for (slot, entry) in songs.iter().enumerate() {
        let parent_dir = Path::new(&entry.path)
            .parent()
            .map(|piece| piece.to_string_lossy().to_string())
            .unwrap_or_default();
        let bucket_key = format!(
            "{}::{}",
            parent_dir,
            key_component_normalized(&entry.album, ALBUM_FALLBACK_TEXT)
        );
        buckets.entry(bucket_key).or_default().push(slot);
    }

    for members in buckets.into_values() {
        let group_view: Vec<Song> = members.iter().map(|slot| songs[*slot].clone()).collect();
        let (album_artist, is_compilation, fold_leads) = resolve_album_group(&group_view);

        for slot in members {
            let entry = &mut songs[slot];
            entry.album_artist = album_artist.clone();
            entry.album_key = album_identity_key(&entry.album, &entry.album_artist);
            entry.is_various_artists_album = is_compilation;
            entry.collapse_artist_credits = fold_leads;
            entry.effective_artist_names = if fold_leads {
                vec![COMPILATION_ARTIST_NAME.to_string()]
            } else {
                entry.artist_names.clone()
            };
        }
    }
}

// ---------- CUE 合成 ----------

/// 由 CUE 音轨装配虚拟曲目（合成路径形如 `<cue>::trackNN`）。
pub(super) fn assemble_cue_track_song(
    cue_path: &str, // 实现
    audio_path: &str,
    track: &CueTrack, // 实现
    sheet_album: Option<&str>,
    sheet_performer: Option<&str>,
    audio_duration_ms: u32,
) -> Option<Song> { // 实现
    let title = match &track.title {
        Some(text) => text.clone(),
        None => format!("Track {:02}", track.track_number),
    };
    let performer = track // 实现
        .performer
        .clone()
        .unwrap_or_else(|| ARTIST_FALLBACK_TEXT.to_string());
    let album = sheet_album.unwrap_or(ALBUM_FALLBACK_TEXT).to_string();
    let album_artist = sheet_performer.unwrap_or(&performer).to_string();
    let names = split_into_artist_names(&performer);
    let virtual_path = format!("{}::track{:02}", cue_path, track.track_number);

    // 音轨时长 = 段末（缺省取整轨末尾）减去 INDEX 01 起点，毫秒折算秒。
    let tail_ms = track.end_ms.unwrap_or(audio_duration_ms as u64);
    let track_secs = if tail_ms > track.index01_start_ms {
        ((tail_ms - track.index01_start_ms) / 1000) as u32
    } else {
        0
    };

    let audio_file = PathBuf::from(audio_path);
    let (thumb, kbps, hz, depth, encoder) = read_flac_playback_properties(&audio_file);
    let display_name = format!("{:02}. {}", track.track_number, title);

    Some(Song {
        id: None,
        artist_avatar_bytes: None, // 实现
        name: display_name,
        path: virtual_path,
        title,
        artist: performer.clone(), // 实现
        artist_names: names.clone(),
        effective_artist_names: names,
        album,
        album_artist, // 实现
        album_key: album_identity_key(
            sheet_album.unwrap_or(ALBUM_FALLBACK_TEXT),
            sheet_performer.unwrap_or(&performer),
        ),
        is_various_artists_album: false, // 实现
        collapse_artist_credits: false, // 实现
        duration: track_secs,
        cover_thumb_path: thumb,
        bitrate: kbps,
        sample_rate: hz,
        bit_depth: depth,
        format: "flac".to_string(), // 实现
        container: Some("flac".to_string()), // 实现
        codec: encoder,
        file_size: std::fs::metadata(&audio_file)
            .map(|meta| meta.len())
            .unwrap_or(0), // 实现
        track_number: Some(track.track_number.to_string()), // 实现
        disc_number: None, // 实现
        added_at: None, // 实现
        file_modified_at: None, // 实现
        cue_source_path: Some(audio_path.to_string()),
        cue_start_offset: Some(track.index01_start_ms as u32), // 实现
        cue_end_offset: Some(tail_ms as u32),
        comment: None, // 实现
        artist_avatar_path: None, // 实现
    })
}

/// 读取 CUE 引用的整轨音频播放属性（码率/采样率/位深）；
/// 封面与编码名暂不提供。
fn read_flac_playback_properties(
    audio: &Path,
) -> (Option<String>, u32, u32, Option<u8>, Option<String>) { // 实现
    let tagged = read_tagged_file_from_path_for_scan(audio).ok();
    let props = tagged.as_ref().map(|file| file.properties());
    (
        None,
        props.and_then(|p| p.audio_bitrate()).unwrap_or(0),
        props.and_then(|p| p.sample_rate()).unwrap_or(0),
        props.and_then(|p| p.bit_depth()).map(|bits| bits as u8),
        None,
    )
}
