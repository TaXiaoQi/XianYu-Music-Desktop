import { computed, ref, watch } from 'vue';
import type { Ref } from 'vue';

import { getDefaultArtistTab } from '../utils/artistTabsOrder';
import type { ArtistTabId } from '../utils/artistTabsOrder';

interface HomeViewStateInputs {
  currentViewMode: Ref<string>,
  filterCondition: Ref<string>,
  isManagementMode: Ref<boolean>,
}

/** 从其他视图切入歌手页时，回到默认标签 */
const shouldResetArtistTab = (incoming: string, previous: string | undefined) =>
  incoming === 'artist' && previous !== 'artist';

export function useHomeViewState(inputs: HomeViewStateInputs) {
  const { currentViewMode, filterCondition, isManagementMode } = inputs;

  const localViewMode = ref<string>(currentViewMode.value);
  const localFilterCondition = ref<string>(filterCondition.value);
  const initialArtistTab: ArtistTabId = getDefaultArtistTab();
  const artistActiveTab = ref<ArtistTabId>(initialArtistTab);

  const viewTransitionKey = computed(() => [localViewMode.value, localFilterCondition.value].join(':'));

  watch(currentViewMode, (incomingMode, previousMode) => {
    localViewMode.value = incomingMode;
    if (shouldResetArtistTab(incomingMode, previousMode)) { artistActiveTab.value = getDefaultArtistTab(); }
    if (incomingMode !== 'folder') { isManagementMode.value = false; }
  }, { immediate: true });

  watch(filterCondition, incomingFilter => {
    localFilterCondition.value = incomingFilter;
  }, { immediate: true });

  return { localViewMode, localFilterCondition, artistActiveTab, viewTransitionKey };
}
