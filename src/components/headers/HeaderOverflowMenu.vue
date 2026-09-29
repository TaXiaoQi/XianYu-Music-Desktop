<script setup lang="ts">
// 顶栏“更多”溢出菜单：一个省略号按钮触发的小型文本菜单，用于收纳各顶栏的次要操作，
// 从而给头部减负。直接复用 overlays/contextMenu 下的 MenuSurface / CtxRow / watchPointerAway
// 原语（未改动），不新增全局组件——仅服务这三个头部。
import { ref, type Component } from 'vue';
import { Ellipsis } from 'lucide-vue-next';

import MenuSurface from '../overlays/contextMenu/MenuSurface.vue';
import CtxRow from '../overlays/contextMenu/CtxRow.vue';
import { FOOTER_SHEET } from '../overlays/contextMenu/sheetChrome';
import { watchPointerAway } from '../overlays/contextMenu/onPointerAway';

interface OverflowItem {
  id: string;
  label: string;
  icon?: Component;
}

const props = withDefaults(
  defineProps<{
    items: OverflowItem[];
    title?: string;
    buttonClass?: string;
    iconClass?: string;
  }>(),
  {
    title: '更多',
    buttonClass:
      'grid size-7 place-items-center rounded-full border border-white/1 bg-white/1 text-gray-500 shadow-sm transition hover:border-gray-200 hover:bg-white/10 hover:text-gray-800 active:scale-95 dark:text-gray-300 dark:hover:border-white/20 dark:hover:text-white',
    iconClass: 'size-4',
  },
);

const emit = defineEmits<{ (e: 'pick', id: string): void }>();

const open = ref(false);
const trigger = ref<HTMLElement | null>(null);
const sheet = ref<InstanceType<typeof MenuSurface> | null>(null);

function toggleMenu() {
  open.value = !open.value;
}

function closeMenu() {
  open.value = false;
}

function choose(id: string) {
  open.value = false;
  emit('pick', id);
}

// 点击菜单面板或触发按钮以外的地方即收起
watchPointerAway(
  (hit) => {
    if (!open.value) return false;
    const panel = sheet.value?.shell;
    if (panel && panel.contains(hit as Node)) return false;
    if (trigger.value && trigger.value.contains(hit as Node)) return false;
    return true;
  },
  closeMenu,
);
</script>

<template>
  <button
    ref="trigger"
    type="button"
    :class="props.buttonClass"
    :title="props.title"
    :aria-haspopup="'menu'"
    :aria-expanded="open"
    @click.stop="toggleMenu"
  >
    <Ellipsis :class="props.iconClass" />
  </button>

  <MenuSurface
    ref="sheet"
    :shown="open"
    :at-x="0"
    :at-y="0"
    :docked-to="trigger"
    :chrome-class="FOOTER_SHEET"
    keep-metrics
  >
    <CtxRow
      v-for="item in props.items"
      :key="item.id"
      button
      hover-group
      lead-class="text-gray-500 dark:text-gray-400 group-hover:text-gray-800 dark:group-hover:text-white"
      @pick="choose(item.id)"
    >
      <template v-if="item.icon" #lead>
        <component :is="item.icon" class="size-4" :stroke-width="1.8" />
      </template>
      {{ item.label }}
    </CtxRow>
  </MenuSurface>
</template>
