// 歌词文件的字节流解码（BOM 探测 + CJK 编码打分择优）已迁入共享仓库
// XianYu-Music-Core（xianyu_core::music::lyrics），本文件仅保留路径别名，
// 供 lyrics_io / tags 等模块按既有路径引用。

pub(crate) use xianyu_core::music::lyrics::decode_lyrics_file_bytes;
