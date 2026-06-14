import { usePlayerCore } from './playerCore';

export function usePlayer() {
  return usePlayerCore().legacyApi;
}
