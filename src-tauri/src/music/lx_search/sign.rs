use base64::Engine;
use sha1::{Digest, Sha1};

const TX_PART_1_INDEXES: [usize; 8] = [23, 14, 6, 36, 16, 40, 7, 19];
const TX_PART_2_INDEXES: [usize; 8] = [16, 1, 32, 12, 19, 27, 8, 5];
const TX_SCRAMBLE_VALUES: [u8; 20] = [
    89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179,
];

pub(super) fn sha1_hex(text: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(text.as_bytes());
    let result = hasher.finalize();
    hex::encode(result)
}

pub(super) fn pick_hash_by_idx(hash: &str, indexes: &[usize]) -> String {
    indexes
        .iter()
        .map(|&idx| hash.chars().nth(idx).unwrap_or('0'))
        .collect()
}

pub(super) fn zzc_sign(text: &str) -> String {
    let hash = sha1_hex(text);
    let part1 = pick_hash_by_idx(&hash, &TX_PART_1_INDEXES);
    let part2 = pick_hash_by_idx(&hash, &TX_PART_2_INDEXES);

    let mut part3_bytes = Vec::with_capacity(20);
    for (i, &scramble) in TX_SCRAMBLE_VALUES.iter().enumerate() {
        let hex_pair = &hash[i * 2..i * 2 + 2];
        let hash_byte = u8::from_str_radix(hex_pair, 16).unwrap_or(0);
        part3_bytes.push(scramble ^ hash_byte);
    }

    let b64 = base64::engine::general_purpose::STANDARD.encode(&part3_bytes);
    let b64_clean: String = b64
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | '+' | '='))
        .collect();

    format!("zzc{}{}{}", part1, b64_clean, part2).to_lowercase()
}

pub(super) fn mg_create_signature(time: &str, text: &str) -> (String, String) {
    let device_id = "963B7AA0D21511ED807EE5846EC87D20";
    let signature_md5 = "6cdc72a439cef99a3418d2a78aa28c73";
    let input = format!(
        "{}{}yyapp2d16148780a1dcc7408e06336b98cfd50{}{}",
        text, signature_md5, device_id, time
    );
    let sign = format!("{:x}", md5::compute(input.as_bytes()));
    (sign, device_id.to_string())
}
