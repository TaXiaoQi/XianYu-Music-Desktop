# 桌面端在线更新检查功能

## Context（背景）

桌面端当前「检查更新」走 GitHub Releases API（`src/utils/update.ts` 的 `fetchLatestRelease`），与自建后台完全脱节，且 GitHub API 在国内访问不稳定。后台虽有「版本管理」页，但那是**安卓 APP 上传 .apk 文件**模式（`app_versions` 表 + 文件上传），不适合桌面端「手填版本号 + 下载链接」的需求。

用户要求：后台手填版本号和下载链接 → 桌面端启动自动检查 → 版本号过低弹更新提示 → 关于页可见版本信息。架构复用已验证的**公告系统 JSON 文件模式**（免签公开读取、不依赖数据库签名、简单可靠）。

数据源决策：**仅自建后台**（移除 GitHub 更新检查流程）。
后台配置位置：**复用「版本管理」页顶部**加配置卡片（不新增菜单）。

---

## 方案（JSON 文件模式，与公告系统一致）

### 一、后端（自建服务器）

#### 1. 新建 `网页端/后台/chaoguan/public/api/version.json`
单对象数据文件（非列表，桌面端只需「最新一条」）：
```json
{"version":"","downloadUrl":"","updateContent":"","enabled":false,"updated_at":""}
```

#### 2. 新建 `网页端/后台/chaoguan/public/api/version.php`（公开免签读取接口）
仿 `api/announcement.php`：CORS 全开、`Cache-Control: no-cache`、OPTIONS 预检。读取 `version.json`，`enabled=true` 时返回：
```json
{"code":200,"msg":"ok","data":{"version":"1.2.0","downloadUrl":"https://...","updateContent":"...","updatedAt":"2026-08-01 12:00:00"}}
```
`enabled=false` 或文件不存在时 `data:null`。

#### 3. 修改 `网页端/后台/chaoguan/public/index.php`
仿公告的 `readAnnouncementsJson/writeAnnouncementsJson`（[index.php:1487-1513](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/网页端/后台/chaoguan/public/index.php#L1487-L1513)），新增：
- `desktopVersionJsonPath()` → `api/version.json`
- `readDesktopVersion()` / `writeDesktopVersion($data)`（临时文件 + rename 原子写入）
- `saveDesktopVersion()`：接收 POST `version/downloadUrl/updateContent/enabled`，校验非空，写 JSON，刷新 `updated_at`
- `getDesktopVersion()`：返回当前配置（供后台表单回填）
- 路由 `case 'save_desktop_version'` / `case 'get_desktop_version'`（加在 [index.php:82-84](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/网页端/后台/chaoguan/public/index.php#L82-L84) version 路由旁）

#### 4. 修改 `网页端/后台/chaoguan/public/pages/version.php`
在现有「版本管理」表格**上方**插入一个「桌面端在线更新」配置卡片：
- 表单字段：版本号、下载链接、更新内容（textarea）、启用状态（select）
- 页面加载时 PHP 直接读 `api/version.json` 回填
- 保存按钮 AJAX 调 `api({action:'save_desktop_version', ...})`
- 提示文字说明：「桌面端启动时自动比对版本号，低于此版本将提示更新」
- JS 函数 `saveDesktopVersion()` 加在 [index.php:3450](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/网页端/后台/chaoguan/public/index.php#L3450) version 的 JS 块里

### 二、前端（桌面端）

#### 5. 修改 `src/utils/update.ts`
- 新增 `SERVER_VERSION_URL = 'https://xy.zh2026.cn/chaoguan/public/api/version.php'`
- 新增 `interface ServerUpdateInfo { version, downloadUrl, updateContent, updatedAt }`
- 新增 `fetchServerUpdate(): Promise<ServerUpdateInfo | null>`：全局 fetch + `AbortSignal.timeout(15000)`，返回 data 或 null（仿 [announcement.ts:24-63](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src/utils/announcement.ts#L24-L63)）
- **保留** `compareVersions` / `extractVersion`（复用）
- **保留** `fetchLatestRelease`（GitHub）函数不删（避免破坏引用），但检查更新流程不再调用它

#### 6. 新建 `src/composables/useUpdateCheck.ts`
模块级单例，仿 [useAnnouncement.ts](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src/composables/useAnnouncement.ts) 结构：
- 状态：`updateVisible`、`latestUpdate: ServerUpdateInfo | null`
- `checkUpdateOnStartup()`：fetch → `compareVersions(server.version, APP_VERSION) > 0` 且 `server.version !== 忽略记录` → 显示弹窗
- `checkUpdateManual()`：关于页用，强制比对（不判忽略），无更新 toast「已是最新版本」
- `closeUpdate()` / `openDownload()`（`openUrl` 打开 downloadUrl）
- 忽略机制：localStorage key `update_ignored_version`，点「稍后」记录当前 server.version，下次启动同版本不弹（新版本会重新弹）

#### 7. 新建 `src/components/overlays/UpdateModal.vue`
仿 [AnnouncementModal.vue](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src/components/overlays/AnnouncementModal.vue) 样式（update 类型绿色图标），显示：
- 标题「发现新版本 vX.X.X」+ 当前版本对比
- 更新内容（whitespace-pre-line）
- 底部两按钮：「稍后」（关闭+记录忽略）、「前往下载」（openUrl downloadUrl）

#### 8. 修改 `src/components/layout/MainShell.vue`
- 导入 `useUpdateCheck` 和异步组件 `UpdateModal`
- [onMounted:63-67](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src/components/layout/MainShell.vue#L63-L67) 在 `checkAnnouncement()` 旁加 `checkUpdateOnStartup()`
- 模板挂载 `<UpdateModal>`

#### 9. 修改 `src/components/settings/SettingsAbout.vue`
- 「检查更新」按钮 [handleCheckUpdate:59-113](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src/components/settings/SettingsAbout.vue#L59-L113) 改用 `checkUpdateManual()`（自建后台），移除 GitHub `fetchLatestRelease` 调用
- 保留现有 dialog 逻辑或改用全局 UpdateModal（推荐复用 UpdateModal，统一体验）
- 版本号显示 `v{{ appVersion }}` 保持

### 三、版本比对规则
- `compareVersions(extractVersion(serverVersion), extractVersion(APP_VERSION))`
  - `>0`：有更新 → 弹窗
  - `=0`：版本一致 → 正常，不弹
  - `<0`：后台版本更低 → 忽略（不弹）
- APP_VERSION='1.1.0-bate1' → extractVersion 提取 '1.1.0'，后台填 '1.2.0' 等纯数字版本号

---

## 改动文件清单

| 类型 | 文件 |
|---|---|
| 新建 | `网页端/后台/chaoguan/public/api/version.json` |
| 新建 | `网页端/后台/chaoguan/public/api/version.php` |
| 新建 | `src/composables/useUpdateCheck.ts` |
| 新建 | `src/components/overlays/UpdateModal.vue` |
| 修改 | `网页端/后台/chaoguan/public/index.php`（+接口/路由/JS） |
| 修改 | `网页端/后台/chaoguan/public/pages/version.php`（+配置卡片） |
| 修改 | `src/utils/update.ts`（+fetchServerUpdate） |
| 修改 | `src/components/layout/MainShell.vue`（+启动检查/挂弹窗） |
| 修改 | `src/components/settings/SettingsAbout.vue`（检查更新改自建） |

## 验证

1. **后台**：版本管理页顶部卡片填版本号 `1.2.0` + 下载链接 + 更新内容 + 启用 → 保存 → 刷新页面确认回填
2. **服务器**：浏览器访问 `https://xy.zh2026.cn/chaoguan/public/api/version.php` → 返回 `code:200` + data
3. **typecheck**：`npm run typecheck` 无错误
4. **桌面端启动**：APP_VERSION=1.1.0-bate1 < 1.2.0 → 自动弹 UpdateModal；点「稍后」→ 重启不弹同版本；后台改 1.3.0 → 重启重新弹
5. **关于页**：点「检查更新」→ 弹 UpdateModal（有更新）/ toast「已是最新版本」（版本一致）
6. **边界**：后台 enabled=false → 启动不弹、关于页提示「已是最新版本」；后台版本低于前端 → 不弹

## 部署
- 后端：上传 `index.php` + `api/version.php` + `api/version.json` + `pages/version.php` 到服务器
- 前端：`useUpdateCheck.ts`/`UpdateModal.vue`/`MainShell.vue`/`SettingsAbout.vue`/`update.ts` 需重新构建发布 APP
