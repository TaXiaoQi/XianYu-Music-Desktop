import { FOOTER_ITEMS } from './footerItems';
import { shortcutActionLabels } from './shortcuts';
import { SIDEBAR_ITEMS } from './sidebarItems';

export type SettingsTabId =
  | 'general'
  | 'theme'
  | 'desktopLyrics'
  | 'audioOutput'
  | 'download'
  | 'toolbox'
  | 'library'
  | 'plugins'
  | 'shortcuts'
  | 'account'
  | 'advanced'
  | 'about';

export interface SettingsSearchItem {
  id: string;
  tab: SettingsTabId;
  tabName: string;
  section: string;
  label: string;
  target: string;
  keywords: string;
  kind: 'category' | 'section' | 'setting';
}

type SearchItemInput = string | {
  label: string;
  target?: string;
  keywords?: string;
};

const TAB_NAMES: Record<SettingsTabId, string> = {
  account: '账号',
  general: '常规',
  plugins: '插件',
  theme: '外观',
  audioOutput: '播放',
  download: '下载',
  library: '音乐库',
  toolbox: '工具箱',
  desktopLyrics: '桌面歌词',
  shortcuts: '快捷键',
  advanced: '高级设置',
  about: '关于',
};

const makeItems = (
  tab: SettingsTabId,
  section: string,
  items: SearchItemInput[],
): SettingsSearchItem[] => items.map((item, index) => {
  const normalized = typeof item === 'string' ? { label: item } : item;
  return {
    id: `${tab}-${section}-${index}`,
    tab,
    tabName: TAB_NAMES[tab],
    section,
    label: normalized.label,
    target: normalized.target ?? normalized.label,
    keywords: normalized.keywords ?? '',
    kind: 'setting',
  };
});

const staticItems: SettingsSearchItem[] = [
  ...makeItems('general', '常规与启动', [
    { label: '开机自动运行', keywords: '启动 自启动' },
    { label: 'GPU 加速', keywords: '硬件 图形 性能' },
    { label: '关闭时最小化至托盘', keywords: '退出 后台 托盘' },
    { label: '显示音质标识', keywords: '无损 Hi-Res 标签' },
    { label: '显示歌曲注释', keywords: '备注 注释' },
    { label: '打开一键回顶按钮', keywords: '滚动 顶部' },
    { label: '启用任务栏快捷播控', keywords: '任务栏 播放控制' },
    { label: '修改歌手头像时同步写回音频标签', keywords: '头像 tag 标签 写入' },
  ]),
  ...makeItems('general', '存储空间', [
    { label: '播放缓存上限', keywords: '在线 缓存 容量 GB' },
    { label: '清理在线播放缓存', keywords: '删除 清空 缓存' },
    { label: '重置数据', keywords: '恢复初始 清空设置' },
  ]),

  ...makeItems('theme', '配色方案', [
    { label: '深色', keywords: '暗色 黑夜 主题' },
    { label: '浅色', keywords: '明亮 白天 主题' },
    { label: '跟随系统', keywords: '自动 系统主题' },
    { label: '自定义皮肤', target: '自定义', keywords: '壁纸 背景 图片 字体颜色 遮罩' },
  ]),
  ...makeItems('theme', '动态背景', [
    { label: '关闭动态背景', target: '关闭', keywords: '禁用 动态背景' },
    { label: '流光背景', target: '流光', keywords: '动态 封面' },
    { label: '静态模糊背景', target: '静态模糊', keywords: '封面 毛玻璃' },
    { label: '色彩强度', target: '动态背景', keywords: '流光微调 柔和 鲜艳' },
    { label: '明暗深度', target: '动态背景', keywords: '流光微调 通透 深邃' },
    { label: '流动速度', target: '动态背景', keywords: '流光微调 舒缓 灵动' },
    { label: '纹理强度', target: '动态背景', keywords: '流光微调 干净 细腻' },
  ]),
  ...makeItems('theme', '窗口材质', [
    { label: 'Acrylic', keywords: '亚克力 Windows 11 透明' },
    { label: 'Mica', keywords: '云母 Windows 11 材质' },
    { label: '毛玻璃', keywords: 'Blur 模糊 材质' },
    { label: '遮罩浓淡', target: '窗口材质', keywords: '通透 实色 模糊微调' },
    { label: '失焦保持材质', keywords: '窗口 失去焦点' },
  ]),
  ...makeItems('theme', '侧边栏管理', [
    { label: '侧边栏管理', keywords: '显示 隐藏 排序 导航' },
    { label: '首页', keywords: '侧边栏 导航' },
    ...SIDEBAR_ITEMS.map(item => ({
      label: item.label,
      keywords: `侧边栏 导航 显示 隐藏 ${item.description ?? ''}`,
    })),
    { label: '恢复默认顺序', keywords: '侧边栏 排序 重置' },
  ]),
  ...makeItems('theme', '底部栏布局', [
    { label: '底部栏布局与预览', keywords: '播放栏 按钮 拖拽 排序 显示 隐藏 开关' },
    ...FOOTER_ITEMS.map(item => ({
      label: item.label,
      keywords: `底部栏 播放栏 控件 ${item.description}`,
    })),
  ]),

  ...makeItems('audioOutput', '音频处理', [
    { label: '渐入渐出', keywords: '淡入淡出 爆音 播放 暂停' },
    { label: '音量平衡', keywords: 'ReplayGain 响度 标准化' },
    { label: '整体增益偏移', keywords: 'ReplayGain dB 音量' },
    { label: '防削波破音保护', keywords: '峰值 clipping 音量增益' },
  ]),
  ...makeItems('audioOutput', '在线播放', [
    { label: '默认播放音质', keywords: '在线 无损 Hi-Res 320k' },
    { label: '默认音质播放失败行为', keywords: '音质 回退 降级' },
    { label: '起播失败行为', keywords: '播放失败 在线引擎' },
  ]),
  ...makeItems('audioOutput', '均衡器', [
    { label: '在播放栏显示均衡器按钮', keywords: '底栏 EQ 快捷入口' },
    { label: '启用均衡器', keywords: 'EQ 音效 频段' },
  ]),
  ...makeItems('audioOutput', '播放设置', [
    { label: '自动播放', keywords: '启动 播放' },
    { label: '播放设备', keywords: '输出设备 声卡 扬声器 耳机' },
    { label: 'WASAPI 独占模式', keywords: 'Windows 声卡 输出 独占' },
    { label: '歌词同步补偿', keywords: '延迟 偏移 ms 输出设备' },
  ]),

  ...makeItems('download', '下载位置', [
    { label: '下载目录', keywords: '保存路径 文件夹' },
  ]),
  ...makeItems('download', '下载音质', [
    { label: '默认下载音质', keywords: '无损 Hi-Res 320k' },
    { label: '音质缺失行为', keywords: '回退 降级 不可用' },
  ]),
  ...makeItems('download', '文件名与歌词', [
    { label: '文件名样式', keywords: '命名 歌手 歌名' },
    { label: '保留源文件名', keywords: '原始 名称' },
    { label: '同时下载歌词', keywords: '歌词文件 lrc' },
    { label: '歌词格式', keywords: 'LRC YRC 逐字' },
  ]),
  ...makeItems('download', '文件覆盖', [
    { label: '覆盖已存在的文件', keywords: '重复 替换' },
  ]),

  ...makeItems('desktopLyrics', '显示与行为', [
    '窗口置顶',
    '始终显示阴影背景',
    '全屏时自动隐藏',
    '暂停时自动隐藏',
    { label: '逐字效果', keywords: '卡拉OK' },
    '歌词描边',
    { label: '锁定位置并启用鼠标穿透', keywords: '穿透 点击 锁定' },
    '记住锁定状态',
    '桌面歌词自动居中',
    '重置窗口位置',
  ]),
  ...makeItems('desktopLyrics', '歌词同步', [
    { label: '同步偏移', keywords: '延迟 提前 ms' },
  ]),
  ...makeItems('desktopLyrics', '排版与字体', [
    '字号',
    '行距',
    '不透明度',
    '描边阴影',
    '阴影颜色',
    '对齐',
    '显示翻译',
    '显示罗马音',
    '双行显示',
    '字体方案',
    '配色方案',
    '主歌词 已播放',
    '主歌词 未播放',
    '罗马音 已播放',
    '罗马音 未播放',
    '翻译',
  ]),

  ...makeItems('library', '本地音乐库', [
    { label: '导入音乐文件夹', target: '点击导入文件夹', keywords: '添加 扫描 拖入 音频' },
    { label: '排除短音频', keywords: '最短时长 秒 过滤' },
  ]),
  ...makeItems('library', '远程音乐库', [
    { label: '远程音乐库', target: '远程', keywords: 'WebDAV 网络服务器' },
    { label: '名称', keywords: '远程音乐库' },
    { label: '服务器地址', keywords: '远程 URL WebDAV' },
    { label: '用户名', keywords: '远程 登录 账号' },
    { label: '密码', keywords: '远程 登录' },
    { label: '根目录', keywords: '远程 路径 文件夹' },
  ]),

  ...makeItems('plugins', '插件安装', [
    { label: '本地文件安装', target: '通过插件扩展音乐源', keywords: '导入 JS JSON 拖拽' },
    { label: '插件地址', keywords: 'URL 网络安装 链接' },
    { label: '订阅管理', keywords: '订阅源 同步 插件列表' },
  ]),
  ...makeItems('plugins', '插件设置', [
    '启动时自动更新插件',
    { label: '插件懒加载', keywords: '启动速度 延迟初始化' },
    { label: '安装时不校验版本', keywords: '降级 相同版本' },
  ]),
  ...makeItems('plugins', '已安装插件', [
    { label: '搜索已安装插件', target: '已安装插件', keywords: '名称 平台 作者' },
    { label: '检查全部更新', target: '已安装插件', keywords: '插件 升级' },
    { label: '卸载全部插件', keywords: '删除 清空插件' },
  ]),

  ...makeItems('shortcuts', '快捷键', [
    ...Object.values(shortcutActionLabels).map(label => ({
      label,
      keywords: '窗口内 全局 键盘 按键',
    })),
  ]),
  ...makeItems('shortcuts', '选项', [
    '启用窗口内快捷键',
    '启用全局快捷键',
    { label: '使用系统媒体快捷键', keywords: '媒体键 播放 暂停 上一首 下一首' },
  ]),

  ...makeItems('account', '账号', [
    { label: '账号状态', keywords: '登录 用户 资料' },
    { label: '后端地址', keywords: '服务器 API 自建服务' },
    { label: '歌单上传', target: '歌单', keywords: '云端同步' },
    { label: '插件上传', target: '插件', keywords: '云端同步' },
    { label: '本地设置上传', target: '设置', keywords: '云端同步' },
    { label: '手动同步', keywords: '上传 下载 云端' },
    { label: '启用自动同步', keywords: '定时 云端' },
    { label: '同步间隔', keywords: '小时 自动同步' },
    { label: '最大延迟', keywords: '分钟 自动同步' },
    { label: '退出登录', keywords: '注销 账号' },
  ]),

  ...makeItems('toolbox', '音乐整理工具箱', [
    { label: 'MusicTag 路径', keywords: '程序 exe 标签写入' },
    { label: '目标文件夹', keywords: '歌曲目录 整理路径' },
    { label: '去除序号前缀', keywords: '预处理 文件名' },
    { label: '命名模板', keywords: '重命名 歌手 歌名' },
    { label: '完成前刷新音乐库', keywords: '重新扫描 更新' },
  ]),

  ...makeItems('advanced', '导出日志', [
    { label: '日志保留时长', keywords: '日志 保存 自动清理 天数' },
    { label: '导出全部日志', keywords: '日志 调试 反馈 全部' },
    { label: '导出错误日志', keywords: '日志 错误 故障 排查' },
    { label: '删除全部日志', keywords: '日志 清空 删除' },
  ]),

  ...makeItems('about', '关于', [
    { label: '弦予音乐', keywords: '版本 开发者 软件信息' },
  ]),
];

const categoryItems: SettingsSearchItem[] = (Object.entries(TAB_NAMES) as Array<[SettingsTabId, string]>)
  .map(([tab, tabName]) => ({
    id: `category-${tab}`,
    tab,
    tabName,
    section: '设置分类',
    label: tabName,
    target: '',
    keywords: `${tabName} 设置 分类`,
    kind: 'category',
  }));

const seenSections = new Set<string>();
const sectionItems: SettingsSearchItem[] = [];
for (const item of staticItems) {
  const key = `${item.tab}:${item.section}`;
  if (seenSections.has(key)) continue;
  seenSections.add(key);
  sectionItems.push({
    id: `section-${key}`,
    tab: item.tab,
    tabName: item.tabName,
    section: item.section,
    label: item.section,
    target: item.section,
    keywords: `${item.tabName} ${item.section} 分组`,
    kind: 'section',
  });
}

export const SETTINGS_SEARCH_ITEMS = [...categoryItems, ...sectionItems, ...staticItems];

const normalize = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');

export function searchSettings(query: string, limit = 24): SettingsSearchItem[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];

  const exactCategory = categoryItems.find(item => normalize(item.label) === normalizedQuery);
  if (exactCategory) return [exactCategory];

  const exactSections = sectionItems.filter(item => normalize(item.label) === normalizedQuery);
  if (exactSections.length > 0) return exactSections.slice(0, limit);

  const tokens = normalizedQuery.split(' ').filter(Boolean);

  return SETTINGS_SEARCH_ITEMS
    .map(item => {
      const label = normalize(item.label);
      const section = normalize(item.section);
      const tabName = normalize(item.tabName);
      const searchable = normalize(`${item.label} ${item.section} ${item.tabName} ${item.keywords}`);

      if (!tokens.every(token => searchable.includes(token))) return null;

      const score = label === normalizedQuery
        ? 0
        : label.startsWith(normalizedQuery)
          ? 1
          : label.includes(normalizedQuery)
            ? 2
            : section.includes(normalizedQuery)
              ? 3
              : tabName.includes(normalizedQuery)
                ? 4
                : 5;

      return { item, score };
    })
    .filter((result): result is { item: SettingsSearchItem; score: number } => result !== null)
    .sort((a, b) => a.score - b.score || a.item.label.localeCompare(b.item.label, 'zh-CN'))
    .slice(0, limit)
    .map(result => result.item);
}
