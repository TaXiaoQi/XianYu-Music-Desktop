<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useToast as makeToast } from '../../composables/toast';
import SettingHint from './SettingHint.vue';
import WizardAction from './toolbox/WizardAction.vue';
import WizardFooter from './toolbox/WizardFooter.vue';
import WizardPane from './toolbox/WizardPane.vue';
import { mirrorToParent, useRenameSweep, type RenameNotice } from './toolbox/wizardKit';

const notify = makeToast();

const props = defineProps<{ targetPath: string }>();

const emit = defineEmits<{ next: []; back: []; 'preview-change': [notice: RenameNotice] }>();

const PREF_KEY = 'toolbox_default_template';

const draft = ref('{title} - {artist}');

const sweep = useRenameSweep({
  say: (text, tone) => notify.showToast(text, tone),
  doneText: (n) => `成功重命名 ${n} 个文件`,
  raceGuard: false,
  clearOnScanError: false,
});
const { rows, probing, committing, probed } = sweep;

const presetTuples: Array<[string, string, string]> = [
  ['歌名 - 歌手', '七里香 - 周杰伦', '{title} - {artist}'],
  ['歌手 - 歌名', '周杰伦 - 七里香', '{artist} - {title}'],
  ['轨道. 歌名', '01. 七里香', '{track}. {title}'],
];
const presets = presetTuples.map(([label, example, value]) => ({ label, example, value }));

const variableTuples: Array<[string, string]> = [
  ['{title}', '标题'],
  ['{artist}', '歌手'],
  ['{album}', '专辑'],
  ['{year}', '年份'],
  ['{track}', '轨道号'],
];
const variables = variableTuples.map(([code, name]) => ({ code, name }));

const loadSavedTemplate = () => {
  const stored = localStorage.getItem(PREF_KEY);
  if (stored) {
    draft.value = stored;
  }
};

onMounted(loadSavedTemplate);

const pinDefault = () => {
  localStorage.setItem(PREF_KEY, draft.value);
  notify.showToast(
    '已设为默认模板',
    'success',
  );
};

const appendVariable = (token: string) => {
  draft.value += token;
};

const usable = computed(() => rows.value.filter((row) => row.status === 'tags' && !row.error));
const parked = computed(() => rows.value.filter((row) => row.status === 'skipped'));

const pushSnapshot = () => {
  const notice: RenameNotice = {
    targetPath: props.targetPath, template: draft.value,
    isScanning: probing.value, hasScanned: probed.value,
    items: usable.value.map((row) => ({ originalName: row.original_name, newName: row.new_name })),
    skippedCount: parked.value.length,
  };
  emit('preview-change', notice);
};

mirrorToParent([() => props.targetPath, draft, probing, probed, usable, parked], pushSnapshot, true);

const runScan = async () => {
  if (!props.targetPath?.length) {
    return;
  }

  await sweep.sweep(props.targetPath, {
    mode: 'tags', template: draft.value,
    remove_track_prefix: false, remove_source_prefix: false,
  });
};

const advance = async () => {
  if (usable.value.length === 0) { emit('next'); return; }

  await sweep.commit(usable.value, () => emit('next'));
};

const scanLabel = computed(() => (probing.value ? '扫描中...' : probed.value ? '重新扫描' : '扫描并预览'));
const goLabel = computed(() => (usable.value.length > 0 ? `应用重命名 (${usable.value.length})` : '继续下一步'));
</script>

<template>
  <WizardPane>
    <section class="toolbox-config-card space-y-4">
      <div class="flex items-center justify-between gap-4 text-sm font-semibold text-gray-800 dark:text-white">
        <span>命名模板</span>
        <SettingHint text="点击变量可将其插入到模板末尾" />
      </div>

      <div class="flex gap-2 flex-wrap">
        <button type="button"
          v-for="row in presets"
          :key="row.value"
          class="rounded-lg border px-3 py-2 text-xs font-medium transition"
          :class="draft === row.value ? 'border-[#EC4141] bg-[#EC4141] text-white' : 'border-white/10 bg-white/5 text-gray-300 hover:border-white/20'"
          @click="draft = row.value"
        >
          {{ row.label }}
          <span class="ml-1 opacity-60">({{ row.example }})</span>
        </button>
      </div>

      <div class="gap-3 flex">
        <input v-model="draft" type="text" placeholder="输入自定义模板..."
          class="flex-1 h-8 rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-gray-100 outline-none transition placeholder:text-white/35 focus:border-[#EC4141]/50 focus:ring-2 focus:ring-[#EC4141]/10"
        />
        <button type="button"
          class="rounded-lg bg-white/8 px-4 py-2 text-sm font-medium text-gray-300 transition hover:bg-white/14 disabled:opacity-40"
          :disabled="!draft"
          @click="pinDefault"
        >设为默认</button>
      </div>

      <div class="space-y-2 mt-0">
        <div class="flex gap-2 flex-wrap">
          <button type="button"
            v-for="item in variables"
            :key="item.code"
            class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs transition hover:border-[#EC4141]"
            @click="appendVariable(item.code)"
          >
            <span class="font-mono font-bold text-gray-200">{{ item.code }}</span>
            <span class="ml-1 text-gray-500">{{ item.name }}</span>
          </button>
        </div>
      </div>
    </section>

    <WizardAction
      :label="scanLabel"
      size="md"
      :busy="probing"
      :disabled="!props.targetPath || probing"
      @press="runScan"
    />

    <WizardFooter
      left-label="返回上一步"
      centered
      :right-busy="committing"
      :right-disabled="committing || !probed"
      :right-label="goLabel"
      @left="emit('back')"
      @right="advance"
    />
  </WizardPane>
</template>

<style scoped>
.toolbox-config-card {
  padding: 16px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
</style>
