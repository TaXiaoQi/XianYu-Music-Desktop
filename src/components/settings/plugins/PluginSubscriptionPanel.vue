<script setup lang="ts">
import { computed } from 'vue';
import { Download, RefreshCw, Trash2 } from 'lucide-vue-next';
import type { PluginSubscription } from '../../../types';
import SettingHint from '../SettingHint.vue';

const props = defineProps<{
  visible: boolean;
  subscriptions: PluginSubscription[];
  showAddSubscriptionInput: boolean;
  syncingAll: boolean;
  isPluginBusy: boolean;
  editingSubId: string | null;
  editingSubName: string;
  newSubscriptionUrl: string;
}>();

const emit = defineEmits<{
  (e: 'update:editingSubName', value: string): void;
  (e: 'update:newSubscriptionUrl', value: string): void;
  (e: 'sync-all'): void;
  (e: 'toggle-add'): void;
  (e: 'confirm-add'): void;
  (e: 'install', sub: PluginSubscription): void;
  (e: 'remove', sub: PluginSubscription): void;
  (e: 'edit-name', sub: PluginSubscription): void;
  (e: 'save-name', sub: PluginSubscription): void;
  (e: 'cancel-name'): void;
}>();

const editingSubName = computed({
  get: () => props.editingSubName,
  set: (value: string) => emit('update:editingSubName', value),
});

const newSubscriptionUrl = computed({
  get: () => props.newSubscriptionUrl,
  set: (value: string) => emit('update:newSubscriptionUrl', value),
});

function formatRelativeTime(ts: number | undefined): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
</script>

<template>
  <Transition name="settings-pop-panel">
    <div v-if="visible" class="px-4 pb-4">
      <div class="settings-plugin-inline-panel">
        <div class="flex items-center justify-between mb-3 gap-2">
          <div class="text-sm font-medium text-gray-800 dark:text-gray-200">订阅管理</div>
          <div class="flex shrink-0 items-center gap-3">
            <SettingHint severity="warning" text="订阅可自动同步远端插件列表，方便一次性安装多个来源" />
            <button
              type="button"
              class="settings-plugin-button settings-plugin-button--sm settings-plugin-button--secondary"
              :disabled="syncingAll || subscriptions.length === 0"
              :class="{ 'settings-plugin-button--disabled': syncingAll || subscriptions.length === 0 }"
              :title="subscriptions.length === 0 ? '暂无订阅' : '拉取所有订阅并安装插件'"
              @click="$emit('sync-all')"
            >
              <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': syncingAll }" />
              {{ syncingAll ? '同步中...' : '更新全部' }}
            </button>
            <button
              type="button"
              class="settings-plugin-button settings-plugin-button--sm"
              @click="$emit('toggle-add')"
            >
              {{ showAddSubscriptionInput ? '取消' : '添加订阅' }}
            </button>
          </div>
        </div>

        <Transition name="settings-pop-panel">
          <div v-if="showAddSubscriptionInput" class="mb-3">
            <div class="flex items-center gap-3">
              <input
                v-model="newSubscriptionUrl"
                type="text"
                placeholder="https://example.com/subscription.json"
                class="h-8 rounded-lg border border-black/10 bg-white/45 px-3 text-xs text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/50 focus:bg-white/70 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-white/35 dark:focus:bg-white/10 flex-1"
                @keydown.enter="$emit('confirm-add')"
              />
              <button
                type="button"
                class="settings-plugin-button"
                @click="$emit('confirm-add')"
              >
                <Download class="h-4 w-4" />
                添加
              </button>
            </div>
          </div>
        </Transition>

        <div v-if="subscriptions.length === 0 && !showAddSubscriptionInput" class="settings-plugin-empty">
          暂无订阅源，点击「添加订阅」导入
        </div>
        <div v-else class="flex flex-col gap-2">
          <div
            v-for="sub in subscriptions"
            :key="sub.id"
            class="flex items-center gap-3 p-2.5 rounded-lg bg-white/20 dark:bg-black/10 border border-gray-200/40 dark:border-gray-800/40"
          >
            <div class="min-w-0 flex-1">
              <input
                v-if="editingSubId === sub.id"
                v-model="editingSubName"
                type="text"
                class="h-8 rounded-lg border border-black/10 bg-white/45 px-3 text-xs text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#EC4141]/50 focus:bg-white/70 focus:ring-2 focus:ring-[#EC4141]/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-white/35 dark:focus:bg-white/10"
                @keydown.enter="$emit('save-name', sub)"
                @keydown.esc="$emit('cancel-name')"
                @blur="$emit('save-name', sub)"
              />
              <div
                v-else
                class="text-sm font-medium text-gray-800 dark:text-gray-100 truncate cursor-text hover:text-[#EC4141] transition-colors"
                :title="`点击编辑「${sub.name}」名称`"
                @click="$emit('edit-name', sub)"
              >
                {{ sub.name || sub.url }}
              </div>
              <div class="text-xs text-gray-500 dark:text-white/50 truncate">{{ sub.url }}</div>
              <div
                v-if="sub.lastSyncAt"
                class="flex items-center gap-1.5 mt-0.5 text-[11px] truncate"
                :class="sub.lastSyncStatus === 'failed' ? 'text-red-500 dark:text-red-400' : 'text-gray-400 dark:text-white/40'"
                :title="sub.lastSyncMessage"
              >
                <span
                  class="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                  :class="{
                    'bg-green-500': sub.lastSyncStatus === 'success',
                    'bg-amber-500': sub.lastSyncStatus === 'partial',
                    'bg-red-500': sub.lastSyncStatus === 'failed',
                  }"
                ></span>
                <span class="truncate">上次同步: {{ formatRelativeTime(sub.lastSyncAt) }} · {{ sub.lastSyncCount ?? 0 }} 个</span>
              </div>
            </div>
            <button
              type="button"
              class="settings-plugin-icon-button"
              :disabled="isPluginBusy"
              :class="{ 'settings-plugin-icon-button--updating': isPluginBusy }"
              title="从订阅安装"
              @click="$emit('install', sub)"
            >
              <Download class="h-4 w-4" />
            </button>
            <button
              type="button"
              class="settings-plugin-icon-button settings-plugin-icon-button--danger"
              title="移除订阅"
              @click="$emit('remove', sub)"
            >
              <Trash2 class="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.settings-plugin-empty {
  padding: 20px 0;
  text-align: center;
  color: rgba(100, 116, 139, 0.7);
  font-size: 12px;
}
</style>
