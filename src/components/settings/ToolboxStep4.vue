<script setup lang="ts">
import { computed, ref } from 'vue';
import { useToast as makeToast } from '../../composables/toast';
import { useSettingsStore as usePrefsStore } from '../../features/settings/store';
import { libraryApi as libraryBridge } from '../../services/tauri/libraryApi';
import WizardAction from './toolbox/WizardAction.vue';
import WizardFooter from './toolbox/WizardFooter.vue';
import WizardPane from './toolbox/WizardPane.vue';
import { mirrorToParent, withBusyFlag, type RefreshNotice } from './toolbox/wizardKit';

const notify = makeToast();
const store = usePrefsStore();

const props = defineProps<{ targetPath: string }>();

const emit = defineEmits<{ back: []; restart: []; close: []; 'preview-change': [notice: RefreshNotice] }>();

const refreshing = ref(false);
const done = ref(false);

const pushSnapshot = () =>
  emit('preview-change', { targetPath: props.targetPath, isRefreshing: refreshing.value, refreshed: done.value });

mirrorToParent([() => props.targetPath, refreshing, done], pushSnapshot);

const actionLabel = computed(() => (refreshing.value ? '刷新中...' : '刷新歌曲信息'));

const refreshNow = async () => {
  if (!props.targetPath?.length) {
    notify.showToast(
      '没有目标文件夹',
      'error',
    );
    return;
  }

  await withBusyFlag(refreshing, async () => {
    try {
      const minSeconds = store.settings.libraryMinDurationSeconds;
      await libraryBridge.refreshFolderSongs(props.targetPath, minSeconds);
      notify.showToast(
        '歌曲信息已刷新',
        'success',
      );
      done.value = true;
    } catch (err) {
      console.error(err);
      notify.showToast(
        `刷新失败: ${err}`,
        'error',
      );
    }
  });
};
</script>

<template>
  <WizardPane>
    <div v-if="done" class="space-y-6">
      <div class="py-6 text-center">
        <div class="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/15 text-4xl text-emerald-400">✓</div>
        <h3 class="text-xl font-bold text-gray-800 dark:text-white">流程已完成</h3>
        <p class="mt-2 text-sm text-gray-500 dark:text-white/50">当前目标文件夹已经完成刷新，可以直接开始下一轮整理。</p>
      </div>

      <WizardFooter
        left-label="处理另一个文件夹"
        right-label="完成"
        @left="emit('restart')"
        @right="emit('close')"
      />
    </div>

    <div class="space-y-6" v-else>
      <section class="toolbox-notice-card toolbox-notice-card--amber">
        <div class="flex gap-4 items-start">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-base font-bold text-white">4</div>
          <div class="min-w-0">
            <h3 class="text-sm font-semibold text-amber-200">完成前刷新音乐库</h3>
            <p class="mt-1 text-xs leading-5 text-amber-300/80">这一步会重新扫描目标文件夹，让工具箱刚刚处理过的结果立即反映到软件音乐库中。</p>
          </div>
        </div>
      </section>

      <section class="toolbox-field-card">
        <div class="text-sm font-semibold text-gray-800 dark:text-white">当前目标文件夹</div>
        <div class="mt-3 rounded-lg border border-dashed border-white/12 bg-black/15 px-4 py-3 text-sm text-gray-300">
          <span class="break-all">{{ props.targetPath }}</span>
        </div>
      </section>

      <WizardAction
        :label="actionLabel"
        :busy="refreshing"
        :disabled="!props.targetPath || refreshing"
        icon="refresh"
        @press="refreshNow"
      />

      <WizardFooter left-label="返回上一步" @left="emit('back')" />
    </div>
  </WizardPane>
</template>

<style scoped>
.toolbox-notice-card {
  padding: 16px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
}

.toolbox-notice-card--amber {
  border-color: rgba(245, 158, 11, 0.2);
  background: rgba(245, 158, 11, 0.08);
}

.toolbox-field-card {
  padding: 16px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
</style>
