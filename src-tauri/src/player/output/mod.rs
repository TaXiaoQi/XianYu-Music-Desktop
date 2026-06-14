pub(crate) mod shared;

#[cfg(target_os = "windows")]
pub(crate) mod wasapi_exclusive;

use rodio::Sink;

#[derive(Debug)]
pub(crate) enum OutputError {
    DeviceUnavailable,
    Stream(String),
    Sink(String),
    Exclusive(String),
}

impl std::fmt::Display for OutputError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DeviceUnavailable => write!(formatter, "No output device is available"),
            Self::Stream(error) => {
                write!(formatter, "Failed to open shared output stream: {error}")
            }
            Self::Sink(error) => write!(formatter, "Failed to create shared output sink: {error}"),
            Self::Exclusive(error) => {
                write!(formatter, "Failed to open WASAPI exclusive output: {error}")
            }
        }
    }
}

pub(crate) trait OutputBackend {
    fn active_device_name(&self) -> &str;
    fn create_sink(&self) -> Result<Sink, OutputError>;
}

#[cfg(test)]
mod tests {
    use super::shared::progress_seconds_from_samples;

    #[test]
    fn progress_seconds_uses_sample_rate_and_channels() {
        let seconds = progress_seconds_from_samples(176_400, 44_100, 2);

        assert_eq!(seconds, 2.0);
    }

    #[test]
    fn progress_seconds_returns_zero_for_missing_format() {
        assert_eq!(progress_seconds_from_samples(176_400, 0, 2), 0.0);
        assert_eq!(progress_seconds_from_samples(176_400, 44_100, 0), 0.0);
    }
}
