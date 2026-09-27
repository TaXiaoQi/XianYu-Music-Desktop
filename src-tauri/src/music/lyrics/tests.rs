// 行为回归测试：输入与断言与重构前保持一致，仅随模块拆分调整引用路径。

use super::format::{dissect_source, A2_TAIL_WORD_SPAN_MS};
use super::model::ParsedLineSourceFormat;
use super::script::romanized_likeness;
use super::semantic::build_structured_lyrics_payload;

#[test]
fn plugin_lrc_with_inline_angle_words_produces_display_words() {
    // am 等插件把逐字统一转成 lrc 返回：词级尖括号时间戳内嵌在 lyric 文本里
    let payload = build_structured_lyrics_payload(
        ["[00:23.59]<00:23.75>塞<00:23.80>纳<00:24.61>啡", "[00:30.00]第二句"].join("\n"),
    );

    let first = payload.display_lines.first().expect("应有解析行");
    let words = first.words.as_deref().unwrap_or_default();
    assert!(
        words.len() >= 3,
        "内嵌词级尖括号的行应产出逐字 words，实际 words={words:?} line={first:?}"
    );
}

#[test]
fn credit_variant_lines_at_head_are_not_duet() {
    let payload = build_structured_lyrics_payload(
        [
            "[00:01.000]词/曲：某某某",
            "[00:02.000]主唱：某某某",
            "[00:03.000]第一句歌词",
            "[00:04.000]第二句歌词",
        ]
        .join("\n"),
    );

    assert!(
        payload.display_lines.iter().all(|line| !line.is_duet),
        "开头 credit 变体不应被标注为对唱行: {:?}",
        payload
            .display_lines
            .iter()
            .filter(|l| l.is_duet)
            .map(|l| &l.text)
            .collect::<Vec<_>>()
    );
}

#[test]
fn real_duet_speaker_prefixes_are_still_annotated() {
    let payload = build_structured_lyrics_payload(
        [
            "[00:01.000]A:第一句",
            "[00:02.000]B:第二句",
            "[00:03.000]A:第三句",
            "[00:04.000]B:第四句",
        ]
        .join("\n"),
    );

    assert!(
        payload.display_lines.iter().any(|line| line.is_duet),
        "真对唱歌词应有对唱行标注"
    );
}

#[test]
fn by_variant_credits_at_head_are_not_duet() {
    let payload = build_structured_lyrics_payload(
        [
            "[00:01.000]Lyrics by: 某某某",
            "[00:02.000]Music by: 某某某",
            "[00:03.000]第一句歌词",
            "[00:04.000]第二句歌词",
        ]
        .join("\n"),
    );

    assert!(
        payload.display_lines.iter().all(|line| !line.is_duet),
        "开头 by 类 credit 不应被标注为对唱行: {:?}",
        payload
            .display_lines
            .iter()
            .filter(|l| l.is_duet)
            .map(|l| &l.text)
            .collect::<Vec<_>>()
    );
}

#[test]
fn head_only_prefix_block_is_not_duet() {
    let payload = build_structured_lyrics_payload(
        [
            "[00:01.000]A: 某某某",
            "[00:02.000]B: 某某某",
            "[00:03.000]第一句歌词",
            "[00:04.000]第二句歌词",
        ]
        .join("\n"),
    );

    assert!(
        payload.display_lines.iter().all(|line| !line.is_duet),
        "仅出现在开头的前缀块不应被标注为对唱行: {:?}",
        payload
            .display_lines
            .iter()
            .filter(|l| l.is_duet)
            .map(|l| &l.text)
            .collect::<Vec<_>>()
    );
}

#[test]
fn instrument_credits_at_head_are_excluded_from_duet() {
    let payload = build_structured_lyrics_payload(
        [
            "[00:01.000]吉他：某某某",
            "[00:02.000]贝斯：某某某",
            "[00:03.000]A:第一句",
            "[00:04.000]第二句",
            "[00:05.000]B:第三句",
        ]
        .join("\n"),
    );

    let credit_lines = ["吉他：某某某", "贝斯：某某某"];
    for line in &payload.display_lines {
        if credit_lines.contains(&line.text.as_str()) {
            assert!(!line.is_duet, "乐器 credit 行不应被标注为对唱行: {line:?}");
        }
    }
    assert!(
        payload
            .display_lines
            .iter()
            .any(|l| l.is_duet && l.text == "第一句"),
        "真对唱行仍应标注 is_duet: {:?}",
        payload.display_lines
    );
}

#[test]
fn parses_inline_timestamp_lrc_into_word_timed_lines() {
    let parsed = dissect_source(
        "[00:00.000]如[00:00.375]果[00:00.750]当[00:01.125]时[00:01.500] [00:01.875]-[00:02.250] [00:02.625]许[00:03.000]嵩[00:03.375]",
    );

    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].text, "如果当时 - 许嵩");
}

#[test]
fn kg_enhanced_lrc_keeps_words_through_display_payload() {
    // LX 直连 kg 链路最终产物：convertLxLyricToEnhancedLrc 输出的 A2 格式
    let payload = build_structured_lyrics_payload(
        "[00:18.000]<00:18.000>那阵子<00:18.500>我们的感情<00:20.000>出了一些问题<00:25.000>\n"
            .to_string(),
    );

    assert_eq!(payload.display_lines.len(), 1);
    let words = payload.display_lines[0]
        .words
        .as_ref()
        .unwrap_or_else(|| panic!("词级时间戳应保留到 display_lines.words"));
    assert_eq!(words.len(), 3);
    assert_eq!(words[0].text, "那阵子");
    assert!((words[0].start - 18.0).abs() < 0.01);
    assert!((words[1].end - 20.0).abs() < 0.01);
}

#[test]
fn hard_role_rules_keep_single_line_as_main() {
    let payload = build_structured_lyrics_payload("[00:01.000]Hello darling".to_string());

    assert_eq!(payload.display_lines.len(), 1);
    assert_eq!(payload.display_lines[0].text, "Hello darling");
    assert_eq!(payload.display_lines[0].translation, "");
    assert_eq!(payload.display_lines[0].romaji, "");
}

#[test]
fn hard_role_rules_treat_han_only_line_as_translation_for_two_lines() {
    let payload = build_structured_lyrics_payload(
        ["[00:01.000]你知道你爱我", "[00:01.000]You know you love me"].join("\n"),
    );

    assert_eq!(payload.display_lines.len(), 1);
    assert_eq!(payload.display_lines[0].text, "You know you love me");
    assert_eq!(payload.display_lines[0].translation, "你知道你爱我");
    assert_eq!(payload.display_lines[0].romaji, "");
}

#[test]
fn hard_role_rules_treat_mixed_han_latin_as_translation_for_two_lines() {
    let payload = build_structured_lyrics_payload(
        ["[00:01.000]你好 darling", "[00:01.000]hello darling"].join("\n"),
    );

    assert_eq!(payload.display_lines.len(), 1);
    assert_eq!(payload.display_lines[0].text, "hello darling");
    assert_eq!(payload.display_lines[0].translation, "你好 darling");
    assert_eq!(payload.display_lines[0].romaji, "");
}

#[test]
fn hard_role_rules_fall_back_to_first_main_second_translation_for_two_lines() {
    let payload = build_structured_lyrics_payload(
        [
            "[00:01.000]first latin line",
            "[00:01.000]second latin line",
        ]
        .join("\n"),
    );

    assert_eq!(payload.display_lines.len(), 1);
    assert_eq!(payload.display_lines[0].text, "first latin line");
    assert_eq!(payload.display_lines[0].translation, "second latin line");
    assert_eq!(payload.display_lines[0].romaji, "");
}

#[test]
fn hard_role_rules_use_fixed_roman_main_translation_order_for_three_lines() {
    let payload = build_structured_lyrics_payload(
        [
            "[00:01.000]wa su re ta ku na i ko to",
            "[00:01.000]忘れたくないこと",
            "[00:01.000]我不愿遗忘",
        ]
        .join("\n"),
    );

    assert_eq!(payload.display_lines.len(), 1);
    assert_eq!(payload.display_lines[0].text, "忘れたくないこと");
    assert_eq!(payload.display_lines[0].translation, "我不愿遗忘");
    assert_eq!(payload.display_lines[0].romaji, "wa su re ta ku na i ko to");
}

#[test]
fn keeps_japanese_main_when_romaji_comes_first() {
    let payload = build_structured_lyrics_payload(
        [
            "[01:01.072]<01:01.072>wa <01:01.336>su <01:01.633>re <01:01.863>ta <01:02.103>ku <01:02.352>na <01:02.577>i <01:02.823>ko <01:03.159>to <01:03.553>",
            "[01:01.072]<01:01.072>忘<01:01.633>れ<01:01.863>た<01:02.103>く<01:02.352>な<01:02.577>い<01:02.823>こ<01:03.159>と<01:03.553>",
            "[01:01.072]<01:01.072>我不愿遗忘<01:03.790>",
        ]
        .join("\n"),
    );

    assert_eq!(payload.display_lines.len(), 1);
    assert_eq!(payload.display_lines[0].text, "忘れたくないこと");
    assert_eq!(payload.display_lines[0].translation, "我不愿遗忘");
    assert_eq!(payload.display_lines[0].romaji, "wa su re ta ku na i ko to");
}

#[test]
fn prefers_lx_converted_enhanced_lrc_as_word_timed_source() {
    let parsed = dissect_source(
        [
            "[00:10.000]<00:10.000>其<00:10.300>实<00:10.600>",
            "[00:12.000]<00:12.000>天<00:12.400>外<00:12.800>",
        ]
        .join("\n")
        .as_str(),
    );

    assert_eq!(parsed.len(), 2);
    assert_eq!(parsed[0].source_format, ParsedLineSourceFormat::EnhancedLrc);
    assert_eq!(parsed[0].text, "其实");
    assert_eq!(
        parsed[0]
            .words
            .as_ref()
            .map(|words| words
                .iter()
                .map(|word| word.text.as_str())
                .collect::<Vec<_>>())
            .unwrap_or_default(),
        vec!["其", "实"]
    );
}

#[test]
fn structured_payload_keeps_words_for_lx_converted_enhanced_lrc() {
    let payload = build_structured_lyrics_payload(
        [
            "[00:10.000]<00:10.000>其<00:10.300>实<00:10.600>",
            "[00:12.000]<00:12.000>天<00:12.400>外<00:12.800>",
        ]
        .join("\n"),
    );

    assert_eq!(payload.display_lines.len(), 2);
    assert_eq!(payload.display_lines[0].text, "其实");
    assert_eq!(
        payload.display_lines[0]
            .words
            .as_ref()
            .map(|words| words
                .iter()
                .map(|word| word.text.as_str())
                .collect::<Vec<_>>())
            .unwrap_or_default(),
        vec!["其", "实"]
    );
}

#[test]
fn parses_joox_trailing_text_after_last_timestamp() {
    let parsed = dissect_source(
        [
            "[00:00.728]<00:01.456>租<00:03.450>購<00:03.980> - <00:04.510>薛<00:06.148>之<00:07.597>謙<00:08.292>",
            "[00:07.564]<00:15.128>詞",
        ]
        .join("\n")
        .as_str(),
    );

    assert_eq!(parsed.len(), 2);
    assert_eq!(parsed[0].text, "租購 - 薛之謙");
    assert_eq!(parsed[1].text, "詞");
    assert_eq!(parsed[1].source_format, ParsedLineSourceFormat::EnhancedLrc);
    let words = parsed[1].words.as_ref().unwrap();
    assert_eq!(words.len(), 1);
    assert_eq!(words[0].text, "詞");
    assert_eq!(words[0].start_ms, 15128);
    assert_eq!(words[0].end_ms, 15128 + A2_TAIL_WORD_SPAN_MS);
}

#[test]
fn parses_yrc_fixture_into_word_timed_lines() {
    let parsed = dissect_source(include_str!("../fixtures/lyrics/if_back_then.yrc"));

    assert_eq!(parsed.len(), 2);
    assert_eq!(parsed[0].source_format, ParsedLineSourceFormat::Yrc);
    assert_eq!(parsed[0].text, "如果当时 - 许嵩");
    assert_eq!(
        parsed[0]
            .words
            .as_ref()
            .map(|words| words
                .iter()
                .map(|word| word.text.as_str())
                .collect::<Vec<_>>())
            .unwrap_or_default(),
        vec!["如", "果", "当", "时", " ", "-", " ", "许", "嵩"]
    );
    assert_eq!(parsed[1].text, "词：许嵩");
}

#[test]
fn parses_qrc_fixture_into_word_timed_lines() {
    let parsed = dissect_source(include_str!("../fixtures/lyrics/baby.qrc"));

    assert_eq!(parsed.len(), 2);
    assert_eq!(parsed[0].source_format, ParsedLineSourceFormat::Qrc);
    assert_eq!(parsed[0].text, "You know you love me I know you care");
    assert_eq!(
        parsed[0]
            .words
            .as_ref()
            .map(|words| words
                .iter()
                .map(|word| word.text.as_str())
                .collect::<Vec<_>>())
            .unwrap_or_default(),
        vec!["You ", "know ", "you ", "love ", "me", " I ", "know ", "you ", "care",]
    );
    assert_eq!(parsed[1].text, "你知道你爱我 我知道你在意");
}

#[test]
fn parses_qq_real_qrc_fixture() {
    // Baka QQ 插件解密产物（天外来物真实 QRC XML）：桌面 amll parse_qrc
    // 对 QQ 实际 XML 结构的兼容性回归（移动端同源 fixture）
    let parsed = dissect_source(include_str!("../fixtures/lyrics/qq_real.qrc"));

    assert!(
        !parsed.is_empty(),
        "QQ 真实 QRC XML 应解析出歌词行，实际 0 行"
    );
    assert_eq!(parsed[0].source_format, ParsedLineSourceFormat::Qrc);
    assert!(
        parsed.iter().all(|line| !line.text.trim().is_empty()),
        "解析行不应有空文本"
    );
}

#[test]
fn parses_qq_qrc_mixed_with_translation_lrc() {
    // 宿主取词链把解密 QRC XML 与插件译文 LRC 拼成一份 lyricsRaw
    // （同移动端组合方式）：应走 Qrc 逐字解析而不是降级 Lrc 行级
    let raw = format!(
        "{}\n[00:21.50]这是译文第一行\n[00:45.00]这是译文第二行",
        include_str!("../fixtures/lyrics/qq_real.qrc")
    );
    let parsed = dissect_source(&raw);

    assert!(
        !parsed.is_empty(),
        "QRC XML + 译文 LRC 混合文本应解析出歌词行，实际 0 行"
    );
    assert_eq!(
        parsed[0].source_format,
        ParsedLineSourceFormat::Qrc,
        "混合文本应走 Qrc 逐字分支，实际走了 {:?}",
        parsed[0].source_format
    );
    assert!(
        parsed[0]
            .words
            .as_ref()
            .map(|w| !w.is_empty())
            .unwrap_or(false),
        "Qrc 行应保留逐字 words"
    );
    // 译文 LRC 行应按时间戳关联到对应行的 translated_text，而不是丢失/混入正文
    let with_translation = parsed
        .iter()
        .find(|line| {
            line.translated_text
                .as_deref()
                .map(|t| !t.trim().is_empty())
                .unwrap_or(false)
        });
    assert!(
        with_translation.is_some(),
        "译文 LRC 应关联出 translated_text，实际全部为空；行数={}，前3行文本={:?}",
        parsed.len(),
        parsed.iter().take(3).map(|l| l.text.as_str()).collect::<Vec<_>>()
    );
}

#[test]
fn parses_lys_fixture_into_word_timed_lines() {
    let parsed = dissect_source(include_str!("../fixtures/lyrics/from_that_day.lys"));

    assert_eq!(parsed.len(), 2);
    assert_eq!(parsed[0].source_format, ParsedLineSourceFormat::Lys);
    assert_eq!(parsed[0].text, "その日から何もかも");
    assert_eq!(
        parsed[0]
            .words
            .as_ref()
            .map(|words| words
                .iter()
                .map(|word| word.text.as_str())
                .collect::<Vec<_>>())
            .unwrap_or_default(),
        vec!["そ", "の日から", "何もかも"]
    );
    assert_eq!(parsed[1].text, "忘れたくないこと");
}

#[test]
fn romaji_scoring_prefers_vowel_ending_token_sequences() {
    let spaced_romaji = "ha ji me te no ru bu ru wa";
    let compressed_latin = "hajimetenoruburuwa";

    assert!(
        romanized_likeness(spaced_romaji) > romanized_likeness(compressed_latin)
    );
}

#[test]
fn romaji_scoring_supports_n_and_ng_endings() {
    let n_ending_romaji = "shi n ji te i ru n da";
    let ng_ending_pinyin = "xiang xin ni reng zai zhe li";

    assert!(romanized_likeness(n_ending_romaji) > 0.45);
    assert!(romanized_likeness(ng_ending_pinyin) > 0.35);
}

#[test]
fn romaji_scoring_keeps_english_phrases_below_romaji_lines() {
    let english_phrase = "Can you give me one last kiss";
    let romaji_line = "mo u to kku ni de a't te ta ka ra";

    assert!(romanized_likeness(english_phrase) < 0.35);
    assert!(romanized_likeness(romaji_line) > romanized_likeness(english_phrase));
}

#[test]
fn hard_role_rules_deduplicate_identical_main_and_translation() {
    let payload = build_structured_lyrics_payload(
        ["[00:01.000]相同歌词", "[00:01.000]相同歌词"].join("\n"),
    );

    assert_eq!(payload.display_lines.len(), 1);
    assert_eq!(payload.display_lines[0].text, "相同歌词");
    assert_eq!(payload.display_lines[0].translation, "");
    assert_eq!(payload.display_lines[0].romaji, "");
}

#[test]
fn hard_role_rules_keep_different_main_and_translation() {
    let payload =
        build_structured_lyrics_payload(["[00:01.000]Hello", "[00:01.000]你好"].join("\n"));

    assert_eq!(payload.display_lines.len(), 1);
    assert_eq!(payload.display_lines[0].text, "Hello");
    assert_eq!(payload.display_lines[0].translation, "你好");
}

#[test]
fn preprocess_decodes_html_entities_in_lyrics() {
    let parsed = dissect_source("[00:01.00]I&apos;m &amp; you &lt;3 &quot;hi&quot;");
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].text, "I'm & you <3 \"hi\"");
}

#[test]
fn preprocess_filters_comment_lines() {
    let parsed = dissect_source(
        &[
            "// generated by some tool",
            "; another comment",
            "# a hash comment",
            "[00:01.00]real lyric",
        ]
        .join("\n"),
    );
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].text, "real lyric");
}

#[test]
fn preprocess_keeps_hex_color_and_timestamp_lines() {
    let parsed = dissect_source(&["[00:01.00]#ffffff is a color", "[00:02.00]next"].join("\n"));
    assert_eq!(parsed.len(), 2);
    assert_eq!(parsed[0].text, "#ffffff is a color");
}

#[test]
fn preprocess_expands_escaped_newlines() {
    let parsed = dissect_source("[00:01.00]line one\\n[00:02.00]line two");
    assert_eq!(parsed.len(), 2);
    assert_eq!(parsed[0].text, "line one");
    assert_eq!(parsed[1].text, "line two");
}

#[test]
fn parses_netease_json_word_level_lyrics() {
    let raw = r#"[{"t":1000,"c":[{"tx":"你"},{"tx":"好"}]},{"t":2000,"c":[{"tx":"世"},{"tx":"界"}]}]"#;
    let parsed = dissect_source(raw);

    assert_eq!(parsed.len(), 2);
    assert_eq!(parsed[0].start_ms, 1000);
    assert_eq!(parsed[0].text, "你好");
    assert_eq!(
        parsed[0]
            .words
            .as_ref()
            .map(|words| words
                .iter()
                .map(|word| word.text.as_str())
                .collect::<Vec<_>>())
            .unwrap_or_default(),
        vec!["你", "好"]
    );
    assert_eq!(parsed[1].text, "世界");
}

#[test]
fn parses_inline_word_lrc_format() {
    let parsed = dissect_source("[00:12.00]Hello(0,300)World(300,400)");
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].text, "HelloWorld");
    assert_eq!(parsed[0].start_ms, 12000);
    let words = parsed[0].words.as_ref().unwrap();
    assert_eq!(words.len(), 2);
    assert_eq!(words[0].text, "Hello");
    assert_eq!(words[0].start_ms, 12000);
    assert_eq!(words[0].end_ms, 12300);
    assert_eq!(words[1].text, "World");
    assert_eq!(words[1].start_ms, 12300);
    assert_eq!(words[1].end_ms, 12700);
}

#[test]
fn keeps_parenthesized_lyrics_as_plain_text() {
    let parsed = dissect_source("[00:01.00](和声) 啦啦啦");
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].text, "(和声) 啦啦啦");
    assert!(parsed[0].words.is_none());
}

#[test]
fn parses_lqe_quick_export_format() {
    let raw = "[Lyricify Quick Export]\n[0,0,0]第一行\n[1000,2000,0]第二行";
    let parsed = dissect_source(raw);

    assert_eq!(parsed.len(), 2);
    assert_eq!(parsed[0].start_ms, 0);
    assert_eq!(parsed[0].text, "第一行");
    assert_eq!(parsed[1].start_ms, 1000);
    assert_eq!(parsed[1].end_ms, 2000);
    assert_eq!(parsed[1].text, "第二行");
}

#[test]
fn parses_lyl_lyricifylines_format() {
    let raw = "[type:LyricifyLines]\n[500,1500,0]Hello";
    let parsed = dissect_source(raw);

    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].start_ms, 500);
    assert_eq!(parsed[0].end_ms, 1500);
    assert_eq!(parsed[0].text, "Hello");
}

#[test]
fn lrc_a2_relative_word_times_are_shifted_by_line_start() {
    let parsed = dissect_source("[00:10.00]<00:00.00>Hello<00:00.50>World<00:01.00>");
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].start_ms, 10000);
    let words = parsed[0].words.as_ref().unwrap();
    assert_eq!(words.len(), 2);
    assert_eq!(words[0].text, "Hello");
    assert_eq!(words[0].start_ms, 10000);
    assert_eq!(words[1].text, "World");
    assert_eq!(words[1].start_ms, 10500);
    assert_eq!(words[1].end_ms, 11000);
}

#[test]
fn lrc_a2_absolute_word_times_are_kept() {
    let parsed = dissect_source("[00:10.00]<00:10.00>Hello <00:10.50>World<00:11.00>");
    assert_eq!(parsed.len(), 1);
    let words = parsed[0].words.as_ref().unwrap();
    assert_eq!(words[0].start_ms, 10000);
    assert_eq!(words[1].start_ms, 10500);
    assert_eq!(words[1].end_ms, 11000);
}

#[test]
fn lrc_a2_early_relative_word_times_are_shifted() {
    let parsed = dissect_source("[00:10.00]<00:09.00>Hello <00:09.50>World<00:10.00>");
    assert_eq!(parsed.len(), 1);
    let words = parsed[0].words.as_ref().unwrap();
    assert_eq!(words[0].start_ms, 19000);
    assert_eq!(words[1].start_ms, 19500);
}

#[test]
fn blank_line_after_silence_sets_previous_end_time() {
    let parsed = dissect_source("[00:01.00]Hello\n[00:10.00]\n[00:20.00]World");
    assert_eq!(parsed.len(), 2);
    assert_eq!(parsed[0].text, "Hello");
    assert_eq!(parsed[0].end_ms, 10000);
    assert_eq!(parsed[1].text, "World");
}

#[test]
fn blank_line_without_silence_is_dropped() {
    let parsed = dissect_source("[00:01.00]Hello\n[00:02.00]\n[00:03.00]World");
    assert_eq!(parsed.len(), 2);
    assert_eq!(parsed[0].text, "Hello");
    assert_eq!(parsed[1].text, "World");
}

#[test]
fn whole_line_parenthesized_is_background_vocal() {
    let parsed = dissect_source("[00:01.00](和声 哦哦哦)");
    assert_eq!(parsed.len(), 1);
    assert!(parsed[0].is_bg);
    assert_eq!(parsed[0].text, "和声 哦哦哦");
}

#[test]
fn speaker_prefix_marks_duet_line() {
    let parsed = dissect_source("[00:01.00]A: 你好\n[00:02.00]B: 世界");
    assert_eq!(parsed.len(), 2);
    assert_eq!(parsed[0].speaker.as_deref(), Some("A"));
    assert!(parsed[0].is_duet);
    assert_eq!(parsed[0].text, "你好");
    assert_eq!(parsed[1].speaker.as_deref(), Some("B"));
    assert!(parsed[1].is_duet);
    assert_eq!(parsed[1].text, "世界");
}

#[test]
fn parenthetical_vocal_split_requires_duet_evidence() {
    let parsed = dissect_source("[00:01.00]主唱 (和声)");
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].text, "主唱 (和声)");

    let parsed = dissect_source("[00:01.00]A: 主唱 (和声)\n[00:02.00]B: 副唱 (和声)");
    assert_eq!(parsed.len(), 4);
    assert_eq!(parsed[0].text, "主唱");
    assert!(parsed[0].is_duet);
    assert_eq!(parsed[1].text, "和声");
    assert!(parsed[1].is_bg);
    assert!(parsed[1].is_duet_partner);
    assert_eq!(parsed[2].text, "副唱");
    assert_eq!(parsed[3].text, "和声");
    assert!(parsed[3].is_duet_partner);
}
