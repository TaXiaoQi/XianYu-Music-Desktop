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

import { describe, it } from 'vitest';

import { expectSourceContains, expectSourceNotContains } from '../../testing/sourceText';
import foldersHeaderSource from './FoldersHeader.vue?raw';
import detailHeaderSource from './DetailHeader.vue?raw';
import localMusicHeaderSource from './LocalMusicHeader.vue?raw';
import headerOverflowMenuSource from './HeaderOverflowMenu.vue?raw';

// ===== 共享基建：HeaderOverflowMenu =====

describe('HeaderOverflowMenu 基建（源码钉）', () => {
  it('每个菜单项渲染成一行 CtxRow，并把 item.id 通过 pick 事件抛给宿主', () => {
    expectSourceContains(headerOverflowMenuSource, "const emit = defineEmits<{ (e: 'pick', id: string): void }>();");
    expectSourceContains(headerOverflowMenuSource, 'v-for="item in props.items"');
    expectSourceContains(headerOverflowMenuSource, ':key="item.id"');
    expectSourceContains(headerOverflowMenuSource, '@pick="choose(item.id)"');
    expectSourceContains(headerOverflowMenuSource, "emit('pick', id);");
  });

  it('复用 overlays/contextMenu 既有原语（MenuSurface + CtxRow），未新增组件', () => {
    expectSourceContains(headerOverflowMenuSource, "import MenuSurface from '../overlays/contextMenu/MenuSurface.vue';");
    expectSourceContains(headerOverflowMenuSource, "import CtxRow from '../overlays/contextMenu/CtxRow.vue';");
  });
});

// ===== FoldersHeader =====

describe('FoldersHeader（源码钉）', () => {
  it('defineEmits 全量保留：一个 emit 名都没丢', () => {
    expectSourceContains(
      foldersHeaderSource,
      "defineEmits(['update:isBatchMode', 'playAll', 'batchPlay', 'batchDelete', 'batchMove', 'addToPlaylist', 'addFolder', 'refreshFolder', 'update:isManagementMode'])",
    );
  });

  it('「更多」菜单项映射到与可见路径相同的 emit 名：refreshFolder / update:isBatchMode', () => {
    expectSourceContains(foldersHeaderSource, "if (id === 'refresh') emit('refreshFolder');");
    expectSourceContains(foldersHeaderSource, "else if (id === 'batch') emit('update:isBatchMode', !props.isBatchMode);");
    // 触发按钮把 item.id 交回宿主的同一个 handler
    expectSourceContains(foldersHeaderSource, '@pick="handleOverflowPick"');
  });

  it('门控条件仍挂在正确的菜单项上：刷新文件夹仅在 currentFolderFilter 非空时入列', () => {
    expectSourceContains(
      foldersHeaderSource,
      "if (props.currentFolderFilter) items.push({ id: 'refresh', label: '刷新文件夹', icon: RefreshCw });",
    );
    expectSourceContains(
      foldersHeaderSource,
      "items.push({ id: 'batch', label: props.isBatchMode ? '退出批量操作' : '批量操作', icon: ListChecks });",
    );
  });

  it('主操作未被菜单吞掉：添加文件夹与排序入口仍在头部可见行', () => {
    expectSourceContains(foldersHeaderSource, "@click=\"emit('addFolder')\"");
    expectSourceContains(foldersHeaderSource, 'class="sort-menu-trigger');
    expectSourceContains(foldersHeaderSource, 'title="排序方式"');
  });

  it('负向：批量开关与刷新按钮不再直接从图标行 emit（已收进菜单）', () => {
    expectSourceNotContains(foldersHeaderSource, "@click=\"emit('update:isBatchMode', !isBatchMode)\"");
    expectSourceNotContains(foldersHeaderSource, "v-if=\"currentFolderFilter\" @click=\"emit('refreshFolder')\"");
  });
});

// ===== DetailHeader =====

describe('DetailHeader（源码钉）', () => {
  it('defineEmits 全量保留：10 个 emit 名逐字冻结', () => {
    // 期望串与源码过同一规范形：emit 名与顺序逐字冻结，排版（折行/尾注/尾逗号留白）与实现侧解耦。
    expectSourceContains(
      detailHeaderSource,
      `const emit = defineEmits([
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
      ]);`,
    );
  });

  it('「更多」菜单项映射到与可见路径相同的 emit 名：rename / updateFromSource / openAddToPlaylist / update:isBatchMode', () => {
    expectSourceContains(detailHeaderSource, "if (id === 'rename') emit('rename');");
    expectSourceContains(detailHeaderSource, "else if (id === 'update') emit('updateFromSource');");
    expectSourceContains(detailHeaderSource, "else if (id === 'collect') emit('openAddToPlaylist');");
    expectSourceContains(detailHeaderSource, "else if (id === 'batch') emit('update:isBatchMode', true);");
    expectSourceContains(detailHeaderSource, '@pick="handleOverflowPick"');
  });

  it('门控条件仍挂在正确的菜单项上：showRename / showSourceUpdate / 收藏条件 / readOnly', () => {
    expectSourceContains(
      detailHeaderSource,
      "if (props.showRename) items.push({ id: 'rename', label: '修改信息', icon: PencilLine });",
    );
    expectSourceContains(
      detailHeaderSource,
      "if (props.showSourceUpdate) items.push({ id: 'update', label: '从源端更新', icon: RefreshCw });",
    );
    expectSourceContains(
      detailHeaderSource,
      "if (canCollectFromHeader.value) items.push({ id: 'collect', label: '收藏至歌单', icon: ListPlus });",
    );
    expectSourceContains(
      detailHeaderSource,
      "if (!props.readOnly) items.push({ id: 'batch', label: '批量操作', icon: ListChecks });",
    );
    // 「收藏至歌单」收集条件本身的定义（含 ?? 回退）未被改写
    expectSourceContains(
      detailHeaderSource,
      'const canCollectFromHeader = computed(() => props.showHeaderAddToPlaylist ?? canBatchCollectToPlaylist.value);',
    );
  });

  it('主操作未被菜单吞掉：全部播放仍 emit、收藏心形与排序入口仍在场', () => {
    expectSourceContains(detailHeaderSource, "@click=\"emit('playAll')\"");
    expectSourceContains(detailHeaderSource, ':entry="favoriteEntry ?? null"');
    expectSourceContains(detailHeaderSource, 'class="sort-menu-trigger');
  });

  it('负向：被收进菜单的四项不再作为可见按钮直接从头部 emit', () => {
    expectSourceNotContains(detailHeaderSource, "@click=\"emit('rename')\"");
    expectSourceNotContains(detailHeaderSource, "@click=\"emit('updateFromSource')\"");
    expectSourceNotContains(detailHeaderSource, "@click=\"emit('openAddToPlaylist')\"");
    expectSourceNotContains(detailHeaderSource, "@click=\"emit('update:isBatchMode', true)\"");
    // 旧的可见重命名按钮门控一并消失（条件已搬到菜单项上）
    expectSourceNotContains(detailHeaderSource, 'v-if="showRename"');
  });
});

// ===== LocalMusicHeader =====

describe('LocalMusicHeader（源码钉）', () => {
  it('defineEmits 全量保留：8 个 emit 名逐字冻结', () => {
    expectSourceContains(localMusicHeaderSource, `const emit = defineEmits<{
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
    expectSourceContains(localMusicHeaderSource, "{ id: 'rescan', label: '刷新音乐库', icon: RefreshCw },");
    expectSourceContains(localMusicHeaderSource, "{ id: 'enqueue', label: '全部添加至播放队列', icon: ListPlus },");
    expectSourceContains(localMusicHeaderSource, "{ id: 'bulk', label: '批量操作', icon: ListChecks },");
    // 可见按钮与菜单 pick 都汇入 runPrimaryEntry
    expectSourceContains(localMusicHeaderSource, '@click="runPrimaryEntry(entry.key)"');
    expectSourceContains(localMusicHeaderSource, 'const handleOverflowPick = (id: string) => {');
    expectSourceContains(localMusicHeaderSource, 'runPrimaryEntry(id as PrimaryKey);');
    expectSourceContains(localMusicHeaderSource, '@pick="handleOverflowPick"');
    // 同一张 outcomes 表给出 emit 名（play 为可见主操作，其余三项来自菜单）
    expectSourceContains(localMusicHeaderSource, "play: () => emit('playAll'),");
    expectSourceContains(localMusicHeaderSource, "rescan: () => emit('refreshAll'),");
    expectSourceContains(localMusicHeaderSource, "enqueue: () => emit('addAllToQueue'),");
    expectSourceContains(localMusicHeaderSource, "bulk: () => emit('update:isBatchMode', true),");
  });

  it('主操作未被菜单吞掉：播放全部与排序入口仍在头部可见行', () => {
    expectSourceContains(localMusicHeaderSource, 'v-for="entry in primaryEntries"');
    expectSourceContains(localMusicHeaderSource, '<SortModeButton />');
  });

  it('负向：刷新音乐库 / 全部添加至队列 / 批量操作不再是可见主按钮（已收进菜单）', () => {
    expectSourceNotContains(localMusicHeaderSource, "key: 'rescan'");
    expectSourceNotContains(localMusicHeaderSource, "key: 'enqueue'");
    expectSourceNotContains(localMusicHeaderSource, "key: 'bulk'");
    expectSourceNotContains(localMusicHeaderSource, "tip: '批量操作'");
  });
});
