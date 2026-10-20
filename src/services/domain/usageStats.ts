
export { getDeviceId, getDeviceInfo } from './usageStatsDevice';

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
  MyFeedbackItem,
} from './usageStatsReport';