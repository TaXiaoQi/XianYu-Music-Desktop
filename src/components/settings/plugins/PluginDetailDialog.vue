<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { Copy, Eye, EyeOff, KeyRound, Puzzle, RefreshCw, X } from 'lucide-vue-next';
import type { PluginSource } from '../../../types';
import {
  ensurePluginUserVariables,
  getPluginUserVariables,
  getPluginUserVariableValues,
  reloadPluginInstance,
  setPluginUserVariableValues,
  type PluginUserVariable,
} from '../../../services/domain/pluginEngine';
import { useToast } from '../../../composables/toast';

const props = defineProps<{
  plugin: PluginSource | null;
  overlayZClass?: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const { showToast } = useToast();

const pwdVisible = reactive<Record<string, boolean>>({});

const pwdFocused = reactive<Record<string, boolean>>({});

const detailUserVariables = ref<PluginUserVariable[]>([]);
const detailUserVarValues = ref<Record<string, string>>({});
const savingUserVars = ref(false);
const loadingUserVars = ref(false);

async function loadUserVariables(plugin: PluginSource) {
  detailUserVariables.value = getPluginUserVariables(plugin.id);
  detailUserVarValues.value = { ...getPluginUserVariableValues(plugin.id) };
  migrateOldVarKeys(detailUserVariables.value, detailUserVarValues.value);
  for (const v of detailUserVariables.value) {
    if (!(v.name in detailUserVarValues.value) && v.defaultValue !== undefined) {
      detailUserVarValues.value[v.name] = v.defaultValue;
    }
  }

  if (detailUserVariables.value.length === 0 && plugin.format !== 'lx') {
    loadingUserVars.value = true;
    try {
      const vars = await ensurePluginUserVariables(plugin);
      if (vars.length > 0) {
        detailUserVariables.value = vars;
        detailUserVarValues.value = { ...getPluginUserVariableValues(plugin.id) };
        migrateOldVarKeys(vars, detailUserVarValues.value);
        for (const v of vars) {
          if (!(v.name in detailUserVarValues.value) && v.defaultValue !== undefined) {
            detailUserVarValues.value[v.name] = v.defaultValue;
          }
        }
      }
    } catch {
      // 加载失败不阻塞详情面板
    } finally {
      loadingUserVars.value = false;
    }
  }
}

function migrateOldVarKeys(vars: PluginUserVariable[], values: Record<string, string>) {
  let migrated = false;
  for (const v of vars) {
    if (v.name in values) continue;
    const oldKeys = [v.title, v.placeholder, v.description].filter((k): k is string => !!k && k !== v.name);
    for (const oldKey of oldKeys) {
      if (oldKey in values && values[oldKey]) {
        values[v.name] = values[oldKey];
        delete values[oldKey];
        migrated = true;
        break;
      }
    }
  }
  if (migrated) {
    if (props.plugin) {
      setPluginUserVariableValues(props.plugin.id, values);
    }
  }
}

function closePluginDetail() {
  emit('close');
}

async function copyPluginLink() {
  if (!props.plugin?.filePath) return;
  try {
    await navigator.clipboard.writeText(props.plugin.filePath);
    showToast('插件链接已复制', 'success');
  } catch {
    showToast('复制失败，请手动选择复制', 'error');
  }
}

async function saveUserVariables() {
  if (!props.plugin) return;
  savingUserVars.value = true;
  try {
    setPluginUserVariableValues(props.plugin.id, { ...detailUserVarValues.value });
    reloadPluginInstance(props.plugin.id);
    showToast('已保存用户变量，开始生效', 'success');
    closePluginDetail();
  } catch {
    showToast('保存失败，请重试', 'error');
  } finally {
    savingUserVars.value = false;
  }
}

// 详情面板打开时加载用户变量；关闭时重置编辑状态
watch(() => props.plugin, (plugin) => {
  if (plugin) {
    void loadUserVariables(plugin);
  } else {
    detailUserVariables.value = [];
    detailUserVarValues.value = {};
    loadingUserVars.value = false;
  }
});
</script>

<template>
  <Teleport to="body">
    <Transition name="plugin-detail">
      <div
        v-if="plugin"
        class="fixed inset-0 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
        :class="overlayZClass"
        @click.self="closePluginDetail"
      >
        <div class="plugin-detail-card">
          <div class="plugin-detail-header">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-[#EC4141]/12 to-[#ff8b8b]/12 flex items-center justify-center shrink-0 text-[#EC4141]">
                <Puzzle class="h-5 w-5" />
              </div>
              <div class="min-w-0">
                <div class="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{{ plugin.name }}</div>
                <div class="text-xs text-gray-500 dark:text-white/55 mt-0.5">
                  {{ plugin.format === 'lx' ? '落雪格式' : plugin.format === 'anime' ? 'anime 格式' : 'MusicFree 格式' }}
                </div>
              </div>
            </div>
            <button
              type="button"
              class="plugin-detail-close"
              aria-label="关闭"
              @click="closePluginDetail"
            >
              <X class="h-4 w-4" />
            </button>
          </div>

          <div class="plugin-detail-body">
            <div class="plugin-detail-row">
              <span class="plugin-detail-label">版本</span>
              <span class="plugin-detail-value">v{{ plugin.version || '—' }}</span>
            </div>
            <div class="plugin-detail-row">
              <span class="plugin-detail-label">作者</span>
              <span class="plugin-detail-value">{{ plugin.author || '—' }}</span>
            </div>
            <div class="plugin-detail-row">
              <span class="plugin-detail-label">描述</span>
              <span class="plugin-detail-value">{{ plugin.description || '—' }}</span>
            </div>
            <div class="plugin-detail-row">
              <span class="plugin-detail-label">音源</span>
              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="src in plugin.sources"
                  :key="src"
                  class="settings-plugin-tag"
                >{{ src }}</span>
                <span v-if="plugin.sources.length === 0" class="plugin-detail-value">—</span>
              </div>
            </div>
            <div class="plugin-detail-row">
              <span class="plugin-detail-label">插件链接</span>
              <button
                type="button"
                class="plugin-detail-link"
                :title="plugin.filePath || ''"
                @click="copyPluginLink"
              >
                <Copy class="h-3.5 w-3.5 shrink-0" />
                <span class="truncate">{{ plugin.filePath || '—' }}</span>
              </button>
            </div>
          </div>

          <div v-if="detailUserVariables.length > 0 || loadingUserVars" class="plugin-detail-user-vars">
            <div class="plugin-detail-user-vars-header">
              <KeyRound class="h-4 w-4 text-[#EC4141] shrink-0" />
              <span class="text-sm font-semibold text-gray-800 dark:text-gray-100">用户变量</span>
              <span class="text-xs text-gray-400 dark:text-white/40">插件运行所需的自定义参数</span>
            </div>
            <div v-if="loadingUserVars" class="flex items-center gap-2 py-3 px-1">
              <RefreshCw class="h-3.5 w-3.5 animate-spin text-gray-400" />
              <span class="text-xs text-gray-400 dark:text-white/40">正在加载插件用户变量...</span>
            </div>
            <template v-else>
              <div class="plugin-detail-user-vars-body">
                <div
                  v-for="v in detailUserVariables"
                  :key="v.name"
                  class="plugin-detail-var-row"
                >
                  <label class="plugin-detail-var-label">
                    {{ v.title || v.name }}
                    <span v-if="v.required" class="text-[#EC4141]">*</span>
                  </label>
                  <p v-if="v.description" class="plugin-detail-var-desc">{{ v.description }}</p>
                  <select
                    v-if="v.type === 'select'"
                    v-model="detailUserVarValues[v.name]"
                    class="plugin-detail-var-select"
                  >
                    <option value="" disabled>{{ v.placeholder || '请选择' }}</option>
                    <option v-for="opt in v.options" :key="opt" :value="opt">{{ opt }}</option>
                  </select>
                  <div v-else-if="v.type === 'password'" class="relative" @focusin="pwdFocused[v.name] = true" @focusout="pwdFocused[v.name] = false; pwdVisible[v.name] = false">
                    <input
                      :type="pwdVisible[v.name] ? 'text' : 'password'"
                      v-model="detailUserVarValues[v.name]"
                      :placeholder="v.placeholder || ''"
                      class="h-8 w-full rounded-lg border border-black/10 bg-white/45 px-3 pr-9 text-xs text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/50 focus:bg-white/70 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-white/35 dark:focus:bg-white/10"
                      autocomplete="off"
                    />
                    <button
                      type="button"
                      v-show="pwdFocused[v.name] && (detailUserVarValues[v.name] || '').length > 0"
                      class="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-black/40 dark:text-white/40 hover:text-[#EC4141] transition cursor-pointer"
                      :aria-label="pwdVisible[v.name] ? '隐藏密码' : '查看密码'"
                      @mousedown.prevent
                      @click="pwdVisible[v.name] = !pwdVisible[v.name]"
                    >
                      <EyeOff v-if="pwdVisible[v.name]" class="h-4 w-4" />
                      <Eye v-else class="h-4 w-4" />
                    </button>
                  </div>
                  <input
                    v-else
                    type="text"
                    v-model="detailUserVarValues[v.name]"
                    :placeholder="v.placeholder || ''"
                    class="h-8 rounded-lg border border-black/10 bg-white/45 px-3 text-xs text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/50 focus:bg-white/70 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-white/35 dark:focus:bg-white/10"
                    autocomplete="off"
                  />
                </div>
              </div>
              <div class="plugin-detail-user-vars-footer">
                <button
                  type="button"
                  class="plugin-detail-var-cancel"
                  :disabled="savingUserVars"
                  @click="closePluginDetail"
                >
                  取消
                </button>
                <button
                  type="button"
                  class="plugin-detail-var-save"
                  :disabled="savingUserVars"
                  @click="saveUserVariables"
                >
                  <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': savingUserVars }" />
                  {{ savingUserVars ? '保存中...' : '保存并重载插件' }}
                </button>
              </div>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.plugin-detail-user-vars {
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  padding: 16px 20px;
}

.plugin-detail-user-vars-header {
  display: flex; /* 样式 */
  align-items: center; /* 样式 */
  gap: 8px;
  margin-bottom: 12px;
}

.plugin-detail-user-vars-body {
  display: flex; /* 样式 */
  flex-direction: column; /* 样式 */
  gap: 12px;
}

.plugin-detail-var-row {
  display: flex; /* 样式 */
  flex-direction: column; /* 样式 */
  gap: 4px;
}

.plugin-detail-var-label {
  font-size: 12px; /* 样式 */
  font-weight: 600; /* 样式 */
  color: #374151;
  user-select: none;
}

.plugin-detail-var-desc {
  font-size: 11px;
  color: #9ca3af;
  line-height: 1.4;
  margin: 0;
}

.plugin-detail-var-input,
.plugin-detail-var-select {
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 8px; /* 样式 */
  background: rgba(0, 0, 0, 0.02);
  font-size: 12px; /* 样式 */
  color: #1f2937; /* 样式 */
  outline: none;
  transition: border-color 160ms ease, background-color 160ms ease;
}

.plugin-detail-var-input:focus,
.plugin-detail-var-select:focus {
  border-color: rgba(236, 65, 65, 0.4); /* 样式 */
  background: rgba(236, 65, 65, 0.04);
}

.plugin-detail-user-vars-footer {
  display: flex; /* 样式 */
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}

.plugin-detail-var-cancel,
.plugin-detail-var-save {
  display: inline-flex; /* 样式 */
  align-items: center; /* 样式 */
  gap: 6px;
  height: 34px;
  padding: 0 16px;
  border: none; /* 样式 */
  border-radius: 8px; /* 样式 */
  background: #EC4141;
  color: #fff;
  font-size: 12px; /* 样式 */
  font-weight: 600; /* 样式 */
  cursor: pointer; /* 样式 */
  transition: background-color 160ms ease, opacity 160ms ease;
}

.plugin-detail-var-cancel {
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: rgba(0, 0, 0, 0.04);
  color: #4b5563;
}

.plugin-detail-var-cancel:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.08);
}

.plugin-detail-var-save {
  border: none; /* 样式 */
  background: #EC4141;
  color: #fff;
}

.plugin-detail-var-save:hover:not(:disabled) {
  background: #d63a3a;
}

.plugin-detail-var-cancel:disabled,
.plugin-detail-var-save:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
