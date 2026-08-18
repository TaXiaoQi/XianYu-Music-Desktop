import { computed, type ComputedRef } from 'vue';
import { storeToRefs } from 'pinia';

import type { AppLanguage } from '../../types';
import { useSettingsStore } from '../settings/store';
import { toTraditional } from './traditional';

const zhCN = {
  'language.section': '语言',
  'language.label': '软件语言',
  'language.description': '选择界面显示语言，切换后立即生效。',
  'language.system': '跟随系统',
  'language.zhCN': '简体中文',
  'language.zhTW': '繁體中文',
  'language.enUS': 'English',

  'settings.account': '账号',
  'settings.general': '常规',
  'settings.plugins': '插件',
  'settings.theme': '外观',
  'settings.playback': '播放',
  'settings.download': '下载',
  'settings.library': '音乐库',
  'settings.toolbox': '工具箱',
  'settings.desktopLyrics': '桌面歌词',
  'settings.shortcuts': '快捷按键',
  'settings.advanced': '高级设置',
  'settings.debug': '调试',
  'settings.about': '关于',
  'settings.search': '搜索设置',
  'settings.clearSearch': '清除设置搜索',
  'settings.results': '找到 {count} 项设置',
  'settings.noResults': '没有找到相关设置',
  'settings.searchHint': '试试搜索“音质”“歌词”或“缓存”',
  'settings.resizeHint': '按住拖拽调整侧边栏宽度，双击恢复默认',
  'settings.building': '施工中',
  'settings.buildingHint': '当前设置模块正在整理中。',

  'general.section': '常规与启动',
  'general.launchOnStartup': '开机自动运行',
  'general.checkUpdates': '启动检测更新',
  'general.gpuAcceleration': 'GPU 加速',
  'general.closeToTray': '关闭时最小化至托盘',
  'general.showQualityBadges': '显示音质标识',
  'general.showSongComments': '显示歌曲注释',
  'general.scrollToTop': '打开一键回顶按钮',
  'general.taskbarControls': '启用任务栏快捷播控',
  'general.writeArtistAvatar': '修改歌手头像时同步写回音频标签',
  'general.writeArtistAvatarHint': '开启后，手动修改歌手头像时会同步修改本地音频文件（多歌手合作歌曲、远程歌曲、CUE 分轨和只读文件会被自动跳过）。',
  'general.songClickAction': '歌曲播放触发方式',
  'general.singleClick': '单击',
  'general.doubleClick': '双击',
  'general.storage': '存储空间',
  'general.cacheLimit': '播放缓存上限',
  'general.cacheLimitHint': '在线歌曲下载后会缓存到本地，再次播放无需重新下载；缓存满后自动清理最久未播放的曲目。',
  'general.clearCache': '清理在线播放缓存',
  'general.clearCacheHint': '清理不会影响正在播放的歌曲，其他已缓存曲目需要重新下载。',
  'general.clearing': '清理中...',
  'general.clear': '清理',
  'general.resetData': '重置数据',
  'general.resetting': '重置中...',
  'general.scanUnavailable': '扫描中不可用',
  'general.reset': '重置',
  'general.resetConfirm': '此操作会清空媒体库、播放记录、收藏和设置，并恢复初始状态，但不会删除你的音乐文件。确定继续吗？',

  'toast.gpuUpdated': 'GPU 加速设置已更新，重启软件后生效',
  'toast.gpuFailed': 'GPU 加速设置保存失败',
  'toast.cacheCleared': '在线播放缓存已清理',
  'toast.cacheClearFailed': '清理在线播放缓存失败',
  'toast.resetFailed': '清除所有数据失败，请重试',
  'toast.welcome': '欢迎使用弦予音乐，当前版本 v{version}',

  'sidebar.home': '首页',
  'sidebar.localMusic': '本地音乐',
  'sidebar.artists': '歌手',
  'sidebar.albums': '专辑',
  'sidebar.favorites': '我的收藏',
  'sidebar.recent': '最近播放',
  'sidebar.folders': '文件夹',
  'sidebar.plugins': '插件管理',
  'sidebar.account': '账号',

  'topbar.search': '搜索音乐...',
  'topbar.recognize': '听歌识曲',
  'topbar.back': '后退',
  'topbar.lightText': '切换浅色字体',
  'topbar.darkText': '切换深色字体',
  'topbar.lightTheme': '切换浅色',
  'topbar.darkTheme': '切换深色',
  'topbar.profile': '个人中心',
  'topbar.login': '登录 / 注册',
  'topbar.announcement': '公告',
  'topbar.viewAnnouncement': '查看公告',
  'topbar.settings': '设置',
  'topbar.skin': '皮肤',
  'topbar.searchHistory': '搜索历史',
  'topbar.clearHistory': '清空',
  'topbar.hotSearch': '热搜',
  'topbar.history': '记录',
  'topbar.everyoneSearching': '大家都在搜',
  'topbar.hotSearchLoading': '加载中...',
  'topbar.hotSearchEmpty': '暂无热搜数据',
  'topbar.historyEmpty': '暂无搜索记录',
  'topbar.miniMode': 'Mini 模式',
  'topbar.minimize': '最小化',
  'topbar.maximize': '最大化',
  'topbar.maximizeUnavailable': '全屏模式下不可用',
  'topbar.close': '关闭',
} as const;

export type I18nKey = keyof typeof zhCN;

const enUS: Record<I18nKey, string> = {
  'language.section': 'Language',
  'language.label': 'App language',
  'language.description': 'Choose the interface language. Changes apply immediately.',
  'language.system': 'Follow system',
  'language.zhCN': '简体中文',
  'language.zhTW': '繁體中文',
  'language.enUS': 'English',

  'settings.account': 'Account',
  'settings.general': 'General',
  'settings.plugins': 'Plugins',
  'settings.theme': 'Appearance',
  'settings.playback': 'Playback',
  'settings.download': 'Downloads',
  'settings.library': 'Library',
  'settings.toolbox': 'Toolbox',
  'settings.desktopLyrics': 'Desktop Lyrics',
  'settings.shortcuts': 'Quick Keys',
  'settings.advanced': 'Advanced',
  'settings.debug': 'Debug',
  'settings.about': 'About',
  'settings.search': 'Search settings',
  'settings.clearSearch': 'Clear settings search',
  'settings.results': '{count} settings found',
  'settings.noResults': 'No matching settings',
  'settings.searchHint': 'Try “quality”, “lyrics”, or “cache”',
  'settings.resizeHint': 'Drag to resize the sidebar; double-click to reset',
  'settings.building': 'Coming soon',
  'settings.buildingHint': 'This settings section is being prepared.',

  'general.section': 'General & Startup',
  'general.launchOnStartup': 'Launch at startup',
  'general.checkUpdates': 'Check for updates at startup',
  'general.gpuAcceleration': 'GPU acceleration',
  'general.closeToTray': 'Minimize to tray when closing',
  'general.showQualityBadges': 'Show quality badges',
  'general.showSongComments': 'Show song comments',
  'general.scrollToTop': 'Show scroll-to-top button',
  'general.taskbarControls': 'Enable taskbar playback controls',
  'general.writeArtistAvatar': 'Write artist avatar changes to audio tags',
  'general.writeArtistAvatarHint': 'Updates local audio files when an artist avatar changes. Collaborations, remote tracks, CUE tracks, and read-only files are skipped.',
  'general.songClickAction': 'Play songs with',
  'general.singleClick': 'Single click',
  'general.doubleClick': 'Double click',
  'general.storage': 'Storage',
  'general.cacheLimit': 'Playback cache limit',
  'general.cacheLimitHint': 'Online tracks are cached locally for replay. The oldest unused tracks are removed when the cache is full.',
  'general.clearCache': 'Clear online playback cache',
  'general.clearCacheHint': 'The current track is not affected. Other cached tracks will need to be downloaded again.',
  'general.clearing': 'Clearing...',
  'general.clear': 'Clear',
  'general.resetData': 'Reset data',
  'general.resetting': 'Resetting...',
  'general.scanUnavailable': 'Unavailable while scanning',
  'general.reset': 'Reset',
  'general.resetConfirm': 'This clears the library, playback history, favorites, and settings, but does not delete your music files. Continue?',

  'toast.gpuUpdated': 'GPU acceleration updated. Restart the app to apply it.',
  'toast.gpuFailed': 'Could not save the GPU acceleration setting',
  'toast.cacheCleared': 'Online playback cache cleared',
  'toast.cacheClearFailed': 'Could not clear the online playback cache',
  'toast.resetFailed': 'Could not clear app data. Please try again.',
  'toast.welcome': 'Welcome to XianYu Music · v{version}',

  'sidebar.home': 'Home',
  'sidebar.localMusic': 'Local Music',
  'sidebar.artists': 'Artists',
  'sidebar.albums': 'Albums',
  'sidebar.favorites': 'Favorites',
  'sidebar.recent': 'Recently Played',
  'sidebar.folders': 'Folders',
  'sidebar.plugins': 'Plugin Manager',
  'sidebar.account': 'Account',

  'topbar.search': 'Search music...',
  'topbar.recognize': 'Identify Song',
  'topbar.back': 'Back',
  'topbar.lightText': 'Use light text',
  'topbar.darkText': 'Use dark text',
  'topbar.lightTheme': 'Switch to light theme',
  'topbar.darkTheme': 'Switch to dark theme',
  'topbar.profile': 'Profile',
  'topbar.login': 'Sign in / Register',
  'topbar.announcement': 'Announcements',
  'topbar.viewAnnouncement': 'View announcements',
  'topbar.settings': 'Settings',
  'topbar.skin': 'Skin',
  'topbar.searchHistory': 'Search history',
  'topbar.clearHistory': 'Clear',
  'topbar.hotSearch': 'Hot',
  'topbar.history': 'History',
  'topbar.everyoneSearching': 'Everyone is searching',
  'topbar.hotSearchLoading': 'Loading...',
  'topbar.hotSearchEmpty': 'No hot searches yet',
  'topbar.historyEmpty': 'No search history',
  'topbar.miniMode': 'Mini mode',
  'topbar.minimize': 'Minimize',
  'topbar.maximize': 'Maximize',
  'topbar.maximizeUnavailable': 'Unavailable in fullscreen',
  'topbar.close': 'Close',
};

const messages: Record<AppLanguage, Record<I18nKey, string>> = {
  // 'system' 在运行时由 resolveLanguage 解析为实际语言，此处仅满足类型约束。
  'system': zhCN,
  'zh-CN': zhCN,
  // 繁体词条由简体运行时转换生成，避免维护第三份词表。
  'zh-TW': zhCN,
  'en-US': enUS,
};

export type TranslationParams = Record<string, string | number>;

/** 根据 navigator.language 推测系统语言，映射到支持的 AppLanguage。 */
function resolveSystemLanguage(): AppLanguage {
  if (typeof navigator === 'undefined') return 'zh-CN';
  const navLang = navigator.language || 'zh-CN';
  if (navLang.startsWith('zh-TW') || navLang.startsWith('zh-Hant') || navLang.startsWith('zh-HK') || navLang.startsWith('zh-MO')) {
    return 'zh-TW';
  }
  if (navLang.startsWith('en')) return 'en-US';
  return 'zh-CN';
}

/** 将 'system' 解析为实际语言，非 'system' 原样返回。 */
export function resolveLanguage(lang: AppLanguage): AppLanguage {
  return lang === 'system' ? resolveSystemLanguage() : lang;
}

export const translate = (
  language: AppLanguage,
  key: I18nKey,
  params: TranslationParams = {},
): string => {
  const resolved = resolveLanguage(language);
  const template = messages[resolved]?.[key] ?? zhCN[key] ?? key;
  // 繁体：先取简体模板再整体转换（含插值后的中文参数由调用方自理）。
  const translated = resolved === 'zh-TW' ? toTraditional(template) : template;
  return translated.replace(/\{(\w+)\}/g, (match, name: string) => (
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  ));
};

export interface I18nContext {
  language: ComputedRef<AppLanguage>;
  isEnglish: ComputedRef<boolean>;
  isTraditional: ComputedRef<boolean>;
  t: (key: I18nKey, params?: TranslationParams) => string;
}

export const useI18n = (): I18nContext => {
  const settingsStore = useSettingsStore();
  const { settings } = storeToRefs(settingsStore);
  const storedLanguage = computed(() => settings.value.language ?? 'zh-CN');
  const language = computed(() => resolveLanguage(storedLanguage.value));

  return {
    language,
    isEnglish: computed(() => language.value === 'en-US'),
    isTraditional: computed(() => language.value === 'zh-TW'),
    t: (key, params) => translate(language.value, key, params),
  };
};
