use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DlnaDevice {
    pub udn: String,
    pub friendly_name: String,
    pub model_name: String,
    pub location: String,
    pub base_url: String,
    pub avt_control_url: Option<String>,
    pub rcs_control_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum MediaPayload {
    #[serde(rename = "local")]
    LocalFile { path: String },
    #[serde(rename = "remote")]
    Remote {
        url: String,
        #[serde(default)]
        headers: BTreeMap<String, String>,
        #[serde(default)]
        resolved_at_ms: u64,
    },
    #[serde(rename = "cover")]
    Cover {
        url: String,
        #[serde(default)]
        headers: BTreeMap<String, String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum TransportState {
    Playing,
    PausedPlayback,
    #[default]
    Stopped,
    NoMedia,
    Transitioning,
}

impl TransportState {
    pub fn as_str(&self) -> &'static str {
        match self {
            TransportState::Playing => "PLAYING",
            TransportState::PausedPlayback => "PAUSED_PLAYBACK",
            TransportState::Stopped => "STOPPED",
            TransportState::NoMedia => "NO_MEDIA_PRESENT",
            TransportState::Transitioning => "TRANSITIONING",
        }
    }
    pub fn from_upnp(s: &str) -> Self {
        match s.trim().to_ascii_uppercase().as_str() {
            "PLAYING" => TransportState::Playing,
            "PAUSED_PLAYBACK" => TransportState::PausedPlayback,
            "STOPPED" => TransportState::Stopped,
            "TRANSITIONING" => TransportState::Transitioning,
            _ => TransportState::NoMedia,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum DmrCommand {
    #[serde(rename = "loadUri")]
    LoadUri {
        uri: String,
        #[serde(default)]
        title: String,
        #[serde(default)]
        artist: String,
        #[serde(default)]
        album: String,
        #[serde(default)]
        duration_ms: u64,
        #[serde(default)]
        metadata_xml: String,
    },
    #[serde(rename = "play")]
    Play,
    #[serde(rename = "pause")]
    Pause,
    #[serde(rename = "stop")]
    Stop,
    #[serde(rename = "seek")]
    Seek { secs: f64 },
    #[serde(rename = "setVolume")]
    SetVolume { percent: u8 },
    #[serde(rename = "setMute")]
    SetMute { on: bool },
}

#[derive(Debug, Clone, Copy, Default)]
pub struct DmrPlaybackReport {
    pub state: TransportState,
    pub position_secs: f64,
    pub duration_secs: f64,
}

pub trait DmrHost: Send + Sync {
    fn playback_snapshot(&self) -> DmrPlaybackReport;
    fn volume_snapshot(&self) -> (u8, bool);
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RendererConfig {
    pub friendly_name: String,
    #[serde(default)]
    pub udn: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CastMediaInfo {
    pub media_token: String,
    pub media_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CastTransportState {
    pub position_secs: f64,
    pub duration_secs: f64,
    pub state: String,
}
