//! 歌词结构化解析的回归用例。
//!
//! 每条用例都用一份固定的歌词原文喂给 [`build_structured_lyrics_payload`]，
//! 再对产出的显示行做断言。原文样本集中在 `fixtures/lyrics.rs`，
//! 期望值写在用例里，两者共同构成这块解析逻辑的行为规格。

#[path = "../src/music/lyrics/mod.rs"]
mod lyrics;

#[path = "fixtures/lyrics.rs"]
mod samples;

/// 测试桩：`lyrics` 模块清洗文本时会调用 `crate::lyric_fetcher` 下的同名函数，
/// 这里给出一份等价实现，使被 include 进来的模块能够独立编译。
pub mod lyric_fetcher {
  /// 常见命名实体与其对应字符。
  const NAMED_ENTITIES: [(&str, char); 6] = [
    ("amp", '&'),
    ("lt", '<'),
    ("gt", '>'),
    ("quot", '"'),
    ("apos", '\''),
    ("nbsp", ' '),
  ];

  /// 把 `&#123;` / `&#x1F600;` 这样的码点写法转成字符。
  fn codepoint_entity(body: &str) -> Option<char> {
    let digits = body.strip_prefix('#')?;
    match digits
      .strip_prefix('x')
      .or_else(|| digits.strip_prefix('X'))
    {
      Some(hex) => u32::from_str_radix(hex, 16).ok()?.try_into().ok(),
      None => digits.parse::<u32>().ok()?.try_into().ok(),
    }
  }

  /// 解析单个实体（不含 `&` 与 `;`），无法识别时返回 `None`。
  fn resolve_entity(body: &str) -> Option<char> {
    if body.starts_with('#') {
      return codepoint_entity(body);
    }
    NAMED_ENTITIES
      .iter()
      .find(|(name, _)| *name == body)
      .map(|(_, ch)| *ch)
  }

  /// 还原文本中的 HTML 实体，无法识别的 `&` 原样保留。
  pub(crate) fn decode_html_entities(raw: &str) -> String {
    let mut decoded = String::with_capacity(raw.len());
    let mut chars = raw.chars();
    while let Some(ch) = chars.next() {
      if ch != '&' {
        decoded.push(ch);
        continue;
      }
      let mut body = String::new();
      let mut closed = false;
      for next in chars.by_ref() {
        if next == ';' {
          closed = true;
          break;
        }
        body.push(next);
      }
      match resolve_entity(&body) {
        Some(ch) => decoded.push(ch),
        None => {
          decoded.push('&');
          decoded.push_str(&body);
          if closed {
            decoded.push(';');
          }
        }
      }
    }
    decoded
  }
}

use lyrics::{build_structured_lyrics_payload, LyricLinePayload, StructuredLyricsPayload};

/// 把样本行拼成一份完整的歌词原文。
fn joined(rows: &[&str]) -> String {
  rows.join("\n")
}

/// 按起始时间定位显示行，找不到就让用例当场失败。
fn row_at(payload: &StructuredLyricsPayload, seconds: f64) -> &LyricLinePayload {
  let hit = payload
    .display_lines
    .iter()
    .position(|row| (row.time - seconds).abs() < 1e-3)
    .unwrap_or_else(|| panic!("时间轴 {seconds} 秒处没有对应的显示行"));
  &payload.display_lines[hit]
}

/// 校验一行的主文本、注音与译文。
fn expect_triple(row: &LyricLinePayload, main: &str, romaji: &str, translated: &str) {
  assert_eq!(row.text, main, "主行文本不符");
  assert_eq!(row.romaji, romaji, "注音文本不符");
  assert_eq!(row.translation, translated, "译文文本不符");
}

/// 校验一行的主文本与译文，并确认没有生成注音。
fn expect_pair(row: &LyricLinePayload, main: &str, translated: &str) {
  assert_eq!(row.text, main, "主行文本不符");
  assert_eq!(row.translation, translated, "译文文本不符");
  assert!(row.romaji.is_empty(), "该样本不应产生注音");
}

#[test]
fn yrc_sample_yields_one_line_with_per_character_timings() {
  let payload = build_structured_lyrics_payload(
    include_str!("../src/music/fixtures/lyrics/if_back_then.yrc").to_string(),
  );

  assert_eq!(payload.display_lines.len(), 1, "yrc 样本只有一行");
  assert_eq!(payload.display_lines[0].text, "如果当时 - 许嵩");
  let syllables: Vec<&str> = payload.display_lines[0]
    .words
    .as_ref()
    .expect("yrc 必须带逐字时间轴")
    .iter()
    .map(|word| word.text.as_str())
    .collect();
  assert_eq!(
    syllables,
    vec!["如", "果", "当", "时", " ", "-", " ", "许", "嵩"]
  );
}

#[test]
fn qrc_sample_keeps_translation_on_the_same_row() {
  let payload = build_structured_lyrics_payload(
    include_str!("../src/music/fixtures/lyrics/baby.qrc").to_string(),
  );

  assert_eq!(payload.display_lines.len(), 2, "qrc 样本有两行");
  assert_eq!(
    payload.display_lines[0].text,
    "You know you love me I know you care"
  );
  assert_eq!(payload.display_lines[1].text, "你知道你爱我 我知道你在意");
}

#[test]
fn lys_sample_is_parsed_into_two_rows() {
  let payload = build_structured_lyrics_payload(
    include_str!("../src/music/fixtures/lyrics/from_that_day.lys").to_string(),
  );

  assert_eq!(payload.display_lines.len(), 2, "lys 样本有两行");
  assert_eq!(payload.display_lines[0].text, "その日から何もかも");
  assert_eq!(payload.display_lines[1].text, "忘れたくないこと");
}

#[test]
fn english_and_chinese_rows_sharing_a_timestamp_are_merged() {
  let payload = build_structured_lyrics_payload(joined(&samples::BILINGUAL_EN_ROWS));

  assert_eq!(payload.display_lines.len(), 5, "五组双语应合并成五行");
  let mut stamps = std::collections::BTreeSet::new();
  for row in &payload.display_lines {
    stamps.insert((row.time * 1000.0).round() as i64);
  }
  assert_eq!(
    stamps.len(),
    payload.display_lines.len(),
    "同时间戳的中英行不应拆成两行"
  );
  expect_pair(&payload.display_lines[0], "Hey you", "嘿 亲爱的");
  assert!(
    payload
      .display_lines
      .iter()
      .all(|row| row.romaji.is_empty()),
    "纯中英双语不产生注音"
  );
}

#[test]
fn japanese_rows_keep_romaji_and_translation_together() {
  let payload = build_structured_lyrics_payload(joined(&samples::JP_ROMAJI_GROUPED_ROWS));

  expect_triple(
    row_at(&payload, 300.140),
    "大丈夫",
    "da i jo u bu",
    "没问题",
  );
  expect_triple(
    row_at(&payload, 303.480),
    "これからも 一人じゃない",
    "ko re ka ra mo hi to ri ja na i",
    "从今往后你也不会孤单",
  );
  expect_triple(row_at(&payload, 314.050), "終わり", "o wa ri", "终");
}

#[test]
fn parenthesised_english_row_inside_japanese_lyrics_is_marked_as_background() {
  let payload = build_structured_lyrics_payload(joined(&samples::JP_WITH_INLINE_EN_ROWS));

  expect_triple(
    row_at(&payload, 26.942),
    "もうとっくに出会ってたから",
    "mo u to kku ni de a't te ta ka ra",
    "独属于我的蒙娜丽莎",
  );

  let english = row_at(&payload, 47.751);
  assert_eq!(english.text, "Can you give me one last kiss?");
  assert!(english.is_bg, "整行被括号包住的行应视为背景和声");
  assert!(english.romaji.is_empty(), "英文和声行不需要注音");

  expect_triple(
    row_at(&payload, 86.907),
    "私の心のプロジェクター",
    "wa ta shi no ko ko ro no pu ro je ku ta",
    "早已将你的身影深深烙印",
  );
}

#[test]
fn japanese_and_english_rows_both_stay_main_when_no_romaji_track_exists() {
  let payload = build_structured_lyrics_payload(joined(&samples::MIXED_JP_EN_NO_ROMAJI_ROWS));

  expect_pair(
    row_at(&payload, 43.314),
    "I don't know what I wanted or you made me do",
    "我不知自己心之所向 亦不知你对我期望怎样",
  );
  expect_pair(
    row_at(&payload, 49.283),
    "散り散りに刻む",
    "于颠沛流离中铭刻下生命的印记",
  );
  expect_pair(
    row_at(&payload, 60.455),
    "Don't you get there?",
    "你是否还未抵达目的地？",
  );
}

#[test]
fn french_rows_keep_chinese_translation_without_romaji() {
  let payload = build_structured_lyrics_payload(joined(&samples::FRENCH_ROWS));

  expect_pair(
    row_at(&payload, 63.014),
    "Et quand tu briseras ta cage",
    "当你挣脱内心的牢笼",
  );
  expect_pair(
    row_at(&payload, 66.009),
    "On ira a la foire",
    "我们将一起前往那欢乐的圣地",
  );
}

#[test]
fn latin_rows_stay_main_even_when_translation_repeats_latin_words() {
  let payload =
    build_structured_lyrics_payload(joined(&samples::GERMAN_WITH_LATIN_TRANSLATION_ROWS));

  expect_pair(
    row_at(&payload, 38.88),
    "Johnny Boy, Johnny Boy",
    "Johnny小子，Johnny小子！",
  );
  expect_pair(
    row_at(&payload, 41.62),
    "we're bound for stormy weather",
    "我们本就为风暴而生",
  );
  expect_pair(
    row_at(&payload, 43.66),
    "Johnny Boy, Johnny Boy",
    "Johnny小子，Johnny小子！",
  );
  expect_pair(
    row_at(&payload, 46.41),
    "better wish you lads farewell",
    "所有的祝福都给你",
  );
  expect_pair(
    row_at(&payload, 48.55),
    "Somewhere out far away",
    "在某个遥远海域",
  );
}

#[test]
fn short_english_rows_inside_romaji_lyrics_are_not_treated_as_romaji() {
  let payload = build_structured_lyrics_payload(joined(&samples::JP_ROMAJI_WITH_SHORT_EN_ROWS));

  expect_pair(
    row_at(&payload, 77.567),
    "\"Believe Be:leave\"",
    "\"相信如此 离开吧\"",
  );
  expect_pair(
    row_at(&payload, 84.657),
    "So I dreamt?",
    "所以这只是我的一场梦？",
  );
  expect_pair(row_at(&payload, 99.956), "Still I believe?", "我仍相信?");
}

#[test]
fn romaji_word_timings_survive_serialization() {
  let payload = build_structured_lyrics_payload(joined(&samples::JP_MAIN_AFTER_EN_INTRO_ROWS));

  let mixed = row_at(&payload, 30.710);
  expect_triple(
    mixed,
    "ぎこちない innocent calm",
    "gi ko chi na i innocent calm",
    "小心翼翼地维护着这无辜的宁静",
  );
  assert_eq!(
    mixed
      .romaji_words
      .as_ref()
      .expect("含英文混入的行应带独立注音词")[0]
      .text,
    "gi "
  );

  expect_triple(
    row_at(&payload, 98.981),
    "拙い祈りが織りなす波",
    "tsu ta na i i no ri ga o ri na su na mi",
    "笨拙的祈愿交织而成汹涌的巨浪",
  );

  let json = serde_json::to_value(&payload).expect("payload 可以序列化");
  let serialized = json["displayLines"]
    .as_array()
    .expect("displayLines 是数组")
    .iter()
    .find(|row| {
      row["time"]
        .as_f64()
        .map(|time| (time - 98.981).abs() < 1e-3)
        .unwrap_or(false)
    })
    .expect("序列化结果里能找到该行");
  let romaji_words = serialized["romajiWords"]
    .as_array()
    .expect("romajiWords 是数组");
  assert_eq!(romaji_words[0]["text"], "tsu ");
  assert_eq!(romaji_words[0]["start"], 98.981);
  assert_eq!(romaji_words[0]["end"], 99.033);

  expect_triple(
    row_at(&payload, 116.943),
    "とめどない resonant harm",
    "to me do na i resonant harm",
    "是那从不曾间断的杀戮之音",
  );
}
