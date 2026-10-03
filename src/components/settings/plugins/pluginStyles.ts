import type { PluginSource } from '../../../types';

/** 插件卡片按格式/品牌配色：图标底色、图标文字色、开关底色、标签样式与展示名 */
export function pluginColorClasses(format: PluginSource['format'], isBaka = false) {
  if (format === 'lx') {
    return {
      iconBg: 'bg-gradient-to-br from-green-500/12 to-emerald-400/12',
      iconText: 'text-green-600 dark:text-green-400',
      toggle: 'bg-green-500',
      tagClass: 'settings-plugin-tag--lx',
      label: '落雪',
    };
  }
  if (format === 'anime') {
    return {
      iconBg: 'bg-gradient-to-br from-purple-500/12 to-fuchsia-400/12',
      iconText: 'text-purple-600 dark:text-purple-400',
      toggle: 'bg-purple-500',
      tagClass: 'settings-plugin-tag--anime',
      label: 'anime',
    };
  }
  if (format === 'musicfree') {
    if (isBaka) {
      return {
        iconBg: 'bg-gradient-to-br from-blue-500/12 to-indigo-400/12',
        iconText: 'text-blue-600 dark:text-blue-400',
        toggle: 'bg-blue-500',
        tagClass: 'settings-plugin-tag--baka',
        label: 'BakaMusic',
      };
    }
    return {
      iconBg: 'bg-gradient-to-br from-orange-500/12 to-amber-400/12',
      iconText: 'text-orange-600 dark:text-orange-400',
      toggle: 'bg-orange-500',
      tagClass: 'settings-plugin-tag--musicfree',
      label: 'MusicFree',
    };
  }
  return {
    iconBg: 'bg-gradient-to-br from-[#EC4141]/12 to-[#ff8b8b]/12',
    iconText: 'text-[#EC4141]',
    toggle: 'bg-[#EC4141]',
    tagClass: '',
    label: '未知',
  };
}
