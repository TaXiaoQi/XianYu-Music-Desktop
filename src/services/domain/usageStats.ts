
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