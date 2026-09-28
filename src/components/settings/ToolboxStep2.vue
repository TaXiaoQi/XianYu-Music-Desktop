<script setup lang="ts">
import { computed, ref } from 'vue';
import { useToast as makeToast } from '../../composables/toast';
import { appApi as programLauncher } from '../../services/tauri/appApi';
import WizardAction from './toolbox/WizardAction.vue';
import WizardFooter from './toolbox/WizardFooter.vue';
import WizardPane from './toolbox/WizardPane.vue';
import { mirrorToParent, withBusyFlag, type TaggingNotice } from './toolbox/wizardKit';

const notify = makeToast();

const props = defineProps<{ targetPath: string; musicTagPath: string }>();

const emit = defineEmits<{ back: []; next: []; 'preview-change': [notice: TaggingNotice] }>();

const booting = ref(false);
const booted = ref(false);

const pushSnapshot = () =>
  emit('preview-change', { targetPath: props.targetPath, musicTagPath: props.musicTagPath, isLaunching: booting.value, hasLaunched: booted.value });

mirrorToParent([() => props.targetPath, () => props.musicTagPath, booting, booted], pushSnapshot);

const buttonLabel = computed(() => (booting.value ? '正在启动...' : '启动 MusicTag'));

const openMusicTag = async () => {
  if (!props.musicTagPath?.length) {
    notify.showToast(
      '请先返回预设页面配置 MusicTag 路径',
      'error',
    );
    return;
  }

  await withBusyFlag(booting, async () => {
    try {
      const extra = props.targetPath ? [props.targetPath] : [];
      await programLauncher.openExternalProgram(props.musicTagPath, extra);
      booted.value = true;
      notify.showToast(
        'MusicTag 已启动',
        'success',
      );
    } catch (err) {
      console.error(err);
      notify.showToast(
        `启动失败: ${err}`,
        'error',
      );
    }
  });
};
</script>

<template>
  <WizardPane>
    <WizardAction
      :label="buttonLabel"
      :busy="booting"
      :disabled="!props.musicTagPath || booting"
      icon="export"
      @press="openMusicTag"
    />

    <WizardFooter
      left-label="返回上一步"
      right-label="标签编辑完成，继续下一步"
      @left="emit('back')"
      @right="emit('next')"
    />
  </WizardPane>
</template>
