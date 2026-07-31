<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import SettingsAbout from "../components/settings/SettingsAbout.vue";
import SettingsAccount from "../components/settings/SettingsAccount.vue";
import SettingsDesktopLyrics from "../components/settings/SettingsDesktopLyrics.vue";
import SettingsGeneral from "../components/settings/SettingsGeneral.vue";
import SettingsLibrary from "../components/settings/SettingsLibrary.vue";
import SettingsPlugins from "../components/settings/SettingsPlugins.vue";
import SettingsShortcuts from "../components/settings/SettingsShortcuts.vue";
import SettingsTheme from "../components/settings/SettingsTheme.vue";
import SettingsToolbox from "../components/settings/SettingsToolbox.vue";
import SettingsAudioOutput from "../components/settings/SettingsAudioOutput.vue";
import SettingsDownload from "../components/settings/SettingsDownload.vue";

type TabId = 'general' | 'theme' | 'desktopLyrics' | 'audioOutput' | 'download' | 'toolbox' | 'library' | 'plugins' | 'shortcuts' | 'account' | 'about';
const VALID_TABS: TabId[] = ['general', 'theme', 'desktopLyrics', 'audioOutput', 'download', 'toolbox', 'library', 'plugins', 'shortcuts', 'account', 'about'];

const route = useRoute();
const router = useRouter();

const initialTab = (() => {
  const q = route.query.tab as string | undefined;
  return (q && VALID_TABS.includes(q as TabId)) ? (q as TabId) : 'general';
})();

const activeTab = ref<TabId>(initialTab);
const mainRef = ref<HTMLElement | null>(null);

// 支持外部通过 ?tab=xxx 跳转到指定标签
watch(() => route.query.tab, (q) => {
  const next = (q as string | undefined) ?? '';
  if (next && VALID_TABS.includes(next as TabId) && next !== activeTab.value) {
    activeTab.value = next as TabId;
  }
});

// 切换 tab 时同步 URL query，便于分享/刷新保持
watch(activeTab, (t) => {
  if (route.query.tab !== t) {
    void router.replace({ query: { ...route.query, tab: t } });
  }
});

watch(activeTab, () => {
  nextTick(() => {
    if (mainRef.value) {
      mainRef.value.scrollTop = 0;
    }
  });
});

const tabs = [
  { id: 'account', name: '账号' },
  { id: 'general', name: '常规' },
  { id: 'plugins', name: '插件' },
  { id: 'theme', name: '外观' },
  { id: 'audioOutput', name: '播放' },
  { id: 'download', name: '下载' },
  { id: 'library', name: '音乐库' },
  { id: 'toolbox', name: '工具箱' },
  { id: 'desktopLyrics', name: '桌面歌词' },
  { id: 'shortcuts', name: '快捷键' },
  { id: 'about', name: '关于' },
];
</script>

<template>
  <div class="flex h-full flex-1 overflow-hidden transition-colors duration-500">
    <aside class="z-10 flex w-[220px] shrink-0 flex-col border-r border-black/10 p-4 dark:border-white/10 md:w-[240px]">
      <nav class="custom-scrollbar flex-1 space-y-1.5 overflow-y-auto overflow-x-hidden">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="relative flex w-full cursor-pointer items-center rounded-md px-4 py-2.5 text-left text-sm transition-all duration-300 active:scale-[0.97]"
          :class="activeTab === tab.id ? 'translate-x-1 bg-black/10 font-semibold text-black shadow-sm dark:bg-white/10 dark:text-white' : 'font-medium text-gray-800 hover:translate-x-1 hover:bg-black/5 hover:text-black dark:text-gray-200 dark:hover:bg-white/5 dark:hover:text-white'"
          @click="activeTab = tab.id as any"
        >
          <div
            v-if="activeTab === tab.id"
            class="absolute left-0 top-1/2 h-[18px] w-1 -translate-y-1/2 rounded-r-md bg-[#EC4141]"
          ></div>
          {{ tab.name }}
        </button>
      </nav>
    </aside>

    <main ref="mainRef" class="custom-scrollbar relative h-full min-w-0 flex-1 overflow-y-auto px-10 py-10 xl:px-16">
      <div class="w-full pb-16">
        <transition name="settings-tab">
          <SettingsGeneral v-if="activeTab === 'general'" key="general" />
          <SettingsPlugins v-else-if="activeTab === 'plugins'" key="plugins" />
          <SettingsAccount v-else-if="activeTab === 'account'" key="account" />
          <SettingsTheme v-else-if="activeTab === 'theme'" key="theme" />
          <SettingsDesktopLyrics v-else-if="activeTab === 'desktopLyrics'" key="desktopLyrics" />
          <SettingsAudioOutput v-else-if="activeTab === 'audioOutput'" key="audioOutput" />
          <SettingsDownload v-else-if="activeTab === 'download'" key="download" />
          <SettingsToolbox v-else-if="activeTab === 'toolbox'" key="toolbox" />
          <SettingsLibrary v-else-if="activeTab === 'library'" key="library" />
          <SettingsShortcuts v-else-if="activeTab === 'shortcuts'" key="shortcuts" />
          <SettingsAbout v-else-if="activeTab === 'about'" key="about" />

          <div v-else key="fallback" class="flex h-[50vh] flex-col items-center justify-center space-y-4 text-gray-400">
            <div class="text-4xl opacity-50">施工中</div>
            <div>当前设置模块正在整理中。</div>
          </div>
        </transition>
      </div>
    </main>
  </div>
</template>

<style scoped>
/* 设置页切换动画：与主页 page-fade 一致，不使用 mode="out-in" 避免快速切换空白 */
.settings-tab-enter-active,
.settings-tab-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.settings-tab-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.settings-tab-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
