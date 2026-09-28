// 源码钉：b1ab0885「首页三个 header 收敛图标密度，次要操作收进「更多」菜单」的静态回归守卫。
//
// 诚实声明（重要）：本文件是 *源码文本* 断言，不是行为证明。
// 它只能证明三个 header 的源码仍然：
//   (a) 声明了同一批 emit（defineEmits 未被删减）；
//   (b) 「更多」菜单项与可见主操作引用了同一批 emit 名；
//   (c) 把原有的触发条件挂在正确的菜单项上。
// 它 **不能** 证明一次真实点击能到达对应 handler —— 那需要挂载/渲染，而本仓库 `src/components/**`
// 下既无 mount 基建，也没有 jsdom/happy-dom（vitest.config.ts 跑 `environment: "node"`）。
// 文件名里的 `.source.` 即为提醒：这是源码钉，不是可达性证明。
//
// 断言只写源码里真实存在（或确实已删除）的文本。若某条映射在源码里并不成立，应作为发现上报，
// 而不是把断言改弱来通过。

import { describe, expect, it } from 'vitest';

import foldersHeaderSource from './FoldersHeader.vue?raw';
import detailHeaderSource from './DetailHeader.vue?raw';
import localMusicHeaderSource from './LocalMusicHeader.vue?raw';
import headerOverflowMenuSource from './HeaderOverflowMenu.vue?raw';

// ===== 共享基建：HeaderOverflowMenu =====

describe('HeaderOverflowMenu 基建（源码钉）', () => {
  it('每个菜单项渲染成一行 CtxRow，并把 item.id 通过 pick 事件抛给宿主', () => {
    expect(headerOverflowMenuSource).toContain("const emit = defineEmits<{ (e: 'pick', id: string): void }>();");
    expect(headerOverflowMenuSource).toContain('v-for="item in props.items"');
    expect(headerOverflowMenuSource).toContain(':key="item.id"');
    expect(headerOverflowMenuSource).toContain('@pick="choose(item.id)"');
    expect(headerOverflowMenuSource).toContain("emit('pick', id);");
  });

  it('复用 overlays/contextMenu 既有原语（MenuSurface + CtxRow），未新增组件', () => {
    expect(headerOverflowMenuSource).toContain("import MenuSurface from '../overlays/contextMenu/MenuSurface.vue';");
    expect(headerOverflowMenuSource).toContain("import CtxRow from '../overlays/contextMenu/CtxRow.vue';");
  });
});

// ===== FoldersHeader =====

describe('FoldersHeader（源码钉）', () => {
  it('defineEmits 全量保留：一个 emit 名都没丢', () => {
    expect(foldersHeaderSource).toContain(
      "defineEmits(['update:isBatchMode', 'playAll', 'batchPlay', 'batchDelete', 'batchMove', 'addToPlaylist', 'addFolder', 'refreshFolder', 'update:isManagementMode'])",
    );
  });

  it('「更多」菜单项映射到与可见路径相同的 emit 名：refreshFolder / update:isBatchMode', () => {
    expect(foldersHeaderSource).toContain("if (id === 'refresh') emit('refreshFolder');");
    expect(foldersHeaderSource).toContain("else if (id === 'batch') emit('update:isBatchMode', !props.isBatchMode);");
    // 触发按钮把 item.id 交回宿主的同一个 handler
    expect(foldersHeaderSource).toContain('@pick="handleOverflowPick"');
  });

  it('门控条件仍挂在正确的菜单项上：刷新文件夹仅在 currentFolderFilter 非空时入列', () => {
    expect(foldersHeaderSource).toContain(
      "if (props.currentFolderFilter) items.push({ id: 'refresh', label: '刷新文件夹', icon: RefreshCw });",
    );
    expect(foldersHeaderSource).toContain(
      "items.push({ id: 'batch', label: props.isBatchMode ? '退出批量操作' : '批量操作', icon: ListChecks });",
    );
  });

  it('主操作未被菜单吞掉：添加文件夹与排序入口仍在头部可见行', () => {
    expect(foldersHeaderSource).toContain("@click=\"emit('addFolder')\"");
    expect(foldersHeaderSource).toContain('class="sort-menu-trigger');
    expect(foldersHeaderSource).toContain('title="排序方式"');
  });

  it('负向：批量开关与刷新按钮不再直接从图标行 emit（已收进菜单）', () => {
    expect(foldersHeaderSource).not.toContain("@click=\"emit('update:isBatchMode', !isBatchMode)\"");
    expect(foldersHeaderSource).not.toContain("v-if=\"currentFolderFilter\" @click=\"emit('refreshFolder')\"");
  });
});

// ===== DetailHeader =====

describe('DetailHeader（源码钉）', () => {
  it('defineEmits 全量保留：10 个 emit 名逐字冻结', () => {
    expect(detailHeaderSource).toContain(`const emit = defineEmits([
  'update:isBatchMode',
  'playAll',
  'batchPlay',
  'batchDelete',
  'openAddToPlaylist',
  'batchAddToFavorites',
  'batchDownload',
  'rename',
  'selectAll',
  'updateFromSource',
]);`);
  });

  it('「更多」菜单项映射到与可见路径相同的 emit 名：rename / updateFromSource / openAddToPlaylist / update:isBatchMode', () => {
    expect(detailHeaderSource).toContain("if (id === 'rename') emit('rename');");
    expect(detailHeaderSource).toContain("else if (id === 'update') emit('updateFromSource');");
    expect(detailHeaderSource).toContain("else if (id === 'collect') emit('openAddToPlaylist');");
    expect(detailHeaderSource).toContain("else if (id === 'batch') emit('update:isBatchMode', true);");
    expect(detailHeaderSource).toContain('@pick="handleOverflowPick"');
  });

  it('门控条件仍挂在正确的菜单项上：showRename / showSourceUpdate / 收藏条件 / readOnly', () => {
    expect(detailHeaderSource).toContain(
      "if (props.showRename) items.push({ id: 'rename', label: '修改信息', icon: PencilLine });",
    );
    expect(detailHeaderSource).toContain(
      "if (props.showSourceUpdate) items.push({ id: 'update', label: '从源端更新', icon: RefreshCw });",
    );
    expect(detailHeaderSource).toContain(
      "if (canCollectFromHeader.value) items.push({ id: 'collect', label: '收藏至歌单', icon: ListPlus });",
    );
    expect(detailHeaderSource).toContain(
      "if (!props.readOnly) items.push({ id: 'batch', label: '批量操作', icon: ListChecks });",
    );
    // 「收藏至歌单」收集条件本身的定义（含 ?? 回退）未被改写
    expect(detailHeaderSource).toContain(
      'const canCollectFromHeader = computed(() => props.showHeaderAddToPlaylist ?? canBatchCollectToPlaylist.value);',
    );
  });

  it('主操作未被菜单吞掉：全部播放仍 emit、收藏心形与排序入口仍在场', () => {
    expect(detailHeaderSource).toContain("@click=\"emit('playAll')\"");
    expect(detailHeaderSource).toContain(':entry="favoriteEntry ?? null"');
    expect(detailHeaderSource).toContain('class="sort-menu-trigger');
  });

  it('负向：被收进菜单的四项不再作为可见按钮直接从头部 emit', () => {
    expect(detailHeaderSource).not.toContain("@click=\"emit('rename')\"");
    expect(detailHeaderSource).not.toContain("@click=\"emit('updateFromSource')\"");
    expect(detailHeaderSource).not.toContain("@click=\"emit('openAddToPlaylist')\"");
    expect(detailHeaderSource).not.toContain("@click=\"emit('update:isBatchMode', true)\"");
    // 旧的可见重命名按钮门控一并消失（条件已搬到菜单项上）
    expect(detailHeaderSource).not.toContain('v-if="showRename"');
  });
});

// ===== LocalMusicHeader =====

describe('LocalMusicHeader（源码钉）', () => {
  it('defineEmits 全量保留：8 个 emit 名逐字冻结', () => {
    expect(localMusicHeaderSource).toContain(`const emit = defineEmits<{
  'update:isBatchMode': [value: boolean];
  playAll: [];
  addToPlaylist: [];
  batchDelete: [];
  batchMove: [];
  refreshAll: [];
  addAllToQueue: [];
  selectAll: [];
}>();`);
  });

  it('「更多」菜单项与可见主按钮复用同一 handler（runPrimaryEntry），映射到同一批 emit 名', () => {
    // 菜单项定义：id 与可见入口同一批 key
    expect(localMusicHeaderSource).toContain("{ id: 'rescan', label: '刷新音乐库', icon: RefreshCw },");
    expect(localMusicHeaderSource).toContain("{ id: 'enqueue', label: '全部添加至播放队列', icon: ListPlus },");
    expect(localMusicHeaderSource).toContain("{ id: 'bulk', label: '批量操作', icon: ListChecks },");
    // 可见按钮与菜单 pick 都汇入 runPrimaryEntry
    expect(localMusicHeaderSource).toContain('@click="runPrimaryEntry(entry.key)"');
    expect(localMusicHeaderSource).toContain('const handleOverflowPick = (id: string) => {');
    expect(localMusicHeaderSource).toContain('runPrimaryEntry(id as PrimaryKey);');
    expect(localMusicHeaderSource).toContain('@pick="handleOverflowPick"');
    // 同一张 outcomes 表给出 emit 名（play 为可见主操作，其余三项来自菜单）
    expect(localMusicHeaderSource).toContain("play: () => emit('playAll'),");
    expect(localMusicHeaderSource).toContain("rescan: () => emit('refreshAll'),");
    expect(localMusicHeaderSource).toContain("enqueue: () => emit('addAllToQueue'),");
    expect(localMusicHeaderSource).toContain("bulk: () => emit('update:isBatchMode', true),");
  });

  it('主操作未被菜单吞掉：播放全部与排序入口仍在头部可见行', () => {
    expect(localMusicHeaderSource).toContain('v-for="entry in primaryEntries"');
    expect(localMusicHeaderSource).toContain('<SortModeButton />');
  });

  it('负向：刷新音乐库 / 全部添加至队列 / 批量操作不再是可见主按钮（已收进菜单）', () => {
    expect(localMusicHeaderSource).not.toContain("key: 'rescan'");
    expect(localMusicHeaderSource).not.toContain("key: 'enqueue'");
    expect(localMusicHeaderSource).not.toContain("key: 'bulk'");
    expect(localMusicHeaderSource).not.toContain("tip: '批量操作'");
  });
});
