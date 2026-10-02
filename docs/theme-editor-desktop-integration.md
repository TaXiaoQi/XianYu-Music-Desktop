# 主题编辑器 · Desktop 接入文档

> 面向 `XianYu-Music-Desktop` 的主题编辑器 / 主题中心实现交接。
> 基线：`dc291bc6`（`main`，2026-09-30）。本文所有 Desktop 现状均从该基线代码核实。
> **2026-10 更新**：主题包 v3（每页独立壁纸）已三端落地，新增契约见 §11；
> §3.1「禁止内嵌媒体」、§4.1 版本锁定、§7 壁纸联动的限制自 v3 起部分废止，以 §11 为准。
>
> 已确定的边界：服务端现有 `list_themes` / `my_themes` / `upload_theme` 三个 action；
> Desktop **不新增渲染通道**，主题应用必须写入既有 `ThemeSettings`。
> 「我的下载」不做独立 Tab——若未来 Desktop 需要下载历史，另行做产品设计，不能照搬已废弃的四 Tab 方案。

---

## 0. 一句话结论

Desktop 已经有完整的外观设置和全局生效链路，主题编辑器应当只是：

1. 从当前 `ThemeSettings` 取**允许分享的外观字段**生成草稿；
2. 预览、编辑、保存为 v2/v3 `platform: "desktop"` 的主题包；
3. 应用时把包的 payload 转回 `ThemeSettingsPatch`，经 `replaceTheme` / `patchTheme` 写回；
4. 主题广场通过 `signedRequest` 读写服务端，响应 `data` **直接是数组**。

**不要**创建第二套 CSS 变量、Pinia store 或本地渲染器。现有全局同步已经负责：
根节点深浅类、强调色、原生窗口主题、窗口材质与焦点恢复后的材质重推。

---

## 1. 已有架构地图

| 能力 | 已有位置 | 接入时怎么用 |
|---|---|---|
| Desktop 主题完整模型 | [ThemeSettings](../src/types/index.ts#L250-L293) | 主题包 payload 的字段来源；**不要**直接把整个对象上传 |
| 默认值 | [defaultThemeSettings](../src/features/settings/store.ts#L147-L161) | 新建包 / 缺字段迁移 / 复位时的唯一基线 |
| 安全合并 | [mergeThemeSettings](../src/features/settings/store.ts#L410-L436) | 解析 theme payload 后的字段归一化路径 |
| 主题读写 API | [useThemeSettings](../src/composables/useThemeSettings.ts#L52-L113) | 应用包走 `replaceTheme`；局部调节走 `patchTheme` |
| 全局生效层 | [useAppThemeSync](../src/composables/useAppThemeSync.ts#L80-L109)、[L191-L211](../src/composables/useAppThemeSync.ts#L191-L211) | **不修改**；只要既有主题 store 改变就自动生效 |
| 外观设置页 | [SettingsTheme.vue](../src/components/settings/SettingsTheme.vue#L207-L264) | 主题中心 / 编辑器入口放在这里 |
| 自定义皮肤草稿 | [useCustomThemeModal](../src/composables/useCustomThemeModal.ts#L40-L90) | 可复用“快照 + 草稿 + 取消回滚”的思路；不建议直接塞入新职责 |
| 自定义皮肤 UI | [CustomSkinModal.vue](../src/components/settings/CustomSkinModal.vue#L52-L105) | 可复用预览与媒体选择子组件；主题编辑器建议独立组件 |
| 壁纸广场与本地下载记录 | [WallpaperGallery.vue](../src/components/settings/WallpaperGallery.vue#L116-L194)、[L475-L547](../src/components/settings/WallpaperGallery.vue#L475-L547) | 主题携带推荐壁纸时的唯一既有先例 |
| 认证签名请求 | [signedRequest](../src/services/auth/authHttp.ts#L48-L67) | 主题广场三条 API 均复用；成功后直接返回 `data` |
| 全局弹窗入口 | [ui store](../src/shared/stores/ui.ts#L7-L35)、[GlobalDialogLayer](../src/components/layout/shell/GlobalDialogLayer.vue#L1-L30)、[lazy overlays](../src/components/layout/shell/lazyShellOverlays.ts#L1-L22) | 新主题编辑器若是全局弹层，按此处登记与惰性加载 |
| 测试工具链 | [package.json](../package.json#L7-L31) | `npm run typecheck`、`npm test`、`npm run build` |

### 1.1 现有主题状态的关键行为

- `mode: 'custom'` 会强制关闭动态背景和窗口材质：
  [setThemeMode](../src/composables/useThemeSettings.ts#L67-L75)。
- `windowMaterial !== 'none'` 会强制关闭动态背景：
  [setWindowMaterial](../src/composables/useThemeSettings.ts#L98-L102)。
- `customBackground.foregroundStyle` 会参与实际深浅色解析：
  [resolvesToDarkSurface](../src/composables/useThemeSettings.ts#L44-L50)。
- 自定义皮肤取消会整体 `replaceTheme` 回滚；保存才通过 `patchTheme` 写入：
  [useCustomThemeModal](../src/composables/useCustomThemeModal.ts#L70-L81)。

因此主题编辑器不能把 `ThemeSettings` 当成一堆互不相关的颜色值；它存在这些互斥与联动规则。

---

## 2. 服务端契约（已存在，Desktop 尚未接）

服务端当前主题接口与移动端已接入的契约一致：

| action | 请求体 | 成功 `data` | Desktop 用途 |
|---|---|---|---|
| `list_themes` | `{ platform: 'desktop' }` | `Theme[]` 数组，只含 `status='normal'` | 主题广场 |
| `my_themes` | `{ ciyuanxi_id, platform: 'desktop' }` | `Theme[]` 数组，含待审核项 | 我的上传 |
| `upload_theme` | 见 §5 | `{ id, status, previewUrl }` | 发布主题 |

### 2.1 最容易踩的接口坑

**列表响应的 `data` 是数组，不是 `{ list: [...] }`。** Desktop 的
`signedRequest<T>()` 会原样返回 `payload.data`（[authHttp.ts](../src/services/auth/authHttp.ts#L35-L66)），
因此应调用：

```ts
const data = await signedRequest<Record<string, unknown>[]>(
  'list_themes',
  { platform: 'desktop' },
)
const themes = Array.isArray(data) ? data.map(normalizeRemoteTheme) : []
```

不要额外取 `data.list`，也不要让接口模型约定成 Map。

### 2.2 远端主题条目字段

条目使用 camelCase：

```ts
interface RemoteTheme {
  id: number
  name: string
  description: string
  platform: 'desktop'
  theme: DesktopThemePackageV2
  previewUrl: string
  thumbnailUrl: string
  uploaderId: string
  uploaderNickname: string
  status: 'normal' | 'pending' | 'rejected' | 'disabled' | string
  reviewedAt: string | null
  reviewedBy: string
  createdAt: string | null
}
```

远端字段 `theme` 是完整主题包，而非仅 `payload`。应用前应做平台、版本（v2|v3，见 §11）和字段白名单校验（见 §4）。

---

## 3. 必须先定的范围：什么能成为“可分享主题”

`ThemeSettings` 同时混有**外观**、**播放偏好**、**窗口能力偏好**和**本机路径**。
把整个对象序列化上传会带来副作用：应用别人主题可能改掉用户的托盘菜单、排行榜、播放页开关，或者把发送者的本机路径写到接收者机器上。

### 3.1 推荐：分享字段白名单

第一版仅导出 / 导入下列视觉字段：

```ts
type DesktopThemePayloadV2 = Pick<ThemeSettings,
  | 'mode'
  | 'accentColor'
  | 'dynamicBgType'
  | 'windowMaterial'
  | 'keepWindowMaterialOnBlur'
  | 'useGlassSwitch'
  | 'flowColorBoost'
  | 'flowDepth'
  | 'flowSpeed'
  | 'flowTexture'
  | 'windowBlurTint'
  | 'playerDetailStyle'
  | 'playerDetailMeshBackground'
  | 'playerDetailMeshAntiAlias'
  | 'playerDetailMeshSpeed'
  | 'playerDetailVinylMaterial'
>
```

**不要**导出这些字段：

| 字段 | 原因 |
|---|---|
| `customBgPath` / `customBackground.imagePath` | 本机绝对路径或主题缓存路径，另一台机器不可用 |
| `customBackground.imageWidth` / `imageHeight` / `translateX` / `translateY` / `scale` | 依赖具体媒体尺寸，脱离原图没有意义 |
| `mode: 'custom'` 与无媒体的 `customBackground` | `custom` 的语义就是自定义媒体皮肤；无本机媒体应用后会产生残缺状态 |
| `useCustomTrayMenu` / `showLeaderboard` | 产品 / 行为偏好，不应因应用外观包被改变 |
| `playerDetailCoverBehavior` / `lastPlayerDetailCoverVisible` | 用户的播放详情交互偏好，不是共享外观 |

> v2 时代若产品坚持主题可带壁纸，只能携带 `wallpaperRef: { id }`。**v3 起该限制废止**：
> `payload.wallpapers` 允许内嵌 data URL 或远程 URL 壁纸，见 §11。

### 3.2 第一版建议禁用的组合

编辑器初始化或保存时应归一化：

- `mode === 'custom'`：提示用户“自定义媒体皮肤不能上传为跨端主题”；转为 `dark` / `light` 后才能发布。
- `windowMaterial !== 'none'`：`dynamicBgType` 自动归零；应复用现有的互斥语义，而非保存矛盾值。
- `mode === 'custom'`：`windowMaterial` 和 `dynamicBgType` 都必须是 `none`。

不要在编辑器里自己复制互斥逻辑；组装最终 patch 时仍应经过
[mergeThemeSettings](../src/features/settings/store.ts#L410-L436) / `useThemeSettings` 的既有通道。

---

## 4. 建议新增的包模型与纯函数

建议新建目录：`src/features/theme/`。它与 `features/settings` 同层，避免把远端 DTO、包解析、编辑器草稿塞进庞大的设置 store。

建议文件：

```text
src/features/theme/
  themePackage.ts         // DTO、版本/平台校验、payload 白名单、序列化与反序列化
  themePackage.test.ts    // 纯函数单测
  remoteTheme.ts          // list_themes / my_themes 的条目归一化（可与上合并）
```

### 4.1 v2 Desktop 包格式

```ts
interface DesktopThemePackageV2 {
  version: 2
  platform: 'desktop'
  name: string
  author: string
  preview: string
  payload: DesktopThemePayloadV2
  wallpaperRef?: { id: number }
}
```

注意：Desktop 使用的字段名是 `mode`，不是移动端的 `themeMode`。两端由
`platform` 隔离，**不要**假装可以共享同一份 payload。

### 4.2 必要纯函数

```ts
function createDesktopThemePackage(
  theme: ThemeSettings,
  metadata: { name: string; author: string; preview: string },
): DesktopThemePackageV2

function parseDesktopThemePackage(value: unknown): DesktopThemePackageV2 | null

function packageToThemePatch(pkg: DesktopThemePackageV2): ThemeSettingsPatch

function normalizeRemoteTheme(value: Record<string, unknown>): RemoteTheme | null
```

关键约束：

- `parseDesktopThemePackage` 先检查 `version === 2`、`platform === 'desktop'`、`payload` 是对象；失败返回 `null`，不要抛异常。
- `packageToThemePatch` 只交出 §3.1 白名单字段；未知字段必须丢弃。
- `createDesktopThemePackage` 不能把 `customBackground.imagePath` 或任何本机媒体信息放入 payload。
- `accentColor` 必须走现有 `normalizeThemeColor`（`mergeThemeSettings` 已调用它），避免非法色值进入全局状态。

---

## 5. 主题编辑器实现建议

### 5.1 不要直接扩写 `CustomSkinModal`

[CustomSkinModal.vue](../src/components/settings/CustomSkinModal.vue#L1-L105) 的职责是“本机媒体皮肤”：

- 保存条件是 `preview.imagePath` 必须存在；
- 媒体从本机选择器或壁纸中心进入；
- 保存后进入 `mode: 'custom'`；
- 取消依赖全局 `skinModalOriginalTheme` 回滚。

这和“编辑可分享 Desktop 主题包”并不相同。推荐：

- 新建 `ThemeEditorModal.vue`，持有**独立编辑草稿**，不在滑块每次变更时修改全局主题；
- 点击“预览”可临时 `replaceTheme` 当前草稿，并保留进入编辑器前的完整 `ThemeSettings` 快照；
- 点击“应用 / 保存”才正式 `replaceTheme(packageToThemePatch(...))`；
- 点击取消时仅在发生过临时预览后恢复快照；
- 需要媒体选择 / 参数面板时，复用 [SkinPreviewStage](../src/components/settings/customSkin/SkinPreviewStage.vue)、[SkinAdjustmentPanel](../src/components/settings/customSkin/SkinAdjustmentPanel.vue) 或 [useSkinDraftMedia](../src/components/settings/customSkin/useSkinDraftMedia.ts#L18-L93) 的小部件/思路，但不要复用 `CustomSkinModal` 的全局状态。

### 5.2 推荐 UI 分层

```text
SettingsTheme.vue
  └─ “主题中心”入口
      └─ ThemeCenterModal.vue
          ├─ 本地预设 / 我的上传 / 广场（三 Tab）
          ├─ ThemeEditorModal.vue（新建 / 编辑 / 发布）
          └─ ThemePreviewCard.vue（本地与远端共用）
```

- 入口放在 [SettingsTheme.vue](../src/components/settings/SettingsTheme.vue#L251-L264) 的“自定义皮肤”附近，避免用户在多个设置页找外观功能。
- 若 `ThemeCenterModal` 是全局弹层，新增 `showThemeCenterModal` 到
  [ui store](../src/shared/stores/ui.ts#L7-L35)，再登记到
  [lazyShellOverlays.ts](../src/components/layout/shell/lazyShellOverlays.ts#L1-L22) 与
  [GlobalDialogLayer.vue](../src/components/layout/shell/GlobalDialogLayer.vue#L1-L30)。
- 若做设置页内嵌弹层，则不要新增全局 ui state；保持与现有 Settings 懒加载方式一致。

### 5.3 预览图与发布

`upload_theme` 需要可接受的 `preview` 图片数据。Desktop 编辑器应提供两种明确选择：

1. **推荐**：编辑器内生成可控的预览卡片，使用 canvas / DOM 截图生成 JPEG data URL；
2. **备选**：要求用户选一张 JPG / PNG / WEBP / GIF 预览图后上传。

不能拿 `customBackground.imagePath` 当预览：它可能是本机路径、视频或缓存文件，无法上传给服务端。

发布请求建议：

```ts
await signedRequest('upload_theme', {
  ciyuanxi_id: auth.user.ciyuanxi_id,
  nickname: auth.user.nickname ?? auth.user.username ?? '',
  name: package.name,
  description,
  platform: 'desktop',
  payload: package.payload,
  preview: previewDataUrl,
  ...(package.wallpaperRef ? { wallpaperRef: package.wallpaperRef } : {}),
})
```

服务端返回的 `status` 可能是 `normal` / `pending` / `rejected`；发布成功后切到“我的上传”并重新拉取，不能先假设必然上架。

---

## 6. 主题广场与“我的上传”

以 [WallpaperGallery.vue](../src/components/settings/WallpaperGallery.vue#L44-L80) 的状态分层为范本，但主题页面不需要复制壁纸的文件下载 / 删除逻辑。

### 6.1 建议状态

```ts
type ThemeTab = 'local' | 'browse' | 'mine'

const remoteThemes = ref<RemoteTheme[]>([])
const myThemes = ref<RemoteTheme[]>([])
const activeTab = ref<ThemeTab>('local')
const isLoading = ref(false)
const loadError = ref('')
```

- `browse`：首次进入调用 `list_themes`，只显示 `status === 'normal'`（服务端已经筛过，客户端仍可做防御性过滤）。
- `mine`：未登录时显示登录引导；已登录时传 `ciyuanxi_id + platform: 'desktop'` 调用 `my_themes`。
- `local`：第一版可以只放内置预设与“从当前设置新建”入口。**不要**照壁纸用
  `localStorage xianyu_downloaded_wallpapers_v1` 照搬“我的下载”——主题不产生文件下载，且本产品已决定不做该 Tab。

### 6.2 应用远端主题

```ts
const applyRemoteTheme = (item: RemoteTheme) => {
  const pkg = parseDesktopThemePackage(item.theme)
  if (!pkg) throw new Error('主题包格式不正确或不适用于桌面端')
  replaceTheme(mergeThemeSettings(createDefaultThemeSettings(), packageToThemePatch(pkg)))
}
```

说明：

- 基底用 `createDefaultThemeSettings()`，避免远端包未包含的字段继承用户当前的随机状态；
- 但最终必须仍通过 `replaceTheme`，而不是直接改 `theme.value`；
- 如果产品期望“未包含字段保持当前值”，才把基底换为当前 `theme.value`，该行为必须明确写入产品规格，不能凭感觉选。

**推荐默认值基底。** 主题包是完整外观方案，套用时应可复现；保留当前值会导致同一个包在不同用户机器上显示不同。

---

## 7. 推荐壁纸联动（v2 方案，已被 §11 的 v3 每页壁纸取代）

> **v3 起本节整体冻结**：主题包通过 `payload.wallpapers` 直接携带每页壁纸（含参数），
> 激活即生效，不再走「wallpaperRef + 壁纸中心下载」联动。以下内容仅作历史参考。

主题包只能携带：

```ts
wallpaperRef: { id: 123 }
```

不能携带本机路径、`file://` URL、视频 bytes 或 data URL。

当前壁纸本地记录的 key 为 `xianyu_downloaded_wallpapers_v1`，结构与文件下载 / 复用 / 删除逻辑可见于
[WallpaperGallery.vue](../src/components/settings/WallpaperGallery.vue#L174-L194) 和
[WallpaperGallery.vue](../src/components/settings/WallpaperGallery.vue#L475-L547)。

接入顺序：

1. 应用主题时检查 `wallpaperRef.id`；
2. 若该 id 已在本地壁纸记录，弹窗询问是否同时套用，确认后复用既有 `CustomSkinModal` / `useSkinDraftMedia` 的壁纸应用链路；
3. 若未下载，不得写空路径进入 `mode: 'custom'`。第一版只提示“可在壁纸中心下载推荐壁纸”；
4. 只有产品明确要求一键下载时，才抽取 `WallpaperGallery` 的下载逻辑为共享 service，避免复制 `toolboxApi.downloadWallpaper` 与 localStorage 管理代码。

---

## 8. 国际化与测试

### 8.1 国际化

Desktop 使用 key-based 的 `useI18n()`；词典基线在 [features/i18n/index.ts](../src/features/i18n/index.ts#L1-L25)。
新主题中心 / 编辑器文案应新增 `themeCenter.*`、`themeEditor.*` 键并补齐简中、繁中、英文，**不要**继续在模板里堆中文 / 英文二元 computed 常量。

[SettingsTheme.vue](../src/components/settings/SettingsTheme.vue#L17-L139) 当前仍有本地 `TEXT` 对象，是既有代码，不是新实现的范式。

### 8.2 最低测试集

新增 `src/features/theme/themePackage.test.ts`：

- `createDesktopThemePackage` 不泄露任何本机路径或 `customBackground` 媒体元数据；
- `parseDesktopThemePackage` 拒绝未知版本、非 `desktop` 平台、非对象 payload；
- 远端 payload 的未知字段不进入 `ThemeSettingsPatch`；
- `windowMaterial` / `dynamicBgType` / `mode` 的冲突组合经 `mergeThemeSettings` 后符合现有语义；
- `normalizeRemoteTheme` 只接受数组条目要求的字段类型。

完成后至少执行：

```bash
npm run typecheck
npm test
npm run build
```

---

## 9. 实施顺序与验收

1. **先做纯函数与单测**：`themePackage.ts` + DTO / 白名单 / 解析；
2. **本地编辑器**：从当前 ThemeSettings 建草稿、预览、取消回滚、应用；不接网络；
3. **内置预设**：验证“默认值基底 + replaceTheme”在不同当前状态下可复现；
4. **主题广场与我的上传**：接三条已有 action，处理数组响应、登录态、待审核状态；
5. **发布**：生成 / 选择预览图，走 `upload_theme`，发布后刷新我的上传；
6. **最后做壁纸联动**：先只识别 / 提示，确认需要后再做一键下载。

验收：

- [ ] 应用主题后深浅类、强调色、窗口材质和焦点恢复后的材质效果均由既有同步链路生效；
- [ ] 应用远端主题不会修改托盘菜单、排行榜、播放交互偏好或本机路径；
- [ ] 取消编辑能无损恢复进入编辑器前的完整 `ThemeSettings`；
- [ ] `list_themes` / `my_themes` 的 `data` 数组可正确渲染；
- [ ] `my_themes` 中的 `pending` / `rejected` 可被识别，不误当作已上架；
- [ ] 发布主题后服务端返回 `pending` 时 UI 不宣称“已上架”；
- [ ] 非 Desktop / 非 v2/v3 / 非法 payload 主题不会应用；
- [ ] `npm run typecheck`、`npm test`、`npm run build` 通过。

---

## 10. 明确不做

- 不新增平行主题渲染器、CSS 变量事实源或第二个全局主题 store；
- 不把整个 `ThemeSettings`、用户行为偏好或本机媒体路径上传；
- 不复制壁纸中心的“我的下载”Tab；
- 不在第一版实现远端主题一键下载壁纸；
- 不让 Desktop 与 Mobile 共用同一份 platform-specific payload；
- 不为了主题编辑器修改 [useAppThemeSync](../src/composables/useAppThemeSync.ts#L1-L16) 的全局同步逻辑。

---

## 11. v3 增量：每页独立壁纸（2026-10 已实施）

主题包 v3 在 v2 基础上新增 `payload.wallpapers`（每页独立壁纸 + 调整参数），随包分发、激活即生效；
未覆盖的页面回落用户全局壁纸方案，重置/换包即恢复。三端（服务端 / 移动端 / 桌面端）契约一致。

### 11.1 包格式

```json
{
  "version": 3,
  "platform": "desktop",
  "payload": {
    "accentColor": "#123456",
    "themeMode": "dark",
    "quickEntryShape": "circle",
    "icons": {}, "stickers": {}, "surfaces": {},
    "wallpapers": {
      "main": {
        "ref": "https://…/main.jpg | data:image/png;base64,…",
        "blur": 20, "opacity": 100, "maskAlpha": 40,
        "scale": 100, "translateX": 0, "translateY": 0
      }
    }
  }
}
```

- 页面清单（`DESKTOP_THEME_PAGE_IDS`，与服务端编辑器 SLOTS_JSON pages 对齐）：
  `main`（首页）/ `playlist`（歌单页）/ `player`（播放页）/ `local`（本地音乐）/ `fav`（我的收藏）/ `settings`（设置页）。
  未知 pageId 直接丢弃。
- **数值为 0-100 整数**（编辑器同款）：blur 0-100 直通；opacity/maskAlpha 解析时 /100；
  scale 80-240 解析时 /100（1.0 = 原大 = cover 铺满，0.8 允许缩小露边——范围对齐客户端
  「壁纸中心」缩放滑杆 80-240）；translateX/Y -100..100 解析时 /100（视口比例）。
  缺省值对齐编辑器 `wpDefault`：scale=100、maskAlpha=40、blur=20、opacity=100、位移=0。
- `landscapeScale / landscapeTranslateX / landscapeTranslateY` 仅移动端使用，桌面端忽略。
- `ref` 校验（`isSafeWallpaperRef`）：远程 http(s) URL（≤512 字符）或 `data:image/` 内嵌（≤16MB）；
  含反斜杠的路径一律拒绝。
- 移动端 v3 包（`platform: "mobile"`）仍被拒绝，两端 payload 不通用。

### 11.2 落盘与设置写入

- [types/index.ts](../src/types/index.ts) 新增 `PerPageBackground`（桌面端 0-1 制）与
  `ThemeSettings.perPageBackgrounds: Record<string, PerPageBackground>`。
- [store.ts](../src/features/settings/store.ts) `normalizePerPageBackgrounds`：非法页/非法值丢弃，
  数值钳制；`mergeThemeSettings` 中 **整体替换语义**（patch 带 `perPageBackgrounds` 即整体写入，
  不带则保留基础值；重置即清空）。
- **data URL 物化**：[desktopThemePackage.ts](../src/features/settings/desktopThemePackage.ts)
  `materializeDesktopThemeWallpapers(next, previous)` 在应用前把 data URL 解码落盘到
  `appData/theme_assets/`（新增 Tauri 命令 `save_theme_wallpaper` / `delete_theme_wallpaper`，
  独立于 `wallpapers/` 缓存目录，不参与 300MB 逐出），换包时清理不再引用的旧资产；
  落盘失败的页面丢弃该页壁纸（回落全局），不阻断整体应用；远程 URL 直接保留。
  应用链路两处接入：[SettingsTheme.vue](../src/components/settings/SettingsTheme.vue) 文件导入、
  [ThemeGallery.vue](../src/components/settings/ThemeGallery.vue) 广场/本地库。
  物化的目的：避免数 MB 级 base64 巨串进入 pinia persist。

### 11.3 渲染接线

- [GlobalBackground.vue](../src/components/layout/GlobalBackground.vue) `backdropPlan` 增加每页优先级：
  当前路由 → pageId（`Home` 无 view 参数/统计 → `main`；`view=all` → `local`；`view=playlist` → `playlist`；
  `Favorites` → `fav`；`Settings` → `settings`；其余路由无每页壁纸）→ 命中 `perPageBackgrounds` 即合成
  `variant: "custom"` 的每页 plan（mediaType 恒 image），否则回落全局方案。
- 播放详情页拥有独立不透明背景（经典/黑胶），不参与 GlobalBackground 每页壁纸；
  编辑器中 `player` 页配置对桌面端仅保留契约位。
- 每页图元尺寸做内存探测（不写入设置持久化），几何计算与全局自定义皮肤共用
  `calculateCoverGeometry` / `coverTransform`（blurAllowance 同款）。
- 存在每页壁纸时根节点垫黑底（与 `mode: 'custom'` 同语义），保证半透明壁纸混合正确。

### 11.4 测试

[desktopThemePackage.test.ts](../src/features/settings/desktopThemePackage.test.ts) 覆盖：
v3 解析与 0-1 换算、缺省值、横屏字段忽略、未知页/非法 ref 丢弃、v2 包空 map 兼容、
version 4 拒绝、merge 整体替换与钳制、data URL 落盘物化（mock toolboxApi）、落盘失败降级、旧资产清理。
