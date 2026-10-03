import { it, describe } from 'vitest';

import { expectSourceContains } from '../testing/sourceText';
import playerFooterMarkup from '../components/layout/PlayerFooter.vue?raw';
import footerControlItemMarkup from '../components/layout/FooterControlItem.vue?raw';
import sidebarPlaylistsMarkup from '../components/layout/SidebarPlaylists.vue?raw';
import miniPlayerMarkup from '../components/layout/MiniPlayerWindow.vue?raw';
import volumePopoverMarkup from '../components/layout/VolumePopoverWindow.vue?raw';
import songTableMarkup from '../components/song-list/SongTable.vue?raw';
import sidebarDragLogic from '../composables/useSidebarPlaylistDragDrop.ts?raw';
import songDragLogic from '../composables/useSongDrag.ts?raw';

// 行为规格（逐字冻结）：所有拖拽手势一律基于 Pointer Events 实现，
// 拖拽期间在 window 上跟踪 move / up / cancel 三类指针事件。

describe('触摸拖拽支持', () => {
  it('歌曲表格的行拖拽走 pointer 事件', () => {
    expectSourceContains(songTableMarkup, '@pointerdown="onRowPointerDown($event, song, song.virtualIndex)"');
    expectSourceContains(songTableMarkup, '@pointermove="onTablePointerMove"');
    expectSourceContains(songDragLogic, "window.addEventListener('pointermove'");
    expectSourceContains(songDragLogic, "window.addEventListener('pointerup'");
    expectSourceContains(songDragLogic, "window.addEventListener('pointercancel'");
  });

  it('媒体库歌单重排的拖拽走 pointer 事件', () => {
    expectSourceContains(sidebarPlaylistsMarkup, '@pointerdown="$emit(\'pointerDown\', $event, index, list)"');
    expectSourceContains(sidebarPlaylistsMarkup, '@pointermove="$emit(\'itemPointerMove\', $event, list.id)"');
    expectSourceContains(sidebarDragLogic, "window.addEventListener('pointermove'");
    expectSourceContains(sidebarDragLogic, "window.addEventListener('pointerup'");
    expectSourceContains(sidebarDragLogic, "window.addEventListener('pointercancel'");
  });

  it('播放进度与音量滑杆的拖拽走 pointer 事件', () => {
    expectSourceContains(playerFooterMarkup, '@pointerdown="startProgressDrag"');
    expectSourceContains(footerControlItemMarkup, '@pointerdown="startDrag"');
    expectSourceContains(playerFooterMarkup, "window.addEventListener('pointermove'");
    expectSourceContains(playerFooterMarkup, "window.addEventListener('pointerup'");
    expectSourceContains(playerFooterMarkup, "window.addEventListener('pointercancel'");
    expectSourceContains(volumePopoverMarkup, '@pointerdown.stop="startVolumeDrag"');
    expectSourceContains(miniPlayerMarkup, '@pointerdown.stop="startProgressDrag"');
    expectSourceContains(miniPlayerMarkup, "window.addEventListener('pointermove'");
    expectSourceContains(miniPlayerMarkup, "window.addEventListener('pointerup'");
    expectSourceContains(miniPlayerMarkup, "window.addEventListener('pointercancel'");
    expectSourceContains(volumePopoverMarkup, "window.addEventListener('pointermove'");
    expectSourceContains(volumePopoverMarkup, "window.addEventListener('pointerup'");
    expectSourceContains(volumePopoverMarkup, "window.addEventListener('pointercancel'");
  });
});
