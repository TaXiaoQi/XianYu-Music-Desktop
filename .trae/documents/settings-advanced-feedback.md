# 设置-高级设置 页面新增「问题反馈」功能

## 摘要

在「设置 → 高级设置」页面末尾新增「问题反馈」section，允许登录用户提交标题 + 内容形式的反馈，数据通过现有 `submit_feedback` 接口写入 `user_feedback` 表，供后台 `feedback.php` 管理页面查看与回复。

**后端已全部就绪（无需修改）**：
- `网页端/后台/api/index.php` 第 2572-2622 行 `handleSubmitFeedback` 已实现字段校验与入库
- 第 3533 行 `case 'submit_feedback'` 已注册路由
- `网页端/后台/chaoguan/lib/Schema.php` 第 490 行已定义 `user_feedback` 表结构
- `网页端/后台/chaoguan/public/pages/feedback.php` 已提供后台管理界面（列表/筛选/回复/状态流转）

本任务仅涉及**前端 2 个文件**的修改。

---

## 当前状态分析

### 后端接口契约（已存在，仅作前端对接依据）

`POST /api/?action=submit_feedback`（带 MD5 签名，无需 token，但要求传入 ciyuanxi_id）

**请求体字段**：
| 字段 | 类型 | 必填 | 约束 | 说明 |
|------|------|------|------|------|
| `ciyuanxi_id` | string | 是 | 非空 | 弦予号，后端据此校验登录态并反查用户 |
| `nickname` | string | 否 | - | 昵称，为空时后端按 ciyuanxi_id 反查 username |
| `title` | string | 是 | 1-60 字 | 反馈标题 |
| `content` | string | 是 | 1-1000 字 | 反馈内容 |

**响应**：`{ code, msg, data: { id } }`，`code === 200` 为成功
- 400：参数错误（标题/内容为空、超长、未登录）
- 500：服务器错误

### 前端基础设施（已存在）

- `src/services/auth/authService.ts`
  - `signedRequest<T>(action, body, options?)`：已导出，返回 `Promise<T>`（成功返回 data，失败抛错），第 280-298 行
  - `getStoredAuth()`：已导出，返回 `AuthPayload | null`，其中 `payload.user` 包含 `nickname`、`ciyuanxi_id`，第 86-98 行
- `src/composables/toast.ts`：`useToast()` 返回 `{ showToast }`，调用形式 `showToast(message, 'success' | 'error' | 'info')`
- `src/components/settings/SettingsAdvanced.vue`：已引入 `useToast`、`ref`，4 个现有 section，UI 模式统一（标题 + 说明 + 控件，Tailwind + 深色模式适配，主色 `#EC4141`）

### SettingsAdvanced.vue 现有结构

| 行号 | Section | 说明 |
|------|---------|------|
| 85-105 | 备份与恢复 | 从 BakaMusic/MusicFree 导入歌单 |
| 107-122 | 日志保留 | 下拉选择保留天数 |
| 124-130 | 导出日志 | `LogExportActions` 组件 |
| 132-146 | 日志管理 | 删除全部日志按钮（**当前最后一个 section**）|

新增的「问题反馈」section 将插入到第 146 行 `</section>` 之后、第 148 行 `<ConfirmModal>` 之前。

---

## 待修改文件

### 1. `src/services/usageStats.ts`

**为什么放这里**：该文件已聚合所有「软件 → 后台」的上报函数（`reportAppOpen`、`reportSearch`、`reportError` 等），且已 import `signedRequest`。反馈功能同属上报类操作，放这里保持一致性。

**与现有函数的区别**：现有函数全部是 fire-and-forget（失败静默吞掉）。反馈是用户主动提交、需要即时 UI 反馈的操作，因此新增函数**返回 Promise、不吞错**，由调用方处理成功/失败 toast。

**新增内容**（追加到文件末尾，第 261 行 `reportUserBehavior` 函数之后）：

```typescript
// ─── 问题反馈 ───────────────────────────────────────────

/**
 * 提交问题反馈或建议。
 *
 * 与其他 report* 函数不同：本函数**不** fire-and-forget，而是返回 Promise，
 * 由调用方根据成功/失败给出 toast 反馈（用户主动提交需要即时反馈）。
 *
 * @param title   反馈标题（1-60 字）
 * @param content 反馈内容（1-1000 字）
 * @returns 后端返回的新反馈 ID
 * @throws 未登录时抛 Error('请先登录后再提交反馈')；后端校验失败抛 Error(msg)
 */
export async function submitFeedback(title: string, content: string): Promise<number> {
  const auth = getStoredAuth();
  const user = auth?.user;
  const ciyuanxiId = user?.ciyuanxi_id?.trim();
  if (!ciyuanxiId) {
    throw new Error('请先登录后再提交反馈');
  }

  const data = await signedRequest<{ id: string | number }>('submit_feedback', {
    ciyuanxi_id: ciyuanxiId,
    nickname: user?.nickname?.trim() || '',
    title: title.trim(),
    content: content.trim(),
  });
  return Number(data.id);
}
```

**配套 import 修改**：在文件顶部第 16 行 `import { signedRequest } from './auth/authService';` 之上/之下补充 `getStoredAuth`：

```typescript
import { signedRequest, getStoredAuth } from './auth/authService';
```

### 2. `src/components/settings/SettingsAdvanced.vue`

#### 2.1 `<script setup>` 修改

**新增 import**（第 11 行 `getStoredPlugins` 之后）：
```typescript
import { getStoredAuth } from '../../services/auth/authService';
import { submitFeedback } from '../../services/usageStats';
```

**新增响应式状态**（第 30 行 `showBackupImportResult` 之后）：
```typescript
// ─── 问题反馈 ───
const feedbackTitle = ref('');
const feedbackContent = ref('');
const submittingFeedback = ref(false);
const feedbackAuth = ref(getStoredAuth());

// 登录态可能在设置页面打开后变化（如用户在其他窗口登录），聚焦时刷新一次
const refreshFeedbackAuth = () => {
  feedbackAuth.value = getStoredAuth();
};
const isFeedbackLoggedIn = computed(() => !!feedbackAuth.value?.user?.ciyuanxi_id);
```

**新增 computed import**：第 2 行 `import { ref } from 'vue';` 改为 `import { ref, computed } from 'vue';`

**提交函数**（`importPluginBackup` 函数之后，第 75 行 `</script>` 之前）：
```typescript
const submitUserFeedback = async () => {
  if (submittingFeedback.value) return;

  const title = feedbackTitle.value.trim();
  const content = feedbackContent.value.trim();

  if (!title) {
    showToast('请填写反馈标题', 'error');
    return;
  }
  if (title.length > 60) {
    showToast('标题不能超过 60 字', 'error');
    return;
  }
  if (!content) {
    showToast('请填写反馈内容', 'error');
    return;
  }
  if (content.length > 1000) {
    showToast('内容不能超过 1000 字', 'error');
    return;
  }

  submittingFeedback.value = true;
  try {
    await submitFeedback(title, content);
    showToast('反馈已提交，感谢您的支持', 'success');
    feedbackTitle.value = '';
    feedbackContent.value = '';
  } catch (error: any) {
    showToast(`提交失败：${error?.message || error}`, 'error');
  } finally {
    submittingFeedback.value = false;
  }
};
```

#### 2.2 `<template>` 修改

在第 146 行 `</section>`（日志管理 section 结束）之后、第 148 行 `<ConfirmModal>` 之前插入新 section：

```vue
<section
  class="space-y-3 border-t border-black/10 pt-6 dark:border-white/10"
  @focusin="refreshFeedbackAuth"
>
  <div>
    <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100">问题反馈</h3>
    <p class="mt-1 text-xs leading-5 text-gray-500 dark:text-white/45">
      提交使用中遇到的问题或功能建议，我们会认真查看每一条反馈。
    </p>
  </div>

  <!-- 未登录提示 -->
  <div
    v-if="!isFeedbackLoggedIn"
    class="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3 text-xs text-amber-700 dark:text-amber-300"
  >
    请先登录账号后再提交反馈。
  </div>

  <!-- 反馈表单（未登录时禁用） -->
  <div class="space-y-3" :class="{ 'pointer-events-none opacity-50': !isFeedbackLoggedIn }">
    <label class="block">
      <span class="text-xs text-gray-500 dark:text-white/45">标题</span>
      <input
        v-model="feedbackTitle"
        type="text"
        maxlength="60"
        placeholder="一句话描述问题或建议"
        class="mt-2 h-9 w-full rounded-lg border border-black/10 bg-white/70 px-3 text-sm text-gray-800 outline-none transition focus:border-[#EC4141]/40 dark:border-white/10 dark:bg-black/20 dark:text-gray-100"
      />
      <span class="mt-1 block text-right text-[11px] text-gray-400 dark:text-white/35">
        {{ feedbackTitle.length }} / 60
      </span>
    </label>

    <label class="block">
      <span class="text-xs text-gray-500 dark:text-white/45">详细内容</span>
      <textarea
        v-model="feedbackContent"
        rows="5"
        maxlength="1000"
        placeholder="请详细描述问题现象、复现步骤或建议内容"
        class="mt-2 w-full resize-y rounded-lg border border-black/10 bg-white/70 px-3 py-2 text-sm leading-6 text-gray-800 outline-none transition focus:border-[#EC4141]/40 dark:border-white/10 dark:bg-black/20 dark:text-gray-100"
      />
      <span class="mt-1 block text-right text-[11px] text-gray-400 dark:text-white/35">
        {{ feedbackContent.length }} / 1000
      </span>
    </label>

    <button
      type="button"
      :disabled="submittingFeedback"
      class="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-white/55 px-4 py-3 text-sm font-medium text-gray-800 shadow-sm transition hover:border-[#EC4141]/25 hover:bg-white/80 disabled:cursor-wait disabled:opacity-55 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:hover:bg-white/8"
      @click="submitUserFeedback"
    >
      <Loader2 v-if="submittingFeedback" class="h-4 w-4 animate-spin" />
      {{ submittingFeedback ? '正在提交…' : '提交反馈' }}
    </button>
  </div>
</section>
```

---

## 设计决策与假设

1. **后端无需改动**：经探索确认 `submit_feedback` 接口、`user_feedback` 表、后台管理页均已完整实现。用户「前后端一起」的要求中，后端部分已在此前的会话中完成，本次仅做前端对接。

2. **登录态校验**：后端要求 `ciyuanxi_id` 非空，前端在 `submitFeedback` 中通过 `getStoredAuth()` 读取，未登录时抛错由组件 toast 提示。同时 UI 层在未登录时显示提示条并禁用表单（`pointer-events-none opacity-50`），双重保障。

3. **`submitFeedback` 返回 Promise 而非 fire-and-forget**：与 `usageStats.ts` 其他函数不同。理由：反馈是用户主动提交、期待即时确认的操作，必须给成功/失败 toast，不能静默吞错。在函数 JSDoc 中明确标注此差异。

4. **字符计数实时显示**：使用 `maxlength` 属性硬限制输入，同时显示 `x / N` 计数，与后端校验阈值（60/1000）一致。

5. **表单状态独立**：反馈表单的 title/content/state 独立于其他设置项，不进入 `settings` 持久化（反馈是一次性提交，无需保存草稿）。

6. **UI 风格一致性**：复用现有 section 的 class 命名（`space-y-3 border-t border-black/10 pt-6 dark:border-white/10`）、按钮样式（`rounded-xl border border-black/10 bg-white/55 ...`）、主色 `#EC4141`、深色模式适配。

7. **未登录时仍展示表单**（仅禁用）：让用户直观看到功能存在，登录后即可使用，而非直接隐藏。

---

## 验证步骤

1. **类型检查**：运行 `npx vue-tsc --noEmit`，确认无类型错误（新增 `computed`、`submitFeedback`、`getStoredAuth` 等导入均正确）。

2. **未登录场景**：
   - 退出登录后进入「设置 → 高级设置」
   - 滚动到底部「问题反馈」section
   - 验证：显示「请先登录账号后再提交反馈」提示条，表单半透明且不可交互，提交按钮点击无响应

3. **已登录 - 校验失败场景**：
   - 登录后进入页面
   - 不填标题直接点「提交反馈」→ toast「请填写反馈标题」
   - 仅填标题不填内容 → toast「请填写反馈内容」
   - 粘贴超过 60 字标题 → toast「标题不能超过 60 字」（maxlength 应已阻止输入，但保留兜底校验）

4. **已登录 - 提交成功场景**：
   - 填写合法标题和内容
   - 点击「提交反馈」→ 按钮显示「正在提交…」+ 旋转图标
   - 成功后 toast「反馈已提交，感谢您的支持」，标题和内容清空

5. **已登录 - 网络失败场景**：
   - 断网后提交 → toast「提交失败：请求超时...」或后端返回的 msg

6. **后台验证**：登录后台 `https://xy.zh2026.cn/chaoguan/public/?page=feedback`，确认新提交的反馈出现在列表中，状态为「待处理」，提交者昵称/弦予号正确。

7. **字符计数**：输入时实时更新 `x / 60` 和 `x / 1000` 计数显示。
