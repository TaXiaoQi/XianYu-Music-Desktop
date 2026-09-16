# 歌词封面编辑器 - 实现方案

## 需求

在设置-工具箱-文件转换下新增"歌词封面编辑"工具，允许用户：
1. 选择音频文件 → 解析内置封面和歌词并显示
2. 封面：替换/删除
3. 歌词：LRC 编辑器（修改时间和内容，增删行）
4. 预览：调用播放系统播放音频

## 实现步骤

### Step 1: Rust 后端 — 新建 `audio_tag_editor.rs`

**文件**: `src-tauri/src/audio_tag_editor.rs`

新增两个 Tauri 命令：

- `read_audio_tags(path)` → 用 `lofty` 读取标签，返回：
  - `lyrics: String`（嵌入式歌词文本）
  - `coverData: Vec<u8>` / `coverMime: String`（封面二进制 + MIME 类型）
  - `title` / `artist` / `album`（文件元数据）
  - `duration: f64`（时长）

- `write_audio_tags(path, lyrics?, coverData?, coverMime?)` → 写入标签
  - `lyrics` 有值 → 写入歌词
  - `coverData` 为 `Some(vec![])` 空数组 → 删除封面
  - `coverData` 为 `Some(non_empty)` → 替换封面
  - `coverData` 为 `None` → 封面不变

复用的 `tags.rs` 工具函数：
- `read_tagged_file_from_path(path)`（带封面读取）
- `find_embedded_picture(&tagged_file)`（提取封面 Picture）
- `extract_embedded_lyrics(&tagged_file)`（提取歌词文本）
- `write_metadata_to_file(&request)`（写入歌词/封面）

### Step 2: 注册命令

- `src-tauri/src/lib.rs` → 添加 `mod audio_tag_editor;` 和 `audio_tag_editor::read_audio_tags, audio_tag_editor::write_audio_tags` 到 `generate_handler![]`

### Step 3: 前端契约

**`src/services/tauri/contracts.ts`**：

```typescript
export interface AudioFileTags {
  lyrics: string;
  coverData: number[];
  coverMime: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
}

// 在 TauriCommandMap 追加：
read_audio_tags: { payload: { path: string }; response: AudioFileTags };
write_audio_tags: {
  payload: { path: string; lyrics?: string | null; coverData?: number[] | null; coverMime?: string | null };
  response: void;
};
```

### Step 4: 前端 API

**`src/services/tauri/audioConvertApi.ts`**（或新建 `audioTagApi.ts`）:

```typescript
export const audioTagApi = {
  readTags: (path: string): Promise<AudioFileTags> => tauriInvoke('read_audio_tags', { path }),
  writeTags: (payload: { path: string; lyrics?: string | null; coverData?: number[] | null; coverMime?: string | null }): Promise<void> =>
    tauriInvoke('write_audio_tags', payload),
};
```

### Step 5: Vue 组件 — `SettingsLyricsCoverEditor.vue`

**新建**: `src/components/settings/SettingsLyricsCoverEditor.vue`

布局（三块）：

```
① 选择文件 → 显示文件名 + 基础信息（标题/歌手/时长）

② 双栏布局：
  左栏 — 封面编辑器：
    - 当前封面预览（img 标签，coverData 转 Blob URL）
    - 「替换封面」按钮（文件选择器，仅图片）
    - 「删除封面」按钮（仅当有封面时显示）
  右栏 — 歌词编辑器：
    - 上半：textarea 显示原始 LRC 文本（可自由编辑）
    - 下半：LRC 行表格（每行 = 时间戳 input + 文本 input + 删除按钮）
    - 「解析LRC」按钮：把 textarea 内容解析为行表格
    - 「+ 添加行」按钮：追加空行

③ 底部操作栏：
  - 「保存到文件」按钮（调用 write_audio_tags）
  - 「播放预览」按钮（调用 playbackApi.playAudio 播放该文件，
    播放界面会同步显示该文件的内置歌词）
```

关键逻辑：

- `pickAudioFile()` → `open()` 过滤器音频扩展名 → `loadFile()`
- `loadFile()` → `audioTagApi.readTags(path)` → 填充 `lyricsText`、`coverData`/`coverMime`、`fileInfo`
- 封面显示：`coverData` 非空时 `URL.createObjectURL(new Blob([new Uint8Array(coverData)], { type: coverMime }))`
- `pickCoverImage()` → `open()` 图片文件 → 读二进制 → 转 `Uint8Array` → 更新 `coverData`/`coverMime`
- `removeCover()` → `coverData = []`
- `parseLrc()` → 正则 `^\[(\d{2}:\d{2}(?:\.\d{2,3})?)](.*)` 解析 → `lrcLines[]`
- `buildLrcText()` → 从 `lrcLines[]` 重建 LRC 文本
- `saveChanges()` → `audioTagApi.writeTags({ path, lyrics, coverData, coverMime })`
- `playPreview()` → `playbackApi.playAudio({ path, title, artist, album, cover: '', duration, outputMode: 'local' })`
- 清理：`onUnmounted` revoke 所有 Blob URL

### Step 6: 工具箱接入

**`SettingsToolbox.vue`**：

- import `SettingsLyricsCoverEditor`
- `toolboxCategories` 中 `convert` 分类的 `tools` 数组追加 `{ id: 'lyrics-cover-editor', name: '歌词封面编辑', desc: '编辑嵌入的歌词和封面图片', icon: 'lyrics', available: true }`
- `ToolboxTool.icon` 类型扩展 `'lyrics'`
- `openTool()` 添加 `tool.id === 'lyrics-cover-editor'` 分支
- 模板添加对应 `v-else-if` 渲染块
- `'lyrics'` 图标 SVG：音符样式

### 验证方式

1. `cargo check` 通过
2. `vue-tsc --noEmit` 通过
3. `npm run tauri:dev` 打开设置-工具箱-文件转换-歌词封面编辑
4. 选择 mp3/flac 文件 → 看到封面和歌词
5. 修改歌词，点击「保存到文件」→ 重新打开确认歌词已更新
6. 替换/删除封面 → 重新打开确认封面已更新
7. 点击「播放预览」→ 音频正常播放，歌词同步显示