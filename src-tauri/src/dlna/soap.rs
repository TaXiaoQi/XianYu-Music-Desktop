pub fn envelope(service: &str, action: &str, inner_args: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:{action} xmlns:u="{service}">{inner_args}</u:{action}></s:Body></s:Envelope>"#
    )
}

pub async fn soap_call(
    client: &reqwest::Client,
    control_url: &str,
    service: &str,
    action: &str,
    inner_args: &str,
) -> Result<String, String> {
    let body = envelope(service, action, inner_args);
    let resp = client
        .post(control_url)
        .header("SOAPACTION", format!("\"{service}#{action}\""))
        .header("CONTENT-TYPE", "text/xml; charset=\"utf-8\"")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("SOAP {action} 请求失败: {e}"))?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let fault = extract_tag(&text, "faultstring").unwrap_or_default();
        return Err(format!(
            "SOAP {action} 失败(HTTP {status}): {}",
            fault.trim()
        ));
    }
    Ok(text)
}

pub fn extract_tag(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}");
    let start = xml.to_ascii_lowercase().find(&open.to_ascii_lowercase())?;
    let gt = xml[start..].find('>')? + start;
    if xml.as_bytes().get(gt - 1) == Some(&b'/') {
        return Some(String::new());
    }
    let close = format!("</{}>", tag);
    let lower = xml[gt + 1..].to_ascii_lowercase();
    let end = lower.find(&close.to_ascii_lowercase())? + gt + 1;
    Some(xml[gt + 1..end].to_string())
}

pub fn parse_action_header(value: Option<&str>) -> Option<String> {
    let v = value?.trim().trim_matches('"');
    let action = v.rsplit('#').next()?.trim().to_string();
    if action.is_empty() {
        None
    } else {
        Some(action)
    }
}

pub fn arg(xml: &str, name: &str) -> String {
    extract_tag(xml, name).unwrap_or_default()
}

pub fn format_upnp_time(secs: f64) -> String {
    let total = secs.max(0.0).round() as u64;
    let h = total / 3600;
    let m = (total % 3600) / 60;
    let s = total % 60;
    format!("{h}:{m:02}:{s:02}")
}

pub fn parse_upnp_time(s: &str) -> Option<f64> {
    let s = s.trim();
    if s.is_empty() || s == "NOT_IMPLEMENTED" {
        return None;
    }
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() < 3 {
        return None;
    }
    let h: f64 = parts[0].trim().parse().ok()?;
    let m: f64 = parts[1].trim().parse().ok()?;
    let sec: f64 = parts[2].trim().parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + sec)
}

pub fn xml_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(c),
        }
    }
    out
}

pub fn xml_unescape(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&#34;", "\"")
        .replace("&amp;", "&")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelope_contains_action_and_service() {
        let e = envelope("urn:AVT", "Play", "<InstanceID>0</InstanceID>");
        assert!(e.contains("<u:Play xmlns:u=\"urn:AVT\">"));
        assert!(e.contains("<InstanceID>0</InstanceID>"));
    }

    #[test]
    fn extract_tag_handles_attrs_and_case() {
        let xml = r#"<root><TrackDuration a="1">0:03:21</TrackDuration><missing/></root>"#;
        assert_eq!(
            extract_tag(xml, "TrackDuration").as_deref(),
            Some("0:03:21")
        );
        assert_eq!(extract_tag(xml, "missing").as_deref(), Some(""));
        assert_eq!(extract_tag(xml, "nope"), None);
    }

    #[test]
    fn parse_action_header_tolerates_quotes_and_case() {
        assert_eq!(
            parse_action_header(Some("\"urn:schemas-upnp-org:service:AVTransport:1#Play\""))
                .as_deref(),
            Some("Play")
        );
        assert_eq!(
            parse_action_header(Some("urn:x#GetPositionInfo")).as_deref(),
            Some("GetPositionInfo")
        );
        assert_eq!(parse_action_header(None), None);
    }

    #[test]
    fn upnp_time_roundtrip() {
        assert_eq!(format_upnp_time(201.0), "0:03:21");
        assert_eq!(format_upnp_time(3661.0), "1:01:01");
        assert!((parse_upnp_time("1:01:01").unwrap() - 3661.0).abs() < 0.001);
        assert_eq!(parse_upnp_time("0:00"), None);
    }

    #[test]
    fn xml_escape_all_entities() {
        assert_eq!(xml_escape(r#"a<&>"'"#), "a&lt;&amp;&gt;&quot;&apos;");
    }
}
