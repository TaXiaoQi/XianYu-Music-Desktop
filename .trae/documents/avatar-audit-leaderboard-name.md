# 头像上传审核 + 排行榜名字不更新修复

## Context

用户提出两个问题：

1. **头像上传需要审核**：当前用户上传头像后直接生效（直接更新 `app_users.avatar_url`），用户希望改为和壁纸一样的审核流程——上传后进入 pending 状态，管理员审核通过后才生效。

2. **排行榜名字不更新**：用户修改名字后，排行榜仍显示旧名字。根因：`Home.vue` 使用 `<KeepAlive include="Home">` 缓存首页，`StatisticsPage` 作为子组件被缓存后 `onMounted` 只在首次触发，用户修改名字后排行榜不会自动刷新（排行榜仅监听 `route.path` 和 `authStore.isLoggedIn` 变化，未监听 `authStore.user` 变化）。

---

## 问题一：头像上传审核

### 参考实现（壁纸审核流程）

- 表：`wallpapers`（status: pending/normal/rejected/disabled，uploaded_by，reviewed_at，reviewed_by）
- 前端上传：`src/components/settings/WallpaperGallery.vue` L194-205，通过 `signedPostJson` 调用后端
- 后端上传：`chaoguan/public/api/wallpapers.php` L181-330，插入 status='pending'
- 后台审核：`chaoguan/public/pages/wallpapers.php` L234-246 + L402-425，管理员通过/拒绝
- 后台菜单注册：`chaoguan/public/index.php` L3442

### 当前头像上传实现

- 前端：`src/services/auth/authService.ts` L623-668 `uploadAvatar()` → 压缩图片为 base64 → `requestAction('upload_avatar', ...)` → 上传成功后立即 `saveAuth()` 更新本地用户头像
- 前端 UI：`src/views/Auth.vue` L307-336 `handleAvatarFileChange()` → 调用 `uploadAvatar()` → toast「头像已上传」
- 后端：`api/index.php` L2062 `handleUploadAvatar()` → 直接 `UPDATE app_users SET avatar_url = ?` → 立即生效

### 改造方案

#### 1. 后端 `api/index.php` — 修改 `handleUploadAvatar` + 新增 `get_avatar_status`

**修改 `handleUploadAvatar`**（L2062）：
- 自动建表 `user_avatar_pending`：
  ```sql
  CREATE TABLE IF NOT EXISTS `user_avatar_pending` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `ciyuanxi_id` varchar(32) NOT NULL DEFAULT '',
    `avatar_data` LONGTEXT NOT NULL COMMENT 'base64 头像数据',
    `status` varchar(16) NOT NULL DEFAULT 'pending' COMMENT 'pending/approved/rejected',
    `reviewed_at` datetime DEFAULT NULL,
    `reviewed_by` varchar(64) NOT NULL DEFAULT '',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_ciyuanxi_id` (`ciyuanxi_id`),
    KEY `idx_status` (`status`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户头像审核表'
  ```
- 上传逻辑改为：先删除该用户旧的 pending 记录 → 插入新 pending 记录 → **不更新** `app_users.avatar_url`
- 返回 `{ status: 'pending', avatar_url: <旧头像> }`，让前端保持显示旧头像

**新增 `handleGetAvatarStatus`**：
- 接收 `ciyuanxi_id`，查询 `user_avatar_pending` 表中该用户最新的 pending/rejected 记录
- 返回 `{ status: 'pending' | 'rejected' | 'none' }`
- 注册路由 `case 'get_avatar_status': handleGetAvatarStatus($body); break;`

#### 2. 后端 `chaoguan/public/pages/avatar_audit.php` — 新增审核页面

参考 `wallpapers.php` 的结构，新建头像审核页面：
- 查询所有 `status='pending'` 的记录，关联 `app_users` 获取用户名
- 每条记录显示：用户名、弦予号、头像预览（base64 img）、提交时间
- 「通过」按钮 → 将 `avatar_data` 更新到 `app_users.avatar_url` + pending 记录 status='approved' + reviewed_at/reviewed_by
- 「拒绝」按钮 → pending 记录 status='rejected' + reviewed_at/reviewed_by

#### 3. 后端 `chaoguan/public/index.php` — 注册菜单和审核操作

- 菜单项（参考 L3442 壁纸菜单）：新增 `<li><a href="?page=avatar_audit">头像审核</a></li>`
- 审核操作路由：`case 'approve_avatar': approveAvatar(); break;` 和 `case 'reject_avatar': rejectAvatar(); break;`
- 审核操作函数：通过/拒绝逻辑，记录管理员操作日志

#### 4. 前端 `src/services/auth/authService.ts` — 修改 `uploadAvatar` + 新增 `getAvatarStatus`

**修改 `uploadAvatar`**（L623）：
- 上传成功后**不更新**本地 `saveAuth()` 中的 avatar
- 返回 `{ status: 'pending' }` 让 UI 知道是审核中状态

**新增 `getAvatarStatus`**：
```typescript
export async function getAvatarStatus(): Promise<'pending' | 'rejected' | 'none'> {
  // 调用 get_avatar_status 接口
}
```

#### 5. 前端 `src/views/Auth.vue` — 修改上传提示 + 查询审核状态

**修改 `handleAvatarFileChange`**（L307）：
- 上传成功后 toast 改为「头像已上传，等待管理员审核」
- 不立即更新 `avatarDraft`（保持旧头像）
- 新增 `avatarPending` ref 标记审核中状态，UI 显示「审核中」提示

**onMounted 时查询审核状态**：
- 调用 `getAvatarStatus()`，如果是 pending 则显示「头像审核中」提示条

---

## 问题二：排行榜名字不更新

### 根因

- `src/views/Home.vue` L122-124 使用 `<KeepAlive include="Home">` 缓存首页
- `StatisticsPage` 是 Home 的子组件，被缓存后 `onMounted` 只在首次进入时触发
- 排行榜加载时机：`onMounted`（仅首次）、`watch(route.path)`（路由变化）、`watch(authStore.isLoggedIn)`（登录态变化）
- **缺失**：用户修改名字后 `authStore.user.username` 变化了，但排行榜没有监听这个变化来重新加载

### 修复方案

**文件**：`src/components/statistics/StatisticsPage.vue`

在现有的 watch 附近（L118-122）新增一个 watch，监听用户名变化时重新加载排行榜：

```typescript
watch(() => authStore.user?.username, () => {
  void loadLeaderboard();
});
```

这是一行修改，确保用户修改名字后排行榜自动刷新。

---

## 修改文件清单

| 文件 | 问题 | 改动 |
|------|------|------|
| `网页端/后台/api/index.php` | 头像审核 | 修改 `handleUploadAvatar`、新增 `handleGetAvatarStatus` + 路由 |
| `网页端/后台/chaoguan/public/pages/avatar_audit.php` | 头像审核 | **新增**头像审核管理页面 |
| `网页端/后台/chaoguan/public/index.php` | 头像审核 | 新增菜单项 + 审核 action 路由 + 审核函数 |
| `src/services/auth/authService.ts` | 头像审核 | 修改 `uploadAvatar`、新增 `getAvatarStatus` |
| `src/views/Auth.vue` | 头像审核 | 修改上传提示、查询审核状态 |
| `src/components/statistics/StatisticsPage.vue` | 排行榜 | 新增 watch 监听用户名变化 |

---

## 验证步骤

### 头像审核
1. 登录后进入设置页面，上传新头像 → toast 显示「头像已上传，等待管理员审核」
2. 头像仍显示旧头像，页面显示「审核中」提示
3. 登录后台 `?page=avatar_audit` → 看到待审核头像 → 点击「通过」
4. 重新打开 APP 设置页面 → 新头像生效（通过 `get_user_info` 获取到新 avatar_url）
5. 测试「拒绝」路径：上传 → 后台拒绝 → 用户侧显示「审核未通过」提示

### 排行榜名字
1. 进入排行榜页面，记录当前显示的名字
2. 进入设置修改用户名
3. 返回排行榜页面 → 名字应自动刷新为新名字（无需手动点刷新按钮）
4. 也可以手动点刷新按钮验证数据一致
