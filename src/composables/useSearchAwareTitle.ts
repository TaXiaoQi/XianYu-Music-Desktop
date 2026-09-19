import { computed, type ComputedRef } from 'vue';
import { storeToRefs } from 'pinia';

import { useNavigationStore } from '../shared/stores/navigation';

export function useSearchAwareTitle(baseTitle: string): ComputedRef<string> {
  const navigationStore = useNavigationStore();
  const { searchQuery } = storeToRefs(navigationStore);

  return computed(() => {
    const keyword = searchQuery.value.trim();
    return keyword ? `${baseTitle}：“${keyword}”的搜索结果` : baseTitle;
  });
}

export function useSearchTitleSuffix(): ComputedRef<string> {
  const navigationStore = useNavigationStore();
  const { searchQuery } = storeToRefs(navigationStore);

  return computed(() => {
    const keyword = searchQuery.value.trim();
    return keyword ? `：“${keyword}”的搜索结果` : '';
  });
}
