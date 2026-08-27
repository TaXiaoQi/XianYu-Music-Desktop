/**
 * 软件使用统计上报服务 —— 门面（Facade）。
 *
 * 将软件打开、搜索、输入、播放行为、错误等上报到后台统计接口（与账号 API 共用
 * 同一签名机制）。汇聚 re-export 拆分后的子模块，保持既有消费者（App / TitleBar /
 * SettingsAdvanced / playerPlayback / Search / authService 等）的入口路径不变。
 * 已拆分的子模块：
 *   - usageStatsDevice  设备标识与设备信息（叶子）
 *   - usageStatsReport  打开/搜索/输入/错误/热搜/行为/反馈/申诉上报实现
 *
 * - POST /api/?action=open                 软件打开（写入 app_open_log）
 * - POST /api/?action=search               搜索（写入 search_log）
 * - POST /api/?action=input_stats          输入统计（写入 input_stats_log）
 * - POST /api/?action=error                错误日志（写入 error_log）
 * - POST /api/?action=report_user_behavior 用户行为（写入 user_behavior_log）
 * 设备连接数由后端从 app_open_log 的 device_id 去重统计得到。
 */

export { getDeviceId, getDeviceInfo } from './usageStatsDevice';
export type { DeviceInfo } from './usageStatsDevice';

export {
  reportAppOpen,
  reportSearch,
  reportInputStats,
  reportError,
  fetchHotSearch,
  reportUserBehavior,
  submitFeedback,
  getMyFeedback,
  submitAppeal,
} from './usageStatsReport';
export type {
  HotSearchItem,
  UserBehaviorReport,
  MyFeedbackItem,
} from './usageStatsReport';