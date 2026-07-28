import { computed, type ComputedRef } from 'vue';
import { storeToRefs } from 'pinia';

import { useNavigationStore } from '../shared/stores/navigation';

/**
 * 生成带搜索后缀的页面标题。
 *
 * 在列表页进行搜索时，标题会变为 `原标题：关键词的搜索结果`，
 * 例如在"本地音乐"里搜索 A → `本地音乐：A的搜索结果`。
 * 未搜索时返回原标题。
 *
 * @param baseTitle 页面基础标题（如"本地音乐"、"我的收藏"）
 */
export function useSearchAwareTitle(baseTitle: string): ComputedRef<string> {
  const navigationStore = useNavigationStore();
  const { searchQuery } = storeToRefs(navigationStore);

  return computed(() => {
    const keyword = searchQuery.value.trim();
    return keyword ? `${baseTitle}：“${keyword}”的搜索结果` : baseTitle;
  });
}

/**
 * 仅返回搜索后缀（如 `：A的搜索结果`），未搜索时为空串。
 * 用于以 Tab 作为主标题、没有独立标题文本的页面（如"最近播放"）。
 */
export function useSearchTitleSuffix(): ComputedRef<string> {
  const navigationStore = useNavigationStore();
  const { searchQuery } = storeToRefs(navigationStore);

  return computed(() => {
    const keyword = searchQuery.value.trim();
    return keyword ? `：“${keyword}”的搜索结果` : '';
  });
}
