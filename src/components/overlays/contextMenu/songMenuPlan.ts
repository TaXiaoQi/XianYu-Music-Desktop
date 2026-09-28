// 歌曲右键菜单的纯数据模型：条目编排与图标形状。动作执行仍留在组件内，
// 本文件不持有任何组件状态，方便以数据驱动方式生成整份菜单。
export type SongMenuCommand =
  | 'startNow'
  | 'queueNext'
  | 'queueLast'
  | 'fetchLocal'
  | 'queueWholeAlbum'
  | 'markFavorite'
  | 'pickPlaylist'
  | 'inspectArtist'
  | 'inspectAlbum'
  | 'revealOnDisk'
  | 'songDossier'
  | 'ejectFromList'
  | 'purgeOnDisk'
  | 'peekRankUser';

export type GlyphStroke = string | { d: string; evenOdd?: boolean };

export interface GlyphShape {
  solid?: boolean;
  canvas?: string;
  edge?: string;
  strokes: GlyphStroke[];
}

export interface SongMenuCommandRow {
  kind: 'command';
  id: SongMenuCommand;
  caption: string;
  alert?: boolean;
}

export interface SongMenuBreakRow {
  kind: 'break';
  id: string;
}

export type SongMenuPlanRow = SongMenuCommandRow | SongMenuBreakRow;

export interface SongMenuScenario {
  rankMode: boolean;
  webSource: boolean;
  insidePlaylist: boolean;
  wipeUnlocked: boolean;
  detailPage?: 'artist' | 'album' | 'playlist' | 'user';
  favorited: boolean;
  downloadable: boolean;
  wholeAlbumQueable: boolean;
}

const cmd = (id: SongMenuCommand, caption: string, alert = false): SongMenuCommandRow =>
  alert ? { kind: 'command', id, caption, alert: true } : { kind: 'command', id, caption };

const brk = (id: string): SongMenuBreakRow => ({ kind: 'break', id });

// 依据场景编排条目；顺序、显隐与文案规则逐条对齐旧版
export const planSongMenu = (scene: SongMenuScenario): SongMenuPlanRow[] => {
  // 排行榜场景只保留一个入口
  if (scene.rankMode) {
    return [cmd('peekRankUser', '查看')];
  }

  const rows: SongMenuPlanRow[] = [
    cmd('startNow', '播放'),
    cmd('queueNext', '下一首播放'),
    cmd('queueLast', '添加到队尾'),
  ];

  // 在线歌曲可下载时追加下载项
  if (scene.webSource && scene.downloadable) {
    rows.push(cmd('fetchLocal', '下载至本地'));
  }

  // 本地歌曲带专辑元数据时支持整张入队
  if (!scene.webSource && !scene.insidePlaylist && scene.wholeAlbumQueable) {
    rows.push(cmd('queueWholeAlbum', '整张专辑添加到队尾'));
  }

  if (scene.webSource) {
    // 在线歌手/专辑详情页内不再提供二次跳转入口
    const navSuppressed = scene.detailPage === 'artist' || scene.detailPage === 'album';
    if (!navSuppressed) {
      rows.push(brk('cut-nav'), cmd('inspectArtist', '查看歌手'), cmd('inspectAlbum', '查看专辑'));
    }
    rows.push(brk('cut-fav'), cmd('markFavorite', scene.favorited ? '取消收藏' : '收藏歌曲'));
    rows.push(
      scene.insidePlaylist
        ? cmd('ejectFromList', '从歌单中移除')
        : cmd('pickPlaylist', '添加到歌单'),
    );
    return rows;
  }

  rows.push(brk('cut-fav'), cmd('markFavorite', scene.favorited ? '取消收藏' : '收藏歌曲'));
  if (!scene.insidePlaylist) {
    rows.push(cmd('pickPlaylist', '添加到歌单'));
  }
  rows.push(
    cmd('inspectArtist', '查看歌手'),
    cmd('inspectAlbum', '查看专辑'),
    brk('cut-tools'),
    cmd('revealOnDisk', '打开文件所在目录'),
    cmd('songDossier', '查看歌曲信息'),
    brk('cut-risk'),
    cmd('ejectFromList', scene.insidePlaylist ? '从歌单中移除' : '从列表移除'),
  );
  if (scene.wipeUnlocked) {
    rows.push(cmd('purgeOnDisk', '从本地移除', true));
  }
  return rows;
};

// 各命令对应的单色线性图标（描边/填充与旧版渲染一致）
export const songGlyphs: Record<SongMenuCommand, GlyphShape> = {
  startNow: { solid: true, canvas: '0 0 24 24', strokes: ['M8 5.5v13l10.5-6.5z'] },
  queueNext: {
    solid: true,
    canvas: '0 0 24 24',
    strokes: [
      'M4.8 7.1c0-.95 1.06-1.52 1.86-1l5.04 3.36c.72.48.72 1.56 0 2.04L6.66 14.86c-.8.53-1.86-.05-1.86-1V7.1zm7.5 0c0-.95 1.06-1.52 1.86-1l5.04 3.36c.72.48.72 1.56 0 2.04l-5.04 3.36c-.8.53-1.86-.05-1.86-1V7.1z',
    ],
  },
  queueLast: { canvas: '0 0 24 24', strokes: ['M5 7.5h14', 'M5 12h14', 'M5 16.5h14'] },
  fetchLocal: { canvas: '0 0 24 24', strokes: ['M12 4v11', 'M8 11l4 4 4-4', 'M5 19h14'] },
  queueWholeAlbum: {
    canvas: '0 0 24 24',
    strokes: [
      'M 2,12 a 5,5 0 1,0 10,0 a 5,5 0 1,0 -10,0',
      'M 5.5,12 a 1.5,1.5 0 1,0 3,0 a 1.5,1.5 0 1,0 -3,0',
      'M14.75 8.5H19.25',
      'M14.75 12H20.25',
      'M14.75 15.5H21.25',
    ],
  },
  pickPlaylist: { canvas: '0 0 24 24', strokes: ['M12 5.5v13', 'M5.5 12h13'] },
  markFavorite: {
    canvas: '0 0 24 24',
    strokes: [
      'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
    ],
  },
  inspectArtist: { canvas: '0 0 24 24', strokes: ['M12 11a3 3 0 100-6 3 3 0 000 6z', 'M6.5 18.5a5.5 5.5 0 0111 0'] },
  inspectAlbum: { canvas: '0 0 24 24', strokes: ['M12 18.5a6.5 6.5 0 100-13 6.5 6.5 0 000 13z', 'M12 13.75a1.75 1.75 0 100-3.5 1.75 1.75 0 000 3.5z'] },
  revealOnDisk: {
    solid: true,
    canvas: '0 0 24 24',
    strokes: [
      'M3.5 8.25A2.25 2.25 0 015.75 6h4.07c.48 0 .93.19 1.27.53l1.02 1.02c.34.34.79.53 1.27.53h4.87a2.25 2.25 0 012.25 2.25v5.42A2.25 2.25 0 0118.25 18H5.75A2.25 2.25 0 013.5 15.75v-7.5z',
    ],
  },
  songDossier: { canvas: '0 0 24 24', strokes: ['M12 10.5v4.75', 'M12 8h.01', 'M12 19a7 7 0 100-14 7 7 0 000 14z'] },
  ejectFromList: { canvas: '0 0 24 24', strokes: ['M7 7l10 10', 'M17 7L7 17'] },
  purgeOnDisk: {
    canvas: '0 0 24 24',
    strokes: [
      'M5 7h14',
      'M9 7V5.75A1.75 1.75 0 0110.75 4h2.5A1.75 1.75 0 0115 5.75V7',
      'M8 10.5v5.5',
      'M12 10.5v5.5',
      'M16 10.5v5.5',
      'M6.5 7l.7 10.3A2 2 0 009.2 19h5.6a2 2 0 001.99-1.7L17.5 7',
    ],
  },
  peekRankUser: { canvas: '0 0 24 24', strokes: ['M12 11a3 3 0 100-6 3 3 0 000 6z', 'M6.5 18.5a5.5 5.5 0 0111 0'] },
};
