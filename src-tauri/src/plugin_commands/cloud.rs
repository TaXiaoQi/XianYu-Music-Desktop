// 网盘业务代理命令：TS 经本命令调用内嵌的 crate::cloud 十盘业务实现
//（同步自移动端 rust/src/cloud）。登录类操作留在 TS 侧，不走本命令。

/// 网盘业务代理（十盘统一入口）。`req_json` 为 {provider, op, cred, params}
/// JSON；返回 {result, rotated_cred?} 的 JSON；业务失败 Err(中文文案) 直接
/// 透传给前端。
#[tauri::command]
pub async fn cloud_proxy(req_json: String) -> Result<String, String> {
    let req = crate::cloud::types::CloudReq::parse(&req_json).map_err(|(_, m)| m)?;
    crate::cloud::dispatch(req)
        .await
        .map_err(|(_, m)| m)
        .and_then(|v| serde_json::to_string(&v).map_err(|e| e.to_string()))
}
