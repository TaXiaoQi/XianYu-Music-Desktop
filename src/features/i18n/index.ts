import { computed, type ComputedRef } from 'vue'; // 实现
import { storeToRefs } from 'pinia'; // 实现

import type { AppLanguage } from '../../types'; // 实现
import { useSettingsStore } from '../settings/store'; // 实现
import { toTraditional } from './traditional';

const zhCN = { // 实现
  'language.section': '语言', // 实现
  'language.label': '软件语言', // 实现
  'language.description': '选择界面显示语言，切换后立即生效。', // 实现
  'language.system': '跟随系统',
  'language.zhCN': '简体中文', // 实现
  'language.zhTW': '繁體中文',
  'language.enUS': 'English', // 实现

  'settings.account': '账号', // 实现
  'settings.general': '常规', // 实现
  'settings.plugins': '音源',
  'settings.theme': '外观', // 实现
  'settings.playback': '播放', // 实现
  'settings.pluginHost': '音频插件',
  'settings.download': '下载', // 实现
  'settings.library': '音乐库', // 实现
  'settings.toolbox': '工具箱', // 实现
  'settings.desktopLyrics': '桌面歌词', // 实现
  'settings.sleepTimer': '睡眠定时',

  'sleepTimer.title': '睡眠定时',
  'sleepTimer.description': '到点或一段时间没有操作后，自动暂停播放；也可以退出应用或隐藏到托盘。',
  'sleepTimer.modeLabel': '触发方式',
  'sleepTimer.modeHint': '倒计时到点，或应用内一段时间没有操作',
  'sleepTimer.modeCountdown': '倒计时',
  'sleepTimer.modeIdle': '无操作',
  'sleepTimer.countdownLabel': '倒计时时长',
  'sleepTimer.countdownHint': '暂停播放也照常计时（按墙钟）',
  'sleepTimer.idleLabel': '无操作时长',
  'sleepTimer.idleHint': '只统计应用内的鼠标 / 键盘 / 滚轮 / 触摸；暂停播放时不触发',
  'sleepTimer.minutes': '分钟',
  'sleepTimer.customMinutes': '自定义分钟数',
  'sleepTimer.actionLabel': '到点动作',
  'sleepTimer.actionHint': '暂停前会先做一次音量淡出',
  'sleepTimer.actionPause': '暂停播放',
  'sleepTimer.actionExit': '退出应用',
  'sleepTimer.actionHideToTray': '隐藏到托盘',
  'sleepTimer.start': '开始',
  'sleepTimer.cancel': '取消',
  'sleepTimer.runningLabel': '进行中',
  'sleepTimer.idle': '未开始',
  'sleepTimer.notRunningHint': '选好方式与动作后点「开始」',
  'sleepTimer.toastPaused': '睡眠定时已暂停播放',
  'sleepTimer.toastHidden': '睡眠定时已隐藏到托盘',
  'settings.shortcuts': '快捷按键',
  'settings.network': '网络',
  'settings.advanced': '高级设置', // 实现
  'settings.linkage': '联动',
  'settings.feedback': '问题反馈',
  'settings.debug': '调试', // 实现
  'settings.about': '关于', // 实现
  'settings.search': '搜索设置', // 实现
  'settings.clearSearch': '清除设置搜索', // 实现
  'settings.results': '找到 {count} 项设置', // 实现
  'settings.noResults': '没有找到相关设置', // 实现
  'settings.searchHint': '试试搜索“音质”“歌词”或“缓存”', // 实现
  'settings.resizeHint': '按住拖拽调整侧边栏宽度，双击恢复默认', // 实现
  'settings.building': '施工中', // 实现
  'settings.buildingHint': '当前设置模块正在整理中。', // 实现

  'general.section': '常规与启动', // 实现
  'general.launchOnStartup': '开机自动运行', // 实现
  'general.launchOnStartupMinimized': '开机启动时最小化到托盘',
  'general.checkUpdates': '启动检测更新', // 实现
  'general.welcomeToast': '启动时显示版本提示',
  'general.gpuAcceleration': 'GPU 加速', // 实现
  'general.performanceMode': '性能模式',
  'general.performanceModeHint': '低性能设备自动收缩毛玻璃与动态特效，改善流畅度',
  'general.pmAuto': '自动',
  'general.pmFull': '满特效',
  'general.pmPerformance': '性能优先',
  'general.closeToTray': '关闭时最小化至托盘', // 实现
  'general.showQualityBadges': '显示音质标识', // 实现
  'general.showSongComments': '显示歌曲注释', // 实现
  'general.scrollToTop': '显示回到顶部按钮',
  'general.taskbarControls': '启用任务栏快捷播控', // 实现
  'general.writeArtistAvatar': '修改歌手头像时同步写回音频标签', // 实现
  'general.writeArtistAvatarHint': '开启后，手动修改歌手头像时会同步修改本地音频文件（多歌手合作歌曲、远程歌曲、CUE 分轨和只读文件会被自动跳过）。', // 实现
  'general.songClickAction': '双击播放歌曲',
  'general.songClickActionHint': '开启后双击播放歌曲，关闭后单击播放。',
  'general.fileAssoc': '音频文件关联',
  'general.fileAssocHint': '勾选后该格式会出现在系统「打开方式」列表。想让它同时成为双击时的默认程序，请在首次双击弹出的「选择一个应用以打开」里选中「弦予音乐」并点「始终」。',
  'general.fileAssocNote': 'Windows 会保护你已确认的默认程序选择，因此勾选不会直接改写双击默认（系统限制，任何程序都无法静默改默认）；在弹窗里点一次「始终」后即长期生效，之后双击可直接打开，无需再选。',
  'general.fileAssocWindowsOnly': '该功能仅在 Windows 上可用。',
  'general.fileAssocAll': '全选',
  'general.fileAssocNone': '全不选',
  'theme.glassSwitch': '液态玻璃',
  'theme.glassSwitchDesc': '高透光玻璃折射与动态水波流光',
  'theme.flatSwitch': '经典扁平',
  'theme.flatSwitchDesc': '简约干净无毛玻璃遮罩风格',
  'general.storage': '存储空间', // 实现
  'general.cacheLimit': '播放缓存上限', // 实现
  'general.cacheLimitHint': '在线歌曲下载后会缓存到本地，再次播放无需重新下载；缓存满后自动清理最久未播放的曲目。', // 实现
  'general.clearCache': '清理在线播放缓存', // 实现
  'general.clearCacheHint': '清理不会影响正在播放的歌曲，其他已缓存曲目需要重新下载。', // 实现
  'general.clearing': '清理中...', // 实现
  'general.clear': '清理', // 实现
  'general.resetData': '重置数据', // 实现
  'general.resetting': '重置中...', // 实现
  'general.scanUnavailable': '扫描中不可用', // 实现
  'general.reset': '重置', // 实现
  'general.resetConfirm': '此操作会清空媒体库、播放记录、收藏和设置，并恢复初始状态，但不会删除你的音乐文件。确定继续吗？', // 实现

  'toast.gpuUpdated': 'GPU 加速设置已更新，重启软件后生效', // 实现
  'toast.gpuFailed': 'GPU 加速设置保存失败', // 实现
  'toast.cacheCleared': '在线播放缓存已清理', // 实现
  'toast.cacheClearFailed': '清理在线播放缓存失败', // 实现
  'toast.resetFailed': '清除所有数据失败，请重试', // 实现
  'toast.welcome': '欢迎使用弦予音乐，当前版本 v{version}', // 实现

  'sidebar.home': '首页', // 实现
  'sidebar.localMusic': '本地音乐', // 实现
  'sidebar.artists': '歌手', // 实现
  'sidebar.albums': '专辑', // 实现
  'sidebar.favorites': '我的收藏', // 实现
  'sidebar.recent': '最近播放', // 实现
  'sidebar.folders': '文件夹', // 实现
  'sidebar.plugins': '插件管理', // 实现
  'sidebar.account': '个人中心',
  'sidebar.topLists': '榜单',
  'sidebar.dailyRecommend': '每日推荐',

  'topbar.search': '搜索音乐...', // 实现
  'topbar.recognize': '听歌识曲', // 实现
  'topbar.back': '后退', // 实现
  'topbar.lightText': '切换浅色字体', // 实现
  'topbar.darkText': '切换深色字体', // 实现
  'topbar.lightTheme': '切换浅色', // 实现
  'topbar.darkTheme': '切换深色', // 实现
  'topbar.profile': '个人中心', // 实现
  'topbar.login': '登录 / 注册', // 实现
  'topbar.announcement': '公告', // 实现
  'topbar.viewAnnouncement': '查看公告', // 实现
  'topbar.settings': '设置', // 实现
  'topbar.skin': '皮肤', // 实现
  'topbar.searchHistory': '搜索历史', // 实现
  'topbar.clearHistory': '清空', // 实现
  'topbar.hotSearch': '热搜',
  'topbar.history': '记录',
  'topbar.everyoneSearching': '大家都在搜',
  'topbar.hotSearchLoading': '加载中...',
  'topbar.hotSearchEmpty': '暂无热搜数据',
  'topbar.historyEmpty': '暂无搜索记录',
  'topbar.miniMode': 'Mini 模式', // 实现
  'topbar.minimize': '最小化', // 实现
  'topbar.maximize': '最大化', // 实现
  'topbar.maximizeUnavailable': '全屏模式下不可用', // 实现
  'topbar.close': '关闭', // 实现

  'pluginHost.effectsRack': '效果插件机架',
  'pluginHost.enableRack': '音效插件机架',
  'pluginHost.rackDesc': '音效插件机架在最终音量前按机架顺序串联处理音频，当前支持 VST3 与 CLAP 格式。开启期间会自动禁用 WASAPI 独占、原生 DSD 直通与 Bit-perfect 直出（它们会绕过机架），并锁定全局均衡器；音量与音质切换仍可正常使用。',
  'pluginHost.customScanDirs': '自定义扫描目录',
  'pluginHost.count': '{count} 个',
  'pluginHost.scanDirsHint': '添加后自动重新扫描，插件将自动加入机架（默认停用）。目录类别按目录名或内容自动识别 VST3 / CLAP。',
  'pluginHost.addDir': '添加目录',
  'pluginHost.noDirsHint': '未添加自定义目录。插件默认从系统标准目录扫描；如需从其他位置加载，请在此添加。',
  'pluginHost.removeDirTooltip': '移除该扫描目录',
  'pluginHost.scanning': '扫描中...',
  'pluginHost.rescan': '重新扫描',
  'pluginHost.scanningDirs': '正在扫描标准插件目录...',
  'pluginHost.rackChain': '机架链路',
  'pluginHost.slotCount': '{count} 个槽位',
  'pluginHost.emptyRack': '机架为空。点击右上角「扫描」检索 VST3 / CLAP 插件，扫描结果将自动加入机架（默认停用）。',
  'pluginHost.searchPlaceholder': '搜索插件...',
  'pluginHost.clearSearch': '清空',
  'pluginHost.scanningCurrent': '正在扫描：',
  'pluginHost.dblClickHint': '双击调起插件原生 UI 编辑器',
  'pluginHost.restoreRemoved': '恢复已移除',
  'pluginHost.dismissedHint': '已移除 {count} 个插件，重新扫描时不会自动加入',
  'pluginHost.timeoutTitle': '插件扫描响应超时',
  'pluginHost.timeoutContent': '检测到当前插件 [{name}] 扫描响应时间超过 4 秒，可能存在加密锁失联、卡死或底层不兼容。是否跳过并禁用该插件？',
  'pluginHost.rememberTimeout': '记忆操作，为后续所有问题插件应用',
  'pluginHost.unknownVendor': '未知厂商',
  'pluginHost.disabledSuffix': '已停用',
  'pluginHost.moveUp': '上移',
  'pluginHost.moveDown': '下移',
  'pluginHost.paramsPresets': '参数与预设',
  'pluginHost.disableSlot': '停用该插件',
  'pluginHost.enableSlot': '启用该插件',
  'pluginHost.removeFromRack': '从机架移除',
  'pluginHost.loadingParams': '正在读取插件参数...',
  'pluginHost.paramsReadFailed': '参数读取失败: {err}',
  'pluginHost.presetLoadFailed': '预设加载失败: {err}',
  'pluginHost.factoryPresets': '工厂预设',
  'pluginHost.noParams': '该插件没有可调节的参数。',
  'pluginHost.catEffect': '效果',
  'pluginHost.catInstrument': '乐器',
  'pluginHost.catNoteEffect': '音符效果',
  'pluginHost.catAnalyzer': '分析',
  'pluginHost.catTool': '工具',
  'pluginHost.removeTitle': '移除插件',
  'pluginHost.removeContent': '确定要从机架中移除「{name}」吗？其参数设置会被一并清除。',
  'pluginHost.removeDirTitle': '移除扫描目录',
  'pluginHost.removeDirContent': '确定要移除该扫描目录吗？移除后该目录下的插件不会被扫描加载。',

  'dlna.title': 'DLNA 投屏',
  'dlna.lanDevices': '局域网设备',
  'dlna.rescan': '重新扫描',
  'dlna.scanning': '正在扫描局域网设备…',
  'dlna.noDevices': '未发现设备',
  'dlna.noDevicesHint': '请确认电视/音箱已开启 DLNA 且与本机同一网络',
  'dlna.disconnect': '断开投屏',
  'dlna.connectedHint': '连接后本端播放将自动投到设备，播放/暂停/进度/音量即遥控该设备。',
  'dlna.castingTo': '正在投屏到「{name}」',
  'dlna.connected': '已连接「{name}」，播放歌曲即可投屏',
  'dlna.connectFailed': '连接「{name}」失败',
  'dlna.disconnected': '已断开投屏',
  'dlna.disconnectFailed': '断开投屏失败',
  'dlna.scanFailed': '设备扫描失败，请检查防火墙设置',
  'dlna.noDeviceFound': '未发现 DLNA 设备，请确认设备与本机在同一局域网',
  'dlna.deviceLost': '投屏设备连接已断开',
  'dlna.dmrlLoadTitle': 'DLNA 投放',
  'dlna.settings.title': 'DLNA 渲染器',
  'dlna.settings.desc': '开启后本机将作为 DLNA 设备出现在局域网中，其它 App（如 QQ 音乐、网易云音乐）可直接投歌到弦予播放。',
  'dlna.settings.enable': '接收其它设备投屏',
  'dlna.settings.running': '运行中 · 端口 {port}',
  'dlna.settings.notRunning': '未运行（需与投送端在同一局域网）',
  'dlna.settings.name': '设备名称（投送端看到的名字）',
  'dlna.settings.namePlaceholder': '弦予音乐',
  'dlna.settings.firewallHint': '首次开启时 Windows 可能弹出防火墙授权，请允许「专用网络」访问，否则设备将无法被发现。',

  'stats.rangeLabel': '时间范围',
  'stats.rangeAll': '全部',
  'stats.rangeDays7': '7 天',
  'stats.rangeDays30': '30 天',
  'stats.rangeThisYear': '今年',
  'stats.listenDuration': '听歌时长',
  'stats.playCount': '播放次数',
  'stats.todayDuration': '今日时长',
  'stats.weekDuration': '本周时长',
  'stats.libraryScale': '曲库规模',
  'stats.losslessRatio': '无损占比',
  'stats.songCount': '{count} 首',
  'stats.trendTitle': '近 7 天听歌趋势',
  'stats.trendEmpty': '最近 7 天还没有听歌记录',
  'stats.hourTitle': '24 小时播放分布',
  'stats.hourEmpty': '还没有播放记录',
  'stats.peakHour': '峰值在 {hour} 点',
  'stats.topSongs': '歌曲 Top 5',
  'stats.topArtists': '艺人 Top 5',
  'stats.topAlbums': '专辑 Top 5',
  'stats.topEmpty': '暂无数据',
  'stats.compositionTitle': '曲库构成',
  'stats.compLossless': '无损',
  'stats.compHires': '高解析',
  'stats.compOther': '其它',
  'stats.unknownSong': '未知歌曲',
  'stats.unknownArtist': '未知歌手',
  'stats.deletedSong': '已删除歌曲',
  'stats.loadFailed': '加载失败：',
  'stats.retry': '重试',
} as const;

export type I18nKey = keyof typeof zhCN; // 实现

const enUS: Record<I18nKey, string> = { // 实现
  'language.section': 'Language', // 实现
  'language.label': 'App language', // 实现
  'language.description': 'Choose the interface language. Changes apply immediately.', // 实现
  'language.system': 'Follow system',
  'language.zhCN': '简体中文', // 实现
  'language.zhTW': '繁體中文',
  'language.enUS': 'English', // 实现

  'settings.account': 'Account', // 实现
  'settings.general': 'General', // 实现
  'settings.plugins': 'Source',
  'settings.theme': 'Appearance', // 实现
  'settings.playback': 'Playback', // 实现
  'settings.pluginHost': 'Audio Plugins',
  'settings.download': 'Downloads', // 实现
  'settings.library': 'Library', // 实现
  'settings.toolbox': 'Toolbox', // 实现
  'settings.desktopLyrics': 'Desktop Lyrics', // 实现
  'settings.sleepTimer': 'Sleep timer',

  'sleepTimer.title': 'Sleep timer',
  'sleepTimer.description': 'Pause playback at the set time, or after a period without input; can also exit the app or hide to the tray.',
  'sleepTimer.modeLabel': 'Trigger',
  'sleepTimer.modeHint': 'A countdown deadline, or a period without in-app input',
  'sleepTimer.modeCountdown': 'Countdown',
  'sleepTimer.modeIdle': 'Idle',
  'sleepTimer.countdownLabel': 'Countdown length',
  'sleepTimer.countdownHint': 'Keeps counting even while playback is paused (wall clock)',
  'sleepTimer.idleLabel': 'Idle length',
  'sleepTimer.idleHint': 'Only counts in-app pointer / keyboard / wheel / touch input; does not fire while paused',
  'sleepTimer.minutes': 'minutes',
  'sleepTimer.customMinutes': 'Custom minutes',
  'sleepTimer.actionLabel': 'Action at deadline',
  'sleepTimer.actionHint': 'Volume fades out before pausing',
  'sleepTimer.actionPause': 'Pause playback',
  'sleepTimer.actionExit': 'Exit app',
  'sleepTimer.actionHideToTray': 'Hide to tray',
  'sleepTimer.start': 'Start',
  'sleepTimer.cancel': 'Cancel',
  'sleepTimer.runningLabel': 'Running',
  'sleepTimer.idle': 'Not started',
  'sleepTimer.notRunningHint': 'Pick a trigger and an action, then press Start',
  'sleepTimer.toastPaused': 'Sleep timer paused playback',
  'sleepTimer.toastHidden': 'Sleep timer hid the window to the tray',
  'settings.shortcuts': 'Quick Keys',
  'settings.network': 'Network',
  'settings.advanced': 'Advanced', // 实现
  'settings.linkage': 'Linkage',
  'settings.feedback': 'Feedback',
  'settings.debug': 'Debug', // 实现
  'settings.about': 'About', // 实现
  'settings.search': 'Search settings', // 实现
  'settings.clearSearch': 'Clear settings search', // 实现
  'settings.results': '{count} settings found', // 实现
  'settings.noResults': 'No matching settings', // 实现
  'settings.searchHint': 'Try “quality”, “lyrics”, or “cache”', // 实现
  'settings.resizeHint': 'Drag to resize the sidebar; double-click to reset', // 实现
  'settings.building': 'Coming soon', // 实现
  'settings.buildingHint': 'This settings section is being prepared.', // 实现

  'general.section': 'General & Startup', // 实现
  'general.launchOnStartup': 'Launch at startup', // 实现
  'general.launchOnStartupMinimized': 'Minimize to tray when launched at startup',
  'general.checkUpdates': 'Check for updates at startup', // 实现
  'general.welcomeToast': 'Show version toast at startup',
  'general.gpuAcceleration': 'GPU acceleration', // 实现
  'general.performanceMode': 'Performance mode',
  'general.performanceModeHint': 'Automatically reduce frosted glass and dynamic effects on low-end devices for smoother performance',
  'general.pmAuto': 'Auto',
  'general.pmFull': 'Full effects',
  'general.pmPerformance': 'Performance first',
  'general.closeToTray': 'Minimize to tray when closing', // 实现
  'general.showQualityBadges': 'Show quality badges', // 实现
  'general.showSongComments': 'Show song comments', // 实现
  'general.scrollToTop': 'Show scroll-to-top button', // 实现
  'general.taskbarControls': 'Enable taskbar playback controls', // 实现
  'general.writeArtistAvatar': 'Write artist avatar changes to audio tags', // 实现
  'general.writeArtistAvatarHint': 'Updates local audio files when an artist avatar changes. Collaborations, remote tracks, CUE tracks, and read-only files are skipped.', // 实现
  'general.songClickAction': 'Double-click to play',
  'general.songClickActionHint': 'When enabled, double-click plays a song; when disabled, single-click plays it.',
  'general.fileAssoc': 'Audio file associations',
  'general.fileAssocHint': 'Checked formats appear in the system "Open with" list. To also make one the default for double-click, pick "XianYu Music" and click "Always" in the "How do you want to open this file?" dialog the first time.',
  'general.fileAssocNote': 'Windows protects your confirmed default-app choice, so checking a format cannot rewrite the double-click default (a system restriction no app can bypass). Clicking "Always" once in that dialog makes it stick, and later double-clicks open directly without asking.',
  'general.fileAssocWindowsOnly': 'This feature is only available on Windows.',
  'general.fileAssocAll': 'Select all',
  'general.fileAssocNone': 'Select none',
  'theme.glassSwitch': 'Liquid Glass',
  'theme.glassSwitchDesc': 'High-transparency refraction and sheen sweep',
  'theme.flatSwitch': 'Classic Flat',
  'theme.flatSwitchDesc': 'Clean, flat style without glass blur',
  'general.storage': 'Storage', // 实现
  'general.cacheLimit': 'Playback cache limit', // 实现
  'general.cacheLimitHint': 'Online tracks are cached locally for replay. The oldest unused tracks are removed when the cache is full.', // 实现
  'general.clearCache': 'Clear online playback cache', // 实现
  'general.clearCacheHint': 'The current track is not affected. Other cached tracks will need to be downloaded again.', // 实现
  'general.clearing': 'Clearing...', // 实现
  'general.clear': 'Clear', // 实现
  'general.resetData': 'Reset data', // 实现
  'general.resetting': 'Resetting...', // 实现
  'general.scanUnavailable': 'Unavailable while scanning', // 实现
  'general.reset': 'Reset', // 实现
  'general.resetConfirm': 'This clears the library, playback history, favorites, and settings, but does not delete your music files. Continue?', // 实现

  'toast.gpuUpdated': 'GPU acceleration updated. Restart the app to apply it.', // 实现
  'toast.gpuFailed': 'Could not save the GPU acceleration setting', // 实现
  'toast.cacheCleared': 'Online playback cache cleared', // 实现
  'toast.cacheClearFailed': 'Could not clear the online playback cache', // 实现
  'toast.resetFailed': 'Could not clear app data. Please try again.', // 实现
  'toast.welcome': 'Welcome to XianYu Music · v{version}', // 实现

  'sidebar.home': 'Home', // 实现
  'sidebar.localMusic': 'Local Music', // 实现
  'sidebar.artists': 'Artists', // 实现
  'sidebar.albums': 'Albums', // 实现
  'sidebar.favorites': 'Favorites', // 实现
  'sidebar.recent': 'Recently Played', // 实现
  'sidebar.folders': 'Folders', // 实现
  'sidebar.plugins': 'Plugin Manager', // 实现
  'sidebar.account': 'Account', // 实现
  'sidebar.topLists': 'Top Lists',
  'sidebar.dailyRecommend': 'Daily Mix',

  'topbar.search': 'Search music...', // 实现
  'topbar.recognize': 'Identify Song', // 实现
  'topbar.back': 'Back', // 实现
  'topbar.lightText': 'Use light text', // 实现
  'topbar.darkText': 'Use dark text', // 实现
  'topbar.lightTheme': 'Switch to light theme', // 实现
  'topbar.darkTheme': 'Switch to dark theme', // 实现
  'topbar.profile': 'Profile', // 实现
  'topbar.login': 'Sign in / Register', // 实现
  'topbar.announcement': 'Announcements', // 实现
  'topbar.viewAnnouncement': 'View announcements', // 实现
  'topbar.settings': 'Settings', // 实现
  'topbar.skin': 'Skin', // 实现
  'topbar.searchHistory': 'Search history', // 实现
  'topbar.clearHistory': 'Clear', // 实现
  'topbar.hotSearch': 'Hot',
  'topbar.history': 'History',
  'topbar.everyoneSearching': 'Everyone is searching',
  'topbar.hotSearchLoading': 'Loading...',
  'topbar.hotSearchEmpty': 'No hot searches yet',
  'topbar.historyEmpty': 'No search history',
  'topbar.miniMode': 'Mini mode', // 实现
  'topbar.minimize': 'Minimize', // 实现
  'topbar.maximize': 'Maximize', // 实现
  'topbar.maximizeUnavailable': 'Unavailable in fullscreen', // 实现
  'topbar.close': 'Close', // 实现

  'pluginHost.effectsRack': 'Effects Plugin Rack',
  'pluginHost.enableRack': 'Audio Effect Rack',
  'pluginHost.rackDesc': 'Chains audio plugins in rack order right before the final volume stage. Currently supports VST3 and CLAP formats. While enabled, WASAPI exclusive mode, native DSD passthrough and Bit-perfect output are disabled (they bypass the rack) and the global EQ is locked; volume and quality switching remain available.',
  'pluginHost.customScanDirs': 'Custom scan directories',
  'pluginHost.count': '{count} items',
  'pluginHost.scanDirsHint': 'Plugins auto-rescan after adding and are added to the rack (disabled by default). The directory type (VST3 / CLAP) is detected automatically by name or content.',
  'pluginHost.addDir': 'Add directory',
  'pluginHost.noDirsHint': 'No custom directories added. Plugins are scanned from the standard system directories by default; add a location here to load from elsewhere.',
  'pluginHost.removeDirTooltip': 'Remove this scan directory',
  'pluginHost.scanning': 'Scanning...',
  'pluginHost.rescan': 'Rescan',
  'pluginHost.scanningDirs': 'Scanning standard plugin directories...',
  'pluginHost.rackChain': 'Rack chain',
  'pluginHost.slotCount': '{count} slots',
  'pluginHost.emptyRack': 'The rack is empty. Click "Scan" in the title to discover VST3 / CLAP plugins; results are added to the rack (disabled by default).',
  'pluginHost.searchPlaceholder': 'Search plugins...',
  'pluginHost.clearSearch': 'Clear',
  'pluginHost.scanningCurrent': 'Scanning: ',
  'pluginHost.dblClickHint': 'Double-click to open the plugin native UI editor',
  'pluginHost.restoreRemoved': 'Restore removed',
  'pluginHost.dismissedHint': '{count} plugins removed; they won\'t auto-add on rescan',
  'pluginHost.timeoutTitle': 'Plugin scan timed out',
  'pluginHost.timeoutContent': 'Plugin [{name}] took over 4 seconds to respond during scan. It may have a lost dongle, hang, or be incompatible. Skip and disable it?',
  'pluginHost.rememberTimeout': 'Remember this choice for all problematic plugins',
  'pluginHost.unknownVendor': 'Unknown vendor',
  'pluginHost.disabledSuffix': 'disabled',
  'pluginHost.moveUp': 'Move up',
  'pluginHost.moveDown': 'Move down',
  'pluginHost.paramsPresets': 'Parameters & presets',
  'pluginHost.disableSlot': 'Disable this plugin',
  'pluginHost.enableSlot': 'Enable this plugin',
  'pluginHost.removeFromRack': 'Remove from rack',
  'pluginHost.loadingParams': 'Loading plugin parameters...',
  'pluginHost.paramsReadFailed': 'Failed to read parameters: {err}',
  'pluginHost.presetLoadFailed': 'Failed to load preset: {err}',
  'pluginHost.factoryPresets': 'Factory presets',
  'pluginHost.noParams': 'This plugin has no adjustable parameters.',
  'pluginHost.catEffect': 'Effect',
  'pluginHost.catInstrument': 'Instrument',
  'pluginHost.catNoteEffect': 'Note Effect',
  'pluginHost.catAnalyzer': 'Analyzer',
  'pluginHost.catTool': 'Tool',
  'pluginHost.removeTitle': 'Remove plugin',
  'pluginHost.removeContent': 'Remove "{name}" from the rack? Its parameter settings will also be cleared.',
  'pluginHost.removeDirTitle': 'Remove scan directory',
  'pluginHost.removeDirContent': 'Remove this scan directory? Plugins in it will no longer be scanned.',

  'dlna.title': 'DLNA Cast',
  'dlna.lanDevices': 'Local Network Devices',
  'dlna.rescan': 'Rescan',
  'dlna.scanning': 'Scanning for devices...',
  'dlna.noDevices': 'No devices found',
  'dlna.noDevicesHint': 'Ensure TV/speaker has DLNA enabled and is on the same network',
  'dlna.disconnect': 'Disconnect',
  'dlna.connectedHint': 'After connection, playback will automatically cast to the device. Play/pause/progress/volume controls will remote control the device.',
  'dlna.castingTo': 'Casting to "{name}"',
  'dlna.connected': 'Connected to "{name}". Play a song to start casting.',
  'dlna.connectFailed': 'Failed to connect to "{name}"',
  'dlna.disconnected': 'Casting disconnected',
  'dlna.disconnectFailed': 'Failed to disconnect casting',
  'dlna.scanFailed': 'Device scan failed. Please check firewall settings.',
  'dlna.noDeviceFound': 'No DLNA devices found. Ensure device is on the same network.',
  'dlna.deviceLost': 'Casting device connection lost',
  'dlna.dmrlLoadTitle': 'DLNA Cast',
  'dlna.settings.title': 'DLNA Renderer',
  'dlna.settings.desc': 'When enabled, this device will appear as a DLNA device on the local network. Other apps (e.g., QQ Music, NetEase Cloud Music) can cast directly to XianYu Music.',
  'dlna.settings.enable': 'Allow casting from other devices',
  'dlna.settings.running': 'Running · Port {port}',
  'dlna.settings.notRunning': 'Not running (must be on the same network as casting device)',
  'dlna.settings.name': 'Device name (as seen by casting devices)',
  'dlna.settings.namePlaceholder': 'XianYu Music',
  'dlna.settings.firewallHint': 'Windows may show a firewall prompt when first enabled. Allow "Private networks" access, otherwise the device may not be discoverable.',

  'stats.rangeLabel': 'Time range',
  'stats.rangeAll': 'All',
  'stats.rangeDays7': '7 days',
  'stats.rangeDays30': '30 days',
  'stats.rangeThisYear': 'This year',
  'stats.listenDuration': 'Listening time',
  'stats.playCount': 'Plays',
  'stats.todayDuration': "Today's time",
  'stats.weekDuration': 'This week',
  'stats.libraryScale': 'Library scale',
  'stats.losslessRatio': 'Lossless share',
  'stats.songCount': '{count} songs',
  'stats.trendTitle': 'Last 7 days',
  'stats.trendEmpty': 'No listening activity in the last 7 days',
  'stats.hourTitle': 'Plays by hour',
  'stats.hourEmpty': 'No play history yet',
  'stats.peakHour': 'Peak at {hour}:00',
  'stats.topSongs': 'Top songs',
  'stats.topArtists': 'Top artists',
  'stats.topAlbums': 'Top albums',
  'stats.topEmpty': 'No data',
  'stats.compositionTitle': 'Library composition',
  'stats.compLossless': 'Lossless',
  'stats.compHires': 'Hi-Res',
  'stats.compOther': 'Other',
  'stats.unknownSong': 'Unknown song',
  'stats.unknownArtist': 'Unknown artist',
  'stats.deletedSong': 'Deleted song',
  'stats.loadFailed': 'Failed to load: ',
  'stats.retry': 'Retry',
};

const messages: Record<AppLanguage, Record<I18nKey, string>> = { // 实现
  'system': zhCN,
  'zh-CN': zhCN, // 实现
  'zh-TW': zhCN,
  'en-US': enUS, // 实现
};

export type TranslationParams = Record<string, string | number>; // 实现

function resolveSystemLanguage(): AppLanguage {
  if (typeof navigator === 'undefined') return 'zh-CN';
  const navLang = navigator.language || 'zh-CN';
  if (navLang.startsWith('zh-TW') || navLang.startsWith('zh-Hant') || navLang.startsWith('zh-HK') || navLang.startsWith('zh-MO')) {
    return 'zh-TW';
  }
  if (navLang.startsWith('en')) return 'en-US';
  return 'zh-CN';
}

export function resolveLanguage(lang: AppLanguage): AppLanguage {
  return lang === 'system' ? resolveSystemLanguage() : lang;
}

export const translate = ( // 实现
  language: AppLanguage, // 实现
  key: I18nKey, // 实现
  params: TranslationParams = {}, // 实现
): string => { // 实现
  const resolved = resolveLanguage(language);
  const template = messages[resolved]?.[key] ?? zhCN[key] ?? key;
  const translated = resolved === 'zh-TW' ? toTraditional(template) : template;
  return translated.replace(/\{(\w+)\}/g, (match, name: string) => (
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match // 实现
  ));
};

export interface I18nContext { // 实现
  language: ComputedRef<AppLanguage>; // 实现
  isEnglish: ComputedRef<boolean>; // 实现
  isTraditional: ComputedRef<boolean>;
  t: (key: I18nKey, params?: TranslationParams) => string; // 实现
}

export const useI18n = (): I18nContext => { // 实现
  const settingsStore = useSettingsStore(); // 实现
  const { settings } = storeToRefs(settingsStore); // 实现
  const storedLanguage = computed(() => settings.value.language ?? 'zh-CN');
  const language = computed(() => resolveLanguage(storedLanguage.value));

  return {
    language,
    isEnglish: computed(() => language.value === 'en-US'), // 实现
    isTraditional: computed(() => language.value === 'zh-TW'),
    t: (key, params) => translate(language.value, key, params), // 实现
  };
};
