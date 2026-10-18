// 网盘业务执行桥：TS 经 tauri command cloud_proxy 调内嵌 Rust 实现
// （src-tauri/src/cloud 十盘业务，同步自移动端）。
//
// 各盘 provider 的业务方法经本文件的 rust* 函数一行转发，rust 是唯一
// 实现：失败直接抛 CloudException（文案来自 Rust 错误通道，中文面向
// 用户），无本地回退。请求/响应沿用 Server 版契约：
// reqJson = {provider, op, cred, params}；响应 = {result, rotated_cred?}。
//
// 凭据轮换：rust 刷新的凭据（如阿里 refresh_token）经响应顶层
// rotated_cred 带回，本文件负责回写本地凭据存储。

import { tauriInvoke } from '../tauri/invoke';
import { CloudCredentialsStore } from './cloudCredentialsStore';
import {
  CloudDirectLink,
  CloudException,
  CloudFile,
  CloudListResult,
  CloudShareParse,
} from './cloudTypes';

type Cred = Record<string, string>;

function toRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** rotated_cred 回写：rust 刷新的凭据落盘。
 * accountId 定位规则：cred 内冗余的 accountId 键（阿里登录时存入）；
 * 免登录分享直链无凭据，跳过回写。 */
async function _applyRotatedCred(
  provider: string,
  cred: Cred,
  data: Record<string, unknown>,
): Promise<void> {
  const rotated = toRecord(data['rotated_cred']);
  if (!rotated || Object.keys(rotated).length === 0) return;
  const accountId = cred['accountId'] ?? '';
  if (accountId === '' || accountId === '_') return;
  const mapped: Record<string, string> = {};
  for (const [k, v] of Object.entries(rotated)) {
    mapped[k] = v == null ? '' : String(v);
  }
  await CloudCredentialsStore.instance.updateCred(provider, accountId, mapped);
}

/** 公共执行器：构造 reqJson → cloud_proxy → 解包出顶层载荷。
 * cred 可空（免登录分享链路），空时传 {}。 */
async function _callRust(
  provider: string,
  op: string,
  cred: Cred | null,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const reqJson = JSON.stringify({ provider, op, cred: cred ?? {}, params });
  let out: string;
  try {
    out = await tauriInvoke('cloud_proxy', { reqJson });
  } catch (e) {
    // Tauri 对 command Result<_, String> 错误通道直接 reject String
    //（即 rust 中文文案）；其余异常（IPC 内部错误等）取 message。
    throw new CloudException(
      typeof e === 'string' ? e : e instanceof Error ? e.message : String(e),
    );
  }
  let data: unknown;
  try {
    data = JSON.parse(out);
  } catch {
    throw new CloudException('网盘数据解析失败');
  }
  const rec = toRecord(data);
  if (!rec) throw new CloudException('网盘数据解析失败');
  await _applyRotatedCred(provider, cred ?? {}, rec);
  return rec;
}

/** result 载荷防御读取；缺失视为数据异常。 */
function _resultOf(data: Record<string, unknown>): Record<string, unknown> {
  const result = toRecord(data['result']);
  if (!result) throw new CloudException('网盘数据解析失败');
  return result;
}

function _filesFrom(result: Record<string, unknown>): CloudFile[] {
  const list = result['files'];
  return Array.isArray(list) ? list.map((j) => CloudFile.fromJson(j)) : [];
}

function _listResultFrom(result: Record<string, unknown>): CloudListResult {
  const cursor = result['nextCursor'] == null ? '' : String(result['nextCursor']);
  return new CloudListResult({
    files: _filesFrom(result),
    nextCursor: cursor === '' ? null : cursor,
  });
}

function _shareParseFrom(result: Record<string, unknown>): CloudShareParse {
  return new CloudShareParse({
    providerId: result['providerId'] == null ? '' : String(result['providerId']),
    files: _filesFrom(result),
    shareId: result['shareId'] != null ? String(result['shareId']) : null,
    shareToken: result['shareToken'] != null ? String(result['shareToken']) : null,
    passcode: result['passcode'] != null ? String(result['passcode']) : null,
    directPlayable: result['directPlayable'] === true,
  });
}

function _directLinkFrom(result: Record<string, unknown>): CloudDirectLink {
  const headersRec = toRecord(result['headers']);
  const headers: Record<string, string> = {};
  if (headersRec) {
    for (const [k, v] of Object.entries(headersRec)) {
      headers[k] = v == null ? '' : String(v);
    }
  }
  const expireMs = typeof result['expireAt'] === 'number' ? result['expireAt'] : null;
  return new CloudDirectLink({
    url: result['url'] == null ? '' : String(result['url']),
    headers,
    fileName: result['fileName'] != null ? String(result['fileName']) : null,
    size: typeof result['size'] === 'number' ? Math.trunc(result['size']) : null,
    expireAt: expireMs == null ? null : new Date(expireMs),
  });
}

/** 转存/免转存直链的 share 载荷（对齐 rust 侧 param_obj('share') 读取）。 */
function _sharePayload(share: CloudShareParse): Record<string, unknown> {
  return {
    shareId: share.shareId,
    shareToken: share.shareToken,
    passcode: share.passcode,
    files: share.files.map((f) => f.toJson()),
  };
}

/** 凭据有效性检查。 */
export async function rustValidate(provider: string, cred: Cred): Promise<boolean> {
  const data = await _callRust(provider, 'validate', cred, {});
  const result = toRecord(data['result']);
  return result != null && result['valid'] === true;
}

/** 列目录。 */
export async function rustListDir(
  provider: string,
  cred: Cred,
  path: string,
  cursor?: string | null,
): Promise<CloudListResult> {
  const data = await _callRust(provider, 'list_dir', cred, {
    path,
    ...(cursor != null && cursor !== '' ? { cursor } : {}),
  });
  return _listResultFrom(_resultOf(data));
}

/** 按 id 查文件/目录名（仅支持该 op 的盘返回；失败返回 null）。 */
export async function rustFileName(provider: string, cred: Cred, fileId: string): Promise<string | null> {
  try {
    const data = await _callRust(provider, 'file_get', cred, { file_id: fileId });
    const result = toRecord(data['result']);
    const name = result != null && result['name'] != null ? String(result['name']) : '';
    return name === '' ? null : name;
  } catch {
    return null;
  }
}

/** 全盘文件名搜索（仅 supportsSearch 的盘转发）。 */
export async function rustSearchFiles(
  provider: string,
  cred: Cred,
  keyword: string,
  cursor?: string | null,
): Promise<CloudListResult> {
  const data = await _callRust(provider, 'search_files', cred, {
    keyword,
    ...(cursor != null && cursor !== '' ? { cursor } : {}),
  });
  return _listResultFrom(_resultOf(data));
}

/** 分享链接解析。绝大多数盘免凭据；需登录态的盘（如百度）经 cred 携带。 */
export async function rustParseShare(
  provider: string,
  url: string,
  pwd: string | null,
  cred?: Cred | null,
): Promise<CloudShareParse> {
  const data = await _callRust(provider, 'parse_share', cred ?? null, {
    url,
    ...(pwd != null && pwd !== '' ? { pwd } : {}),
  });
  return _shareParseFrom(_resultOf(data));
}

/** 转存分享文件。 */
export async function rustTransferShare(
  provider: string,
  cred: Cred,
  share: CloudShareParse,
): Promise<CloudFile[]> {
  const data = await _callRust(provider, 'transfer_share', cred, {
    share: _sharePayload(share),
  });
  return _filesFrom(_resultOf(data));
}

/** 我的网盘文件直链。 */
export async function rustDirectLink(
  provider: string,
  cred: Cred,
  file: CloudFile,
): Promise<CloudDirectLink> {
  const data = await _callRust(provider, 'direct_link', cred, {
    file: file.toJson(),
  });
  return _directLinkFrom(_resultOf(data));
}

/** 分享文件免转存直链。 */
export async function rustShareDirectLink(
  provider: string,
  cred: Cred | null,
  share: CloudShareParse,
  file: CloudFile,
): Promise<CloudDirectLink> {
  const data = await _callRust(provider, 'share_direct_link', cred ?? null, {
    share: _sharePayload(share),
    file: file.toJson(),
  });
  return _directLinkFrom(_resultOf(data));
}
