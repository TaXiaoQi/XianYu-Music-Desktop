// 输出后端公共层（本文件为全新组织）：错误归类与后端能力约定，
// 由共享混音与 WASAPI 独占两个实现共同复用。错误文案对前端冻结。

pub(crate) mod shared; // 共享混音后端

#[cfg(target_os = "windows")]
pub(crate) mod wasapi_exclusive; // WASAPI 独占后端

use rodio::Sink;

/// 打开输出链路失败的分类错误。
#[derive(Debug)]
pub(crate) enum OutputError {
    DeviceUnavailable, // 系统当前没有可用输出设备
    Stream(String),    // 共享流打开失败
    Sink(String),      // 共享 Sink 创建失败
    Exclusive(String), // WASAPI 独占流失败
}

impl core::fmt::Display for OutputError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let text = match self {
            Self::DeviceUnavailable => "No output device is available".to_string(),
            Self::Stream(cause) => format!("Failed to open shared output stream: {cause}"),
            Self::Sink(cause) => format!("Failed to create shared output sink: {cause}"),
            Self::Exclusive(cause) => format!("Failed to open WASAPI exclusive output: {cause}"),
        };
        f.write_str(&text)
    }
}

/// 输出后端能力约定：报告实际生效设备，并提供可追加音源的 Sink。
pub(crate) trait OutputBackend {
    /// 当前实际接入的输出设备名。
    fn active_device_name(&self) -> &str;
    /// 新建一个可追加音源的 Sink。
    fn create_sink(&self) -> Result<Sink, OutputError>;
}

#[cfg(test)]
mod progress_math_tests {
    use super::shared::progress_seconds_from_samples;

    #[test]
    fn converts_samples_to_seconds_with_format_info() {
        let computed = progress_seconds_from_samples(176_400, 44_100, 2);

        assert_eq!(computed, 2.0);
    }

    #[test]
    fn zero_format_yields_zero_seconds() {
        let no_rate = progress_seconds_from_samples(176_400, 0, 2);
        let no_channels = progress_seconds_from_samples(176_400, 44_100, 0);

        assert_eq!(no_rate, 0.0);
        assert_eq!(no_channels, 0.0);
    }
}
