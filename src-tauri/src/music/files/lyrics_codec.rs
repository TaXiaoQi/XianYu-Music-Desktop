// 歌词文件的字节流解码：BOM 探测、UTF-8 直读，以及对 GBK/Big5/Shift_JIS/EUC-KR
// 的启发式择优，常用于解决老 LRC 文件的中文乱码。

use encoding_rs::{BIG5, EUC_KR, GBK, SHIFT_JIS, UTF_16BE, UTF_16LE};
use std::collections::HashSet;
use std::sync::OnceLock;

/// 是否为 CJK 相关区段的字符（表意文字、假名、谚文、全角符号等）。
pub(crate) fn is_cjk_char(c: char) -> bool {
    matches!(c as u32,
        0x3400..=0x4DBF
        | 0x4E00..=0x9FFF
        | 0x3040..=0x30FF
        | 0xAC00..=0xD7AF
        | 0x3000..=0x303F
        | 0xFF00..=0xFF60
        | 0xFFE0..=0xFFEF
        | 0xF900..=0xFAFF
    )
}

// 常用汉字表（数据表，用于区分「真实汉字」与「Latin-1 区噪声」）。
const FREQ_CJK_CHARS: &str = "一七万丈三上下不与专且世业东両两严並个中丸为主举久么义之乎乐乗九也习书乱乳了予争事二于云互五井亚些交产京亮亲人什仅今介仍从仕他付代令以们仲件价任份休众会伝传伤伯伸似但位低住佐体何余佛作你使來例供依価便係保信修俺個們倒候値值假做停側備傳傷働像僕價優儿元兄充先光克免兒入內全兩八公六兰共关兴兵其具典内円再写军冲决况冷准几処凰出击刀分切列刘则刚创初判別利别到制刺刻則前剑剣剧割力办功加务动助効势動務勝势包化北区医區十千半华单南単卡印危即却卷卻历原去参參又及友双反収发取受变口古句另叩只叫可台史右号司吃各合吉同名后吐向吗君否吧听吸吹告员呢周味呼命和品哈响員哥哪哲唇唐商啊問啦喜喝單嗎嘴器四回因団困囲図围固国图國園圖土圧在地场坐型城基堂報場境増壁壊士声売处备変复夏夕外多夜够夢大天太夫失头奇奈奥女奴她好如妈妙妳妹妻姉始姐姑姫姿威娘婚嫌嬉子字存学孩學它守安完宗官宙定宝实実客室宮害家容宿寄密富寝察實寫对寻导対封射将將專對導小少尔尚就尻尽局层居届屋展属山岁島崎川工左巨差己已巴巻市布师希帝带師席帮帯帰帶常干平年并幸幼幾广広床应底店府度座庭建开异式引弟张弱張強强弾归当录形影役彼往待很律後徒従得從御復微德心必志忘忙応快念忽怀态怎怒怕怖思急性怪总恋恐恥息恵恶您悪悲情惊惑想意愛感愿態慌慢慣憶應戏成我或战戦戸戻房所扉手才打払批找承技把投抗折抜护报抱押拉招拿持指振捨据掉掌排掛探接推描提握揺摇撃撫支收改攻放政故敌救教敢散数整敵敷數文斗料断斯新方於旁旅族无既日旧早时明易昔星映春昨是显時晚普景晴暗暴曲更書曾替最會月有朋服望朝期木未末本术机杀杂权李村束条来杨東极构林果某染柔查标树校样根格案條梦棒森楚業極楼楽概構様樂標模樣権横樹機檔權次欢欲歌歡止正此步武歩歳死残段殺殿母毎每比毛氏民气気氣水永求汉江決沉沒沙没沢河治況法波泣注洛活派流济浮海消涙液深混清済渐渡温游満源準滅满滿演激灣火灵点為烈热無然焼照熱爱父爷片版物特犯状独玉王玩现班現球理甘甚生產産用田由申电男町画界留番畫異當疑病痛発發白百的皆皇皮目直相看真眠眼着睛睡瞧瞬瞳知短石研破确確示礼社神福离私种科秘秦称移程種稱穴究空穿突窓立站竟章端竹笑笔第等筋答简算管篇簡类精系紀約純紙級素索紧細終組経結絡給統絵絶經続網緒線締練總織繰红约级纪线组细终经结给绝统续维编罗罪置美群義羽習翻老考者而耳联聖聞聯聲職聽肉肌肩肯育背胜胡胸能脑脚脱脳脸腕腦腰腹自至致與興舌舍舞般船良色艺节花苏若苦英茶草荒莫菜華萬落葉著薄薬藏藤處號虽血行術街衛衣表被装裏裕裡襲西要見視覚親観覺觀见观规视觉角解触言計訊討記設許訳訴証試詰話該認誘語說説読誰課調談請論講謝識警議護讀變讓计认讨让议记讲许论设证评识诉词译试诗话该语说请读谁调谈谓谢谷象負責貴買費資質賽质费资赤走起超越足跑跟路踏身車軍転軽較輝輩輸轉车转轻较辦边辺込达过迎运近返还这进远连迫述迷追退送逃逆选途這通速造連進遅遇遊運過道達違遠選還那邪郎部都配酒释里重野量金鉄銀錄錢錯钱铁错長长门閉開間関闘關门问间闻队防阳阵阶阿际陆陈降限院除陰陳険陽隊階随隐際隠隣难集雑離難雨雪電需震霊露青静非面革音響頃領頬頭頷頼題顔願類须顾领题風风飛飞食飲館饭首香馬駄駆騎験驗驚马验體高髪鬼魔鲁鳳鳴麗麻麼黃黄黑黒黙點鼻齐龍龙";

static FREQ_CJK_SET: OnceLock<HashSet<char>> = OnceLock::new();

fn in_freq_cjk_set(c: char) -> bool {
    FREQ_CJK_SET
        .get_or_init(|| FREQ_CJK_CHARS.chars().collect())
        .contains(&c)
}

fn cjk_ideograph_range(c: char) -> bool {
    matches!(c as u32, 0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF)
}

fn kana_range(c: char) -> bool {
    matches!(c as u32, 0x3040..=0x30FF)
}

fn hangul_range(c: char) -> bool {
    matches!(c as u32, 0xAC00..=0xD7AF)
}

fn halfwidth_katakana_range(c: char) -> bool {
    matches!(c as u32, 0xFF61..=0xFF9F)
}

fn jamo_range(c: char) -> bool {
    matches!(c as u32, 0x1100..=0x11FF)
}

/// 给一次解码结果打分：CJK/假名/谚文加分，替换符与控制符扣分，
/// 假名与谚文混杂扣重分（几乎不可能是正确解码）。
fn rate_decoded_text(text: &str) -> i32 {
    let mut score = 0i32;
    let mut kana_count = 0;
    let mut hangul_count = 0;
    let mut cjk_count = 0;
    for ch in text.chars() {
        match ch {
            '\u{FFFD}' => score -= 8,
            '\n' | '\r' | '\t' => {}
            c if (c as u32) < 0x20 => score -= 5,
            c if halfwidth_katakana_range(c) => score -= 2,
            c if jamo_range(c) => score -= 2,
            c if kana_range(c) => {
                score += 2;
                kana_count += 1;
            }
            c if hangul_range(c) => {
                score += 4;
                hangul_count += 1;
            }
            c if cjk_ideograph_range(c) => {
                score += if in_freq_cjk_set(c) { 4 } else { 1 };
                cjk_count += 1;
            }
            c if (c as u32) >= 0x80 && (c as u32) <= 0xFF => score -= 1,
            _ => {}
        }
    }
    if hangul_count > 0 && cjk_count > 0 {
        score -= hangul_count * 4;
    }
    if kana_count > 0 && hangul_count > 0 {
        score -= 20;
    }
    score
}

fn strip_bom_char(text: &str) -> String {
    text.trim_start_matches('\u{feff}').to_string()
}

/// 按优先级尝试各 CJK 编码，取打分最高者；全部失败则退化 lossy 解码。
fn decode_with_cjk_fallbacks(bytes: &[u8]) -> String {
    const CJK_CANDIDATES: [(&'static encoding_rs::Encoding, &str); 4] = [
        (GBK, "GBK"),
        (BIG5, "Big5"),
        (SHIFT_JIS, "Shift_JIS"),
        (EUC_KR, "EUC-KR"),
    ];

    let mut best: Option<(i32, String)> = None;
    for (encoding, _name) in CJK_CANDIDATES {
        let (decoded, _, _) = encoding.decode(bytes);
        let score = rate_decoded_text(&decoded);
        if best
            .as_ref()
            .is_none_or(|(best_score, _)| score > *best_score)
        {
            best = Some((score, strip_bom_char(&decoded)));
        }
    }

    best.map(|(_, text)| text)
        .unwrap_or_else(|| String::from_utf8_lossy(bytes).into_owned())
}

pub(crate) fn decode_lyrics_file_bytes(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xff, 0xfe]) {
        let (decoded, _, _) = UTF_16LE.decode(&bytes[2..]);
        return strip_bom_char(&decoded);
    }
    if bytes.starts_with(&[0xfe, 0xff]) {
        let (decoded, _, _) = UTF_16BE.decode(&bytes[2..]);
        return strip_bom_char(&decoded);
    }
    if let Ok(text) = std::str::from_utf8(bytes) {
        return strip_bom_char(text);
    }

    decode_with_cjk_fallbacks(bytes)
}

#[cfg(test)]
mod codec_tests {
    use super::decode_lyrics_file_bytes;
    use encoding_rs::{BIG5, EUC_KR, GBK, SHIFT_JIS};

    #[test]
    fn utf8_bom_is_stripped() {
        assert_eq!(
            decode_lyrics_file_bytes(b"\xef\xbb\xbf[00:01.00]hello"),
            "[00:01.00]hello"
        );
    }

    #[test]
    fn gbk_encoded_chinese_lyrics_decode_correctly() {
        let (gbk, _, _) = GBK.encode("[00:01.00]中文歌词");
        assert_eq!(decode_lyrics_file_bytes(gbk.as_ref()), "[00:01.00]中文歌词");
    }

    #[test]
    fn big5_shift_jis_and_euc_kr_variants_decode_correctly() {
        let (big5, _, _) = BIG5.encode("[00:01.00]中文歌詞");
        assert_eq!(
            decode_lyrics_file_bytes(big5.as_ref()),
            "[00:01.00]中文歌詞"
        );

        let (shift_jis, _, _) = SHIFT_JIS.encode("[00:01.00]日本語の歌詞");
        assert_eq!(
            decode_lyrics_file_bytes(shift_jis.as_ref()),
            "[00:01.00]日本語の歌詞"
        );

        let (euc_kr, _, _) = EUC_KR.encode("[00:01.00]한국어 가사");
        assert_eq!(
            decode_lyrics_file_bytes(euc_kr.as_ref()),
            "[00:01.00]한국어 가사"
        );
    }
}
