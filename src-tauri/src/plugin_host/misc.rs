use std::sync::{Arc, Mutex as StdMutex};

use rquickjs::{CatchResultExt, CaughtError, Ctx, FromJs, Promise};

use super::EngineLog;

pub(super) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn json_quote(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".to_string())
}

pub(super) fn take_logs(logs: &Arc<StdMutex<Vec<EngineLog>>>, call_id: u64) -> Vec<EngineLog> {
    let mut guard = logs.lock().unwrap();
    let mut out = Vec::new();
    guard.retain(|entry| {
        if entry.call_id == call_id {
            out.push(entry.clone());
            false
        } else {
            true
        }
    });
    out
}

// ==================== zlib 桥实现 ====================

pub(super) fn inflate_bytes(method: &str, data: &[u8]) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let mut out = Vec::new();
    let effective = match method {
        "gzip" | "zlib" | "raw" => method,
        _ => {
            if data.len() >= 2 && data[0] == 0x1f && data[1] == 0x8b {
                "gzip"
            } else if !data.is_empty() && data[0] == 0x78 {
                "zlib"
            } else {
                "raw"
            }
        }
    };
    match effective {
        "gzip" => {
            let mut d = flate2::read::GzDecoder::new(data);
            d.read_to_end(&mut out).map_err(|e| e.to_string())?;
        }
        "zlib" => {
            let mut d = flate2::read::ZlibDecoder::new(data);
            d.read_to_end(&mut out).map_err(|e| e.to_string())?;
        }
        _ => {
            let mut d = flate2::read::DeflateDecoder::new(data);
            d.read_to_end(&mut out).map_err(|e| e.to_string())?;
        }
    }
    Ok(out)
}

pub(super) fn deflate_bytes(method: &str, data: &[u8]) -> Result<Vec<u8>, String> {
    use std::io::Write;
    match method {
        "gzip" => {
            let mut e = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
            e.write_all(data).map_err(|e| e.to_string())?;
            e.finish().map_err(|e| e.to_string())
        }
        "zlib" => {
            let mut e = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
            e.write_all(data).map_err(|e| e.to_string())?;
            e.finish().map_err(|e| e.to_string())
        }
        _ => {
            let mut e =
                flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
            e.write_all(data).map_err(|e| e.to_string())?;
            e.finish().map_err(|e| e.to_string())
        }
    }
}

pub(super) fn json_error(message: &str) -> String {
    format!("{{\"ok\":false,\"error\":{}}}", json_quote(message))
}

pub(super) fn engine_error_message<'js>(ctx: &Ctx<'js>, e: &rquickjs::Error) -> String {
    if matches!(e, rquickjs::Error::Exception) {
        let v = ctx.catch();
        if v.is_null() || v.is_undefined() {
            return "QuickJS 异常（无详情）".to_string();
        }
        let msg = v
            .clone()
            .into_exception()
            .and_then(|exc| exc.message())
            .filter(|m| !m.is_empty())
            .unwrap_or_else(|| "QuickJS 异常（无消息）".to_string());
        let stack = v
            .as_object()
            .and_then(|obj| obj.get::<_, String>("stack").ok())
            .unwrap_or_default();
        if stack.is_empty() {
            msg
        } else {
            format!("{}\n{}", msg, stack)
        }
    } else {
        e.to_string()
    }
}

pub(super) async fn promise_to_json<'js>(ctx: &Ctx<'js>, promise: Promise<'js>) -> rquickjs::Result<String> {
    match promise.into_future::<String>().await.catch(ctx) {
        Ok(s) => Ok(s),
        Err(CaughtError::Exception(exc)) => {
            let msg = exc.message().unwrap_or_else(|| "未知异常".to_string());
            let stack = (&exc as &rquickjs::Object)
                .get::<_, String>("stack")
                .ok()
                .filter(|s| !s.is_empty());
            match stack {
                Some(st) => Ok(json_error(&format!("{}\n——stack——\n{}", msg, st))),
                None => Ok(json_error(&msg)),
            }
        }
        Err(CaughtError::Value(v)) => {
            if let Ok(s) = rquickjs::String::from_js(ctx, v) {
                if let Ok(text) = s.to_string() {
                    return Ok(json_error(&text));
                }
            }
            Ok(json_error("未知异常"))
        }
        Err(CaughtError::Error(e)) => Ok(json_error(&e.to_string())),
    }
}
