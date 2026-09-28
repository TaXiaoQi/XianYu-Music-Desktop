// 右键菜单面板外观常量。玻璃质感一套（Folder / Playlist / Song 共用），
// 底栏菜单另一套（含暗色模式与 tailwindcss-animate 入场）。
const GLASS_PAINT =
  'select-none rounded-[18px] border border-white/65 bg-white/78 py-1.5 text-sm text-gray-700 ' +
  'backdrop-blur-[22px] supports-[backdrop-filter]:bg-white/72 ' +
  'shadow-[0_20px_45px_rgba(15,23,42,0.16),0_6px_18px_rgba(15,23,42,0.08)]';

export const GLASS_SHEET = `fixed z-[9999] min-w-[220px] ${GLASS_PAINT}`;

// 艺术家子菜单：更高层级，宽度收窄并限制上限
export const GLASS_SHEET_WIDE = `fixed z-[10000] min-w-[200px] max-w-[280px] ${GLASS_PAINT}`;

export const FOOTER_SHEET =
  'fixed z-[9999] min-w-[210px] rounded-[16px] select-none border border-gray-200/60 dark:border-white/10 ' +
  'bg-white/88 dark:bg-[#1e1e20]/90 py-1.5 text-sm text-gray-700 dark:text-gray-200 ' +
  'shadow-xl backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-75';
