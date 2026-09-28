import { it, describe, expect } from 'vitest';

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
    expect(songTableMarkup).toContain('@pointerdown="onRowPointerDown($event, song, song.virtualIndex)"');
    expect(songTableMarkup).toContain('@pointermove="onTablePointerMove"');
    expect(songDragLogic).toContain("window.addEventListener('pointermove'");
    expect(songDragLogic).toContain("window.addEventListener('pointerup'");
    expect(songDragLogic).toContain("window.addEventListener('pointercancel'");
  });

  it('媒体库歌单重排的拖拽走 pointer 事件', () => {
    expect(sidebarPlaylistsMarkup).toContain('@pointerdown="$emit(\'pointerDown\', $event, index, list)"');
    expect(sidebarPlaylistsMarkup).toContain('@pointermove="$emit(\'itemPointerMove\', $event, list.id)"');
    expect(sidebarDragLogic).toContain("window.addEventListener('pointermove'");
    expect(sidebarDragLogic).toContain("window.addEventListener('pointerup'");
    expect(sidebarDragLogic).toContain("window.addEventListener('pointercancel'");
  });

  it('播放进度与音量滑杆的拖拽走 pointer 事件', () => {
    expect(playerFooterMarkup).toContain('@pointerdown="startProgressDrag"');
    expect(footerControlItemMarkup).toContain('@pointerdown="startDrag"');
    expect(playerFooterMarkup).toContain("window.addEventListener('pointermove'");
    expect(playerFooterMarkup).toContain("window.addEventListener('pointerup'");
    expect(playerFooterMarkup).toContain("window.addEventListener('pointercancel'");
    expect(volumePopoverMarkup).toContain('@pointerdown.stop="startVolumeDrag"');
    expect(miniPlayerMarkup).toContain('@pointerdown.stop="startProgressDrag"');
    expect(miniPlayerMarkup).toContain("window.addEventListener('pointermove'");
    expect(miniPlayerMarkup).toContain("window.addEventListener('pointerup'");
    expect(miniPlayerMarkup).toContain("window.addEventListener('pointercancel'");
    expect(volumePopoverMarkup).toContain("window.addEventListener('pointermove'");
    expect(volumePopoverMarkup).toContain("window.addEventListener('pointerup'");
    expect(volumePopoverMarkup).toContain("window.addEventListener('pointercancel'");
  });
});
