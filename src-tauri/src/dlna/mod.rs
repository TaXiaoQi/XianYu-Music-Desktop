pub mod commands;
pub mod discovery;
pub mod dmr;
pub mod httpd;
pub mod media_server;
pub mod net_util;
pub mod soap;
pub mod spawn;
pub mod ssdp;
pub mod types;

pub use types::{
    CastMediaInfo, CastTransportState, DlnaDevice, DmrCommand, DmrHost, MediaPayload,
    RendererConfig, TransportState,
};

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tokio::sync::mpsc;

struct RendererSession {
    advertiser: ssdp::SsdpAdvertiser,
    friendly_name: String,
    port: u16,
}

pub struct DlnaCore {
    client: reqwest::Client,
    registry: Arc<media_server::MediaRegistry>,
    httpd_port: AtomicU64,
    dmr_shared: OnceLock<Arc<dmr::DmrShared>>,
    dmr_rx: tokio::sync::Mutex<Option<mpsc::Receiver<DmrCommand>>>,
    renderer: Mutex<Option<RendererSession>>,
    device_cache: Mutex<HashMap<String, DlnaDevice>>,
}

static CORE: OnceLock<DlnaCore> = OnceLock::new();

impl DlnaCore {
    pub fn shared() -> &'static DlnaCore {
        CORE.get_or_init(|| DlnaCore {
            client: reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(8))
                .build()
                .unwrap_or_default(),
            registry: Arc::new(media_server::MediaRegistry::new(
                reqwest::Client::builder()
                    .connect_timeout(std::time::Duration::from_secs(10))
                    .build()
                    .unwrap_or_default(),
            )),
            httpd_port: AtomicU64::new(0),
            dmr_shared: OnceLock::new(),
            dmr_rx: tokio::sync::Mutex::new(None),
            renderer: Mutex::new(None),
            device_cache: Mutex::new(HashMap::new()),
        })
    }

    // ---------------- 发送端（DMC） ----------------

    pub async fn search_devices(&self, timeout_ms: u64) -> Vec<DlnaDevice> {
        let locations = ssdp::search_renderers(timeout_ms).await;
        let mut out: Vec<DlnaDevice> = Vec::new();
        {
            let cache = self.device_cache.lock().unwrap();
            for loc in &locations {
                if let Some(dev) = cache.values().find(|d| &d.location == loc) {
                    out.push(dev.clone());
                }
            }
        }
        if out.len() == locations.len() {
            return out;
        }
        for loc in &locations {
            if out.iter().any(|d| &d.location == loc) {
                continue;
            }
            if let Ok(dev) = discovery::describe_device(&self.client, loc).await {
                out.push(dev.clone());
                self.device_cache
                    .lock()
                    .unwrap()
                    .insert(dev.udn.clone(), dev);
            }
        }
        out.sort_by(|a, b| a.friendly_name.cmp(&b.friendly_name));
        out
    }

    pub async fn ensure_httpd(&self) -> Result<u16, String> {
        let cur = self.httpd_port.load(Ordering::SeqCst) as u16;
        if cur != 0 {
            return Ok(cur);
        }
        let (cmd_tx, cmd_rx) = mpsc::channel::<DmrCommand>(32);
        let shared = Arc::new(dmr::DmrShared::new(cmd_tx));
        let server = httpd::start(httpd::AppState {
            registry: self.registry.clone(),
            dmr: shared.clone(),
        })
        .await?;
        let _ = self.dmr_shared.set(shared);
        *self.dmr_rx.lock().await = Some(cmd_rx);
        self.httpd_port.store(server.port as u64, Ordering::SeqCst);
        Ok(server.port)
    }

    pub fn update_media_token(&self, token: &str, payload: MediaPayload) -> bool {
        self.registry.update(token, payload)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn cast_set_uri(
        &self,
        dev: &DlnaDevice,
        media: MediaPayload,
        cover: Option<MediaPayload>,
        title: &str,
        artist: &str,
        album: &str,
        duration_ms: u64,
    ) -> Result<CastMediaInfo, String> {
        let port = self.ensure_httpd().await?;
        let base = net_util::lan_base_url(port);

        let media_token = self.registry.create(media);
        self.registry.evict_old(256);
        let media_url = format!("{base}/media/{media_token}");

        let cover_url = match cover {
            Some(c) => {
                let t = self.registry.create(c);
                Some((format!("{base}/media/cover/{t}"), t))
            }
            None => None,
        };

        let duration = soap::format_upnp_time(duration_ms as f64 / 1000.0);
        let didl = build_didl(
            &media_url,
            cover_url.as_ref().map(|(u, _)| u.as_str()),
            title,
            artist,
            album,
            &duration,
        );
        let inner = format!(
            "<InstanceID>0</InstanceID><CurrentURI>{}</CurrentURI><CurrentURIMetaData>{}</CurrentURIMetaData>",
            soap::xml_escape(&media_url),
            soap::xml_escape(&didl),
        );
        let avt = dev
            .avt_control_url
            .clone()
            .ok_or_else(|| "设备缺少 AVTransport 端点".to_string())?;
        soap::soap_call(
            &self.client,
            &avt,
            "urn:schemas-upnp-org:service:AVTransport:1",
            "SetAVTransportURI",
            &inner,
        )
        .await?;

        Ok(CastMediaInfo {
            media_token,
            media_url,
            cover_token: cover_url.as_ref().map(|(_, t)| t.clone()),
            cover_url: cover_url.map(|(u, _)| u),
        })
    }

    pub async fn cast_play(&self, dev: &DlnaDevice) -> Result<(), String> {
        self.simple_avt(dev, "Play", "<InstanceID>0</InstanceID><Speed>1</Speed>")
            .await
    }

    pub async fn cast_pause(&self, dev: &DlnaDevice) -> Result<(), String> {
        self.simple_avt(dev, "Pause", "<InstanceID>0</InstanceID>")
            .await
    }

    pub async fn cast_stop(&self, dev: &DlnaDevice) -> Result<(), String> {
        self.simple_avt(dev, "Stop", "<InstanceID>0</InstanceID>")
            .await
    }

    pub async fn cast_seek(&self, dev: &DlnaDevice, secs: f64) -> Result<(), String> {
        let target = soap::format_upnp_time(secs);
        self.simple_avt(
            dev,
            "Seek",
            &format!("<InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>{target}</Target>"),
        )
        .await
    }

    pub async fn cast_set_volume(&self, dev: &DlnaDevice, percent: u8) -> Result<(), String> {
        let Some(rcs) = dev.rcs_control_url.clone() else {
            return Ok(());
        };
        let inner = format!(
            "<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>{}</DesiredVolume>",
            percent.clamp(0, 100)
        );
        soap::soap_call(
            &self.client,
            &rcs,
            "urn:schemas-upnp-org:service:RenderingControl:1",
            "SetVolume",
            &inner,
        )
        .await?;
        Ok(())
    }

    pub async fn cast_get_state(&self, dev: &DlnaDevice) -> Result<CastTransportState, String> {
        let avt = dev
            .avt_control_url
            .clone()
            .ok_or_else(|| "设备缺少 AVTransport 端点".to_string())?;
        let pos_resp = soap::soap_call(
            &self.client,
            &avt,
            "urn:schemas-upnp-org:service:AVTransport:1",
            "GetPositionInfo",
            "<InstanceID>0</InstanceID>",
        )
        .await?;
        let rel = soap::extract_tag(&pos_resp, "RelTime").unwrap_or_default();
        let dur = soap::extract_tag(&pos_resp, "TrackDuration").unwrap_or_default();
        let position = soap::parse_upnp_time(&rel).unwrap_or(0.0);
        let duration = soap::parse_upnp_time(&dur).unwrap_or(0.0);
        let state = match soap::soap_call(
            &self.client,
            &avt,
            "urn:schemas-upnp-org:service:AVTransport:1",
            "GetTransportInfo",
            "<InstanceID>0</InstanceID>",
        )
        .await
        {
            Ok(t) => soap::extract_tag(&t, "CurrentTransportState")
                .map(|s| TransportState::from_upnp(&s))
                .unwrap_or_default()
                .as_str()
                .to_string(),
            Err(_) => TransportState::Stopped.as_str().to_string(),
        };
        Ok(CastTransportState {
            position_secs: position,
            duration_secs: duration,
            state,
        })
    }

    async fn simple_avt(&self, dev: &DlnaDevice, action: &str, inner: &str) -> Result<(), String> {
        let avt = dev
            .avt_control_url
            .clone()
            .ok_or_else(|| "设备缺少 AVTransport 端点".to_string())?;
        soap::soap_call(
            &self.client,
            &avt,
            "urn:schemas-upnp-org:service:AVTransport:1",
            action,
            inner,
        )
        .await?;
        Ok(())
    }

    // ---------------- 接收端（DMR） ----------------

    pub async fn enable_renderer(
        &self,
        cfg: RendererConfig,
        host: Arc<dyn DmrHost>,
    ) -> Result<u16, String> {
        let port = self.ensure_httpd().await?;
        self.disable_renderer().await;

        let udn = if cfg.udn.trim().is_empty() {
            uuid::Uuid::new_v4().to_string()
        } else {
            cfg.udn.trim().to_string()
        };

        let shared = self
            .dmr_shared
            .get()
            .ok_or_else(|| "httpd 未初始化".to_string())?
            .clone();
        *shared.udn.lock().unwrap() = udn.clone();
        *shared.friendly_name.lock().unwrap() = cfg.friendly_name.clone();
        shared.port.store(port, Ordering::SeqCst);
        *shared.host.lock().unwrap() = Some(host);
        shared.enabled.store(1, Ordering::SeqCst);

        let advertiser = ssdp::SsdpAdvertiser::start(ssdp::AdvertiseConfig {
            udn: udn.clone(),
            location: format!("{}/dlna/desc.xml", net_util::lan_base_url(port)),
        })
        .await?;

        *self.renderer.lock().unwrap() = Some(RendererSession {
            advertiser,
            friendly_name: cfg.friendly_name,
            port,
        });
        Ok(port)
    }

    pub async fn disable_renderer(&self) {
        let session = self.renderer.lock().unwrap().take();
        if let Some(s) = session {
            s.advertiser.stop();
        }
        if let Some(shared) = self.dmr_shared.get() {
            shared.enabled.store(0, Ordering::SeqCst);
            *shared.host.lock().unwrap() = None;
        }
    }

    pub fn renderer_running(&self) -> bool {
        self.renderer.lock().unwrap().is_some()
    }

    pub fn renderer_info(&self) -> Option<(String, u16)> {
        self.renderer
            .lock()
            .unwrap()
            .as_ref()
            .map(|s| (s.friendly_name.clone(), s.port))
    }

    pub async fn take_dmr_command_rx(&self) -> Option<mpsc::Receiver<DmrCommand>> {
        self.dmr_rx.lock().await.take()
    }

    #[allow(dead_code)]
    pub async fn dmr_next_command(&self, timeout_ms: u64) -> Option<DmrCommand> {
        let mut guard = self.dmr_rx.lock().await;
        let rx = guard.as_mut()?;
        tokio::select! {
            cmd = rx.recv() => cmd,
            _ = tokio::time::sleep(std::time::Duration::from_millis(timeout_ms)) => None,
        }
    }
}

fn build_didl(
    media_url: &str,
    cover_url: Option<&str>,
    title: &str,
    artist: &str,
    album: &str,
    duration: &str,
) -> String {
    let cover = cover_url
        .map(|u| {
            format!(
                "<upnp:albumArtURI>{}</upnp:albumArtURI>",
                soap::xml_escape(u)
            )
        })
        .unwrap_or_default();
    format!(
        r#"<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="0" restricted="1"><dc:title>{title}</dc:title><dc:creator>{artist}</dc:creator><upnp:artist>{artist}</upnp:artist><upnp:album>{album}</upnp:album><upnp:class>object.item.audioItem.musicTrack</upnp:class><res duration="{duration}">{url}</res>{cover}</item></DIDL-Lite>"#,
        title = soap::xml_escape(title),
        artist = soap::xml_escape(artist),
        album = soap::xml_escape(album),
        url = soap::xml_escape(media_url),
        duration = soap::xml_escape(duration),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn didl_contains_metadata() {
        let d = build_didl(
            "http://1.2.3.4/media/t",
            Some("http://1.2.3.4/media/cover/t"),
            "歌名<A>",
            "歌手",
            "专辑",
            "0:03:21",
        );
        assert!(d.contains("object.item.audioItem.musicTrack"));
        assert!(d.contains("歌名&lt;A&gt;"));
        assert!(d.contains("duration=\"0:03:21\""));
        assert!(d.contains("albumArtURI"));
    }

    #[test]
    fn didl_without_cover() {
        let d = build_didl("http://x", None, "t", "a", "b", "0:00:30");
        assert!(!d.contains("albumArtURI"));
    }
}
