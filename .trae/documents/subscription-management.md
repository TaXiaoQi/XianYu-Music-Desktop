# 订阅管理功能实现计划

## Context（背景）

用户要求参考 MusicFreeDesktop 项目完成 XY-Music-Desktop 的订阅管理功能。

**关键发现**：本项目 `SettingsPlugins.vue` 已有订阅管理的 **UI 骨架**（"订阅管理"按钮、添加/移除订阅的界面、订阅列表渲染都已存在），但存在两个核心缺陷导致功能不可用：

1. **数据不持久化**：`subscriptions = ref<Subscription[]>([])` 是空数组，从未从 localStorage 加载，添加/移除操作也未写回 localStorage —— 重启后全部丢失。
2. **安装逻辑是 TODO**：`handleInstallFromSubscription` 仅 `showToast('从订阅 ${sub.name} 安装：等待后端接入')`，未真正拉取订阅源并安装插件。
3. 缺少「一键更新全部订阅」按钮（MusicFreeDesktop 有此功能）。
4. 缺少订阅名称编辑能力（MusicFreeDesktop 支持）。

**MusicFreeDesktop 参考设计**（`MusicFreeDesktop/src/renderer/components/Modal/templates/PluginSubscription/index.tsx`）：
- 数据模型：`{ title?, srcUrl }[]` 存 localStorage `subscription` key
- URL 校验：`/https?:\/\/.+\.js(on)?/`（必须以 .js 或 .json 结尾）
- 使用方式：插件管理页"更新订阅"按钮遍历订阅列表，对每个 srcUrl 调用 `installPluginFromRemote`

**目标**：补全持久化 + 实现从订阅安装 + 一键更新全部 + 名称编辑，使订阅管理成为完整可用功能。遵循项目既有的 `localStorage` + `pluginEngine.ts` 模式，复用已存在的 `loadPluginFromScript` / `addPluginSource` / 批量 JSON 解析逻辑。

## 实现步骤

### 第 1 步：新增 `PluginSubscription` 类型

**文件**：[src/types/index.ts](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src/types/index.ts#L549-L582)

在 `PluginSource` 接口后（约 L582）新增：

```ts
/** 插件订阅源 */
export interface PluginSubscription {
  /** 唯一 ID（sub_<时间戳>_<随机>） */
  id: string;
  /** 订阅名称（用户可编辑） */
  name: string;
  /** 订阅源 URL（必须以 .js 或 .json 结尾） */
  url: string;
  /** 添加时间戳 */
  addedAt: number;
  /** 上次同步时间戳 */
  lastSyncAt?: number;
  /** 上次同步状态 */
  lastSyncStatus?: 'success' | 'failed' | 'partial';
  /** 上次同步消息 */
  lastSyncMessage?: string;
  /** 上次同步成功安装的插件数 */
  lastSyncCount?: number;
}
```

> 向后兼容：现有组件内用的是 `{ id, name, url }` 三字段，新字段均为可选，旧数据可平滑读取。

### 第 2 步：在 `pluginEngine.ts` 新增订阅管理模块

**文件**：[src/services/pluginEngine.ts](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src/services/pluginEngine.ts)

在文件末尾"导出"区之前新增订阅模块。复用本文件已有的 `loadPluginFromScript`、`addPluginSource`、`fetchWithTimeout`、`pluginApi.fetchPluginUrl`、`compareVer` 等工具。

**localStorage key**：`lycia_plugin_subscriptions`（与既有 `lycia_plugin_sources_v4` 命名风格一致）。

新增导出函数：

```ts
// ===== 订阅管理 =====
const PLUGIN_SUBSCRIPTIONS_KEY = 'lycia_plugin_subscriptions';

/** 读取全部订阅 */
export function getSubscriptions(): PluginSubscription[] { /* localStorage getJson */ }

/** 写入全部订阅（内部） */
function saveSubscriptions(list: PluginSubscription[]): void { /* localStorage setJson */ }

/** URL 校验：必须 http(s) 且以 .js/.json 结尾（与 MusicFreeDesktop 一致） */
export function isValidSubscriptionUrl(url: string): boolean { /* /https?:\/\/.+\.(js|json)(\?.*)?$/i */ }

/** 新增订阅（含校验 + URL 去重）。返回新增项或 null */
export function addSubscription(input: { name: string; url: string }): PluginSubscription | null

/** 更新订阅（用于编辑名称） */
export function updateSubscription(id: string, updates: Partial<Pick<PluginSubscription, 'name' | 'url'>>): void

/** 移除订阅 */
export function removeSubscription(id: string): void

/** 单次同步安装结果 */
export interface SubscriptionInstallResult {
  successCount: number;
  failCount: number;
  names: string[];
  errors: string[];
}

/**
 * 从单个订阅 URL 拉取并安装插件。
 * 核心逻辑（复用 SettingsPlugins.vue 现有的 importMultiplePlugins + installPluginFromScript 流程）：
 *  1. fetch URL 内容（先浏览器 fetch，失败回退 pluginApi.fetchPluginUrl）
 *  2. 若内容是 JSON 且解析为 {plugins:[{url,...}]} 数组 → 批量导入
 *  3. 否则当作单个 JS 插件脚本 → loadPluginFromScript + addPluginSource
 *  4. 版本校验：复用组件内 compareVer 逻辑（跳过更旧版本，除非用户在设置里关闭校验）
 */
export async function installFromSubscriptionUrl(
  url: string,
  options?: { skipVersionCheck?: boolean }
): Promise<SubscriptionInstallResult>

/**
 * 一键同步所有订阅，逐个拉取安装，并更新每个订阅的 lastSync* 字段。
 * @param onProgress 每完成一个订阅回调（index, sub, result），供 UI 显示进度
 */
export async function installAllSubscriptions(
  onProgress?: (index: number, total: number, sub: PluginSubscription, result: SubscriptionInstallResult) => void
): Promise<{ totalSubs: number; totalInstalled: number; failedSubs: number }>
```

**关键复用点**：
- 批量 JSON 检测逻辑直接移植自 [SettingsPlugins.vue#L421-L432](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src/components/settings/SettingsPlugins.vue#L421-L432)（`{plugins:[{url,name,version}]}` 格式）
- 单插件安装复用 `loadPluginFromScript` + `addPluginSource`
- fetch 回退链复用 `pluginEngine.ts` 内既有的 `fetchWithTimeout` + `pluginApi.fetchPluginUrl`

### 第 3 步：改造 `SettingsPlugins.vue`

**文件**：[src/components/settings/SettingsPlugins.vue](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src/components/settings/SettingsPlugins.vue)

#### 3.1 导入与类型替换
- 从 `../../services/pluginEngine` 增加导入：`getSubscriptions, addSubscription, updateSubscription, removeSubscription, installFromSubscriptionUrl, installAllSubscriptions, isValidSubscriptionUrl, type SubscriptionInstallResult`
- 从 `../../types` 增加导入 `PluginSubscription`
- 删除组件内的 `interface Subscription`（改用 `PluginSubscription`）

#### 3.2 状态初始化
```ts
const subscriptions = ref<PluginSubscription[]>(getSubscriptions()); // 替换原空数组
```

#### 3.3 修改 `confirmAddSubscription`（L691-L724）
- URL 校验改用 `isValidSubscriptionUrl(url)`（替换手写的 `new URL` + 提示更准确："订阅链接需以 .js 或 .json 结尾"）
- 调用 `addSubscription({ name, url })`，返回值 push 到 `subscriptions.value`（不再手写 id 生成）
- 保留 toast 提示

#### 3.4 修改 `confirmRemoveSubscription`（L741-L749）
- 调用 `removeSubscription(sub.id)` 写回 localStorage
- 其余不变

#### 3.5 实现 `handleInstallFromSubscription`（替换 L727-L730 的 TODO）
```ts
async function handleInstallFromSubscription(sub: PluginSubscription) {
  isPluginBusy.value = true;
  try {
    const result = await installFromSubscriptionUrl(sub.url, { skipVersionCheck: pluginSettings.value.skipVersionCheck });
    // 更新该订阅的同步状态
    updateSubscription(sub.id, {
      lastSyncAt: Date.now(),
      lastSyncStatus: result.failCount === 0 ? 'success' : (result.successCount > 0 ? 'partial' : 'failed'),
      lastSyncMessage: result.errors[0] || `成功安装 ${result.successCount} 个插件`,
      lastSyncCount: result.successCount,
    });
    subscriptions.value = getSubscriptions(); // 刷新显示
    refreshPluginList(); // 刷新插件列表
    if (result.successCount > 0) {
      showToast(`从 ${sub.name} 安装 ${result.successCount} 个插件${result.failCount ? `，${result.failCount} 个失败` : ''}`, 'success');
    } else {
      showToast(`从 ${sub.name} 安装失败: ${result.errors[0] || '无可安装插件'}`, 'error');
    }
  } catch (e: any) {
    showToast(`同步失败: ${e?.message || e}`, 'error');
  } finally {
    isPluginBusy.value = false;
  }
}
```

#### 3.6 新增「更新全部订阅」按钮
在订阅面板头部（[L907-L918](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src/components/settings/SettingsPlugins.vue#L907-L918) 的 `flex items-center justify-between mb-3` 区域），在"添加订阅"按钮左侧增加「更新全部」按钮：

```ts
const syncingAll = ref(false);
async function handleSyncAllSubscriptions() {
  if (subscriptions.value.length === 0) { showToast('暂无订阅源', 'info'); return; }
  syncingAll.value = true;
  try {
    const res = await installAllSubscriptions();
    refreshPluginList();
    subscriptions.value = getSubscriptions();
    showToast(`同步完成: 共安装 ${res.totalInstalled} 个插件${res.failedSubs ? `，${res.failedSubs} 个订阅失败` : ''}`, res.failedSubs ? 'info' : 'success');
  } catch (e: any) { showToast(`同步失败: ${e?.message || e}`, 'error'); }
  finally { syncingAll.value = false; }
}
```

按钮复用现有 `settings-plugin-button settings-plugin-button--sm` 样式，图标用 `RefreshCw`（已导入），`syncingAll` 时 `animate-spin` + 禁用。

#### 3.7 新增订阅名称编辑（对应 MusicFreeDesktop 的可编辑 title）
将订阅卡片中的名称从纯文本改为可点击编辑（点击进入编辑态，显示 input + 回车/失焦保存，Esc 取消）：

```ts
const editingSubId = ref<string | null>(null);
const editingSubName = ref('');
function startEditSubName(sub: PluginSubscription) { editingSubId.value = sub.id; editingSubName.value = sub.name; }
function saveSubName(sub: PluginSubscription) {
  const name = editingSubName.value.trim();
  if (name && name !== sub.name) { updateSubscription(sub.id, { name }); subscriptions.value = getSubscriptions(); }
  editingSubId.value = null;
}
function cancelEditSubName() { editingSubId.value = null; }
```

模板中订阅名称：非编辑态 `@click="startEditSubName(sub)"`，编辑态显示 `<input v-model="editingSubName" @keydown.enter="saveSubName(sub)" @keydown.esc="cancelEditSubName" @blur="saveSubName(sub)">`。

#### 3.8 显示上次同步状态（小字）
订阅卡片 URL 下方追加一行：当 `sub.lastSyncAt` 存在时显示 "上次同步: <相对时间> · <成功数个>"，失败状态用红色小圆点。保持低调，不抢主视觉。

#### 3.9 删除组件内 `importMultiplePlugins`（L446-L493）
该函数逻辑已下沉到 `pluginEngine.ts` 的 `installFromSubscriptionUrl`，且原函数仅被 `handleInstallFromUrl` 调用。需要保留 `handleInstallFromUrl` 对批量 JSON 的处理 —— 调整为：检测到批量 JSON 时调用 `installFromSubscriptionUrl(installUrl)` 复用同一逻辑（或保留原函数但让它调用新的 service 函数）。

> **决策**：为降低风险，保留 `handleInstallFromUrl` 原有批量检测分支，仅将其中的安装实现替换为调用 `installFromSubscriptionUrl`。`importMultiplePlugins` 函数体保留但改为内部转调，避免改动过大。

### 第 4 步：不新增设置项

参考 MusicFreeDesktop 仅提供手动「更新订阅」按钮，不引入"启动时自动同步订阅"开关，保持功能聚焦、避免与既有 `autoUpdateOnStartup`（单插件更新检查）语义混淆。

## 关键复用清单（避免重复造轮子）

| 复用项 | 位置 |
|---|---|
| `loadPluginFromScript(script, uri)` | [pluginEngine.ts#L461](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src/services/pluginEngine.ts#L461) |
| `addPluginSource(source)` | [pluginEngine.ts#L1626](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src/services/pluginEngine.ts#L1626) |
| `fetchWithTimeout(url, ms)` | [pluginEngine.ts#L2094](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src/services/pluginEngine.ts#L2094) |
| `pluginApi.fetchPluginUrl(url)` | fetch 回退（已有调用模式） |
| `compareVer(a,b)` | [SettingsPlugins.vue#L498](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src/components/settings/SettingsPlugins.vue#L498) 版本比较 |
| `localStore.getJson/setJson` | [localStore.ts](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src/services/storage/localStore.ts)（pluginEngine 可直接用 localStorage，与现有插件存储风格一致） |
| 批量 JSON 检测正则 | 移植自 [SettingsPlugins.vue#L421-L432](file:///c:/Users/11832/Desktop/1/XY-Music-Desktop/src/components/settings/SettingsPlugins.vue#L421-L432) |
| UI 样式类 | `settings-plugin-button` / `settings-plugin-input` / `settings-plugin-icon-button`（已存在的 scoped 样式，复用） |
| Toast | `useToast()` → `showToast(msg, 'success'|'error'|'info')` |

## 验证方式（端到端）

1. **类型检查**：`npm run typecheck`（vue-tsc --noEmit）无报错
2. **Lint**：`npm run lint` 无新增报错（注意既有 `preserve-caught-error` 规则的既存状态，不引入新违规）
3. **手动功能验证**（`npm run dev`）：
   - 打开「设置 → 插件 → 订阅管理」面板
   - 添加订阅：输入一个 `.json` 结尾的订阅 URL → 列表出现该条 → 刷新页面后**仍存在**（持久化生效）
   - 添加非法 URL（如 `ftp://x.js` 或 `https://x.com/text`）→ 提示"需以 .js 或 .json 结尾"
   - 点击单条订阅的下载图标 → 拉取并安装插件 → 插件列表出现新插件 → 订阅条目显示"上次同步: 刚刚 · N 个"
   - 点击「更新全部」→ 所有订阅逐个同步 → 完成后 toast 汇总
   - 点击订阅名称 → 进入编辑 → 改名回车 → 刷新页面名称保留
   - 移除订阅 → 二次确认 → 列表移除 → 刷新页面后确认消失
4. **回归**：原有的「本地安装」「网络链接安装」「卸载全部」「插件启用/禁用/更新」等功能不受影响

## 不在本次范围

- 订阅源的云端同步（与 `pluginSync.ts` 的账号云同步区分，不混淆）
- 启动时自动同步订阅（参考 MusicFreeDesktop 仅手动触发）
- 订阅源内容缓存（每次同步实时拉取，与单插件更新检查行为一致）
