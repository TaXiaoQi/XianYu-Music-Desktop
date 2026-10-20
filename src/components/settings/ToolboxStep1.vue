<script setup lang="ts">
import { watch, ref, computed } from 'vue';
import { useToast as makeToast } from '../../composables/toast';
import WizardFooter from './toolbox/WizardFooter.vue';
import WizardPane from './toolbox/WizardPane.vue';
import { mirrorToParent, useRenameSweep, type PreprocessNotice } from './toolbox/wizardKit';

const notify = makeToast();

const props = defineProps<{ targetPath: string }>();

const emit = defineEmits<{ next: []; skip: []; 'preview-change': [notice: PreprocessNotice] }>();

const stripLeadingNo = ref(true);

const sweep = useRenameSweep({
  say: (text, tone) => notify.showToast(text, tone),
  doneText: (n) => `成功处理 ${n} 个文件名`,
  raceGuard: true,
  clearOnScanError: true,
});
const { rows, probing, committing, probed } = sweep;

const usable = computed(() => rows.value.filter((row) => row.status !== 'skipped' && !row.error));

const pushSnapshot = () => {
  const notice: PreprocessNotice = {
    targetPath: props.targetPath, isScanning: probing.value,
    hasScanned: probed.value, removeTrackPrefix: stripLeadingNo.value,
    items: usable.value.map((row) => ({ originalName: row.original_name, newName: row.new_name })),
  };
  emit('preview-change', notice);
};

mirrorToParent([() => props.targetPath, probing, probed, stripLeadingNo, usable], pushSnapshot, true);

watch([() => props.targetPath, stripLeadingNo], ([root]) => {
  if (!root) {
    sweep.blank();
    return;
  }

  void sweep.sweep(root, {
    mode: 'rules', template: '',
    remove_track_prefix: stripLeadingNo.value, remove_source_prefix: false,
  });
}, { immediate: true });

const advance = async () => {
  if (usable.value.length === 0) { emit('next'); return; }

  await sweep.commit(usable.value, () => emit('next'));
};

const goLabel = computed(() => probing.value ? '正在扫描...' : usable.value.length > 0 ? `应用预处理并继续 (${usable.value.length})` : '继续下一步');
</script>

<template>
  <WizardPane>
    <section class="space-y-4 mb-0">
      <h3 class="text-base font-bold text-gray-800 dark:text-gray-200">预处理选项</h3>

      <label class="toolbox-option-card">
        <input v-model="stripLeadingNo" type="checkbox" class="mt-0.5 h-5 w-5 rounded border-white/20 text-[#EC4141] focus:ring-[#EC4141]" />
        <div class="min-w-0 grow-0">
          <div class="text-sm font-semibold text-gray-800 dark:text-white">去除序号前缀</div>
          <p class="mt-1 text-xs leading-5 text-gray-500 dark:text-white/50">
            <span class="font-medium text-[#EC4141]/80 dark:text-[#EC4141]">01.song.flac → song.flac</span>
          </p>
        </div>
      </label>
    </section>

    <WizardFooter
      left-label="跳过此步骤"
      left-extra="dark:text-gray-200"
      centered
      :right-busy="committing"
      :right-disabled="committing || probing"
      :right-label="goLabel"
      @left="emit('skip')"
      @right="advance"
    />
  </WizardPane>
</template>

<style scoped>
.toolbox-option-card {
  display: flex;
  cursor: pointer;
  align-items: flex-start;
  gap: 14px;
  padding: 14px 16px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.05);
  transition: background 0.2s, border-color 0.2s;
}

.toolbox-option-card:hover {
  background: rgba(0, 0, 0, 0.3);
  border-color: rgba(255, 255, 255, 0.12);
}
</style>
