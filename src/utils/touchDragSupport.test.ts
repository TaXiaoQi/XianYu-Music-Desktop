import { describe, expect, it } from 'vitest';

import playerFooter from '../components/layout/PlayerFooter.vue?raw';
import sidebarPlaylists from '../components/layout/SidebarPlaylists.vue?raw';
import miniPlayer from '../components/layout/MiniPlayerWindow.vue?raw';
import songTable from '../components/song-list/SongTable.vue?raw';
import sidebarDrag from '../composables/useSidebarPlaylistDragDrop.ts?raw';
import songDrag from '../composables/useSongDrag.ts?raw';

describe('touch drag support', () => {
  it('uses pointer events for song table drag gestures', () => {
    expect(songTable).toContain('@pointerdown="handlePointerDown($event, song, song.virtualIndex)"');
    expect(songTable).toContain('@pointermove="handleSongTablePointerMove"');
    expect(songDrag).toContain("window.addEventListener('pointermove'");
    expect(songDrag).toContain("window.addEventListener('pointerup'");
    expect(songDrag).toContain("window.addEventListener('pointercancel'");
  });

  it('uses pointer events for library reorder drag gestures', () => {
    expect(sidebarPlaylists).toContain('@pointerdown="$emit(\'pointerDown\', $event, index, list)"');
    expect(sidebarPlaylists).toContain('@pointermove="$emit(\'itemPointerMove\', $event, list.id)"');
    expect(sidebarDrag).toContain("window.addEventListener('pointermove'");
    expect(sidebarDrag).toContain("window.addEventListener('pointerup'");
    expect(sidebarDrag).toContain("window.addEventListener('pointercancel'");
  });

  it('uses pointer events for playback sliders', () => {
    expect(playerFooter).toContain('@pointerdown="startProgressDrag"');
    expect(playerFooter).toContain('@pointerdown="startDrag"');
    expect(playerFooter).toContain("window.addEventListener('pointermove'");
    expect(playerFooter).toContain("window.addEventListener('pointerup'");
    expect(playerFooter).toContain("window.addEventListener('pointercancel'");
    expect(miniPlayer).toContain('@pointerdown.stop="startVolumeDrag"');
    expect(miniPlayer).toContain("window.addEventListener('pointermove'");
    expect(miniPlayer).toContain("window.addEventListener('pointerup'");
    expect(miniPlayer).toContain("window.addEventListener('pointercancel'");
  });
});
