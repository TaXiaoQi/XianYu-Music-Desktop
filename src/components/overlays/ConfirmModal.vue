<script setup lang="ts">
// 通用确认框：遮罩点击等同取消，底部并排两个操作按钮
type ConfirmChoice = 'confirm' | 'cancel';

defineProps<{
  visible: boolean;
  title: string;
  content?: string;
}>();

const emit = defineEmits(['confirm', 'cancel']);

interface ConfirmActionSpec {
  choice: ConfirmChoice;
  caption: string;
  palette: string;
}

const actionSpecs: ConfirmActionSpec[] = [
  {
    choice: 'cancel',
    caption: '取消',
    palette: 'text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/5',
  },
  {
    choice: 'confirm',
    caption: '确定',
    palette: 'text-[#EC4141] font-medium hover:bg-red-50 dark:hover:bg-[#EC4141]/10',
  },
];

const settleWith = (choice: ConfirmChoice) => {
  emit(choice);
};

const dismissFromBackdrop = () => settleWith('cancel');
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-pop">
      <div
        v-if="visible"
        class="fixed inset-0 z-[10000] grid place-items-center bg-black/40 backdrop-blur-sm select-none"
        @click.self="dismissFromBackdrop"
      >
        <div class="modal-content w-80 overflow-hidden">
          <header class="px-6 pt-6 pb-2 text-center">
            <h3 class="text-lg font-bold text-gray-800 dark:text-white">{{ title }}</h3>
          </header>

          <section class="px-6 pb-4 text-center">
            <p v-if="content" class="text-sm leading-relaxed text-gray-500 dark:text-gray-300">{{ content }}</p>
            <slot />
          </section>

          <footer class="flex border-t border-black/5 dark:border-white/10">
            <template v-for="(spec, index) in actionSpecs" :key="spec.choice">
              <span v-if="index > 0" aria-hidden="true" class="w-[1px] bg-black/5 dark:bg-white/10"></span>
              <button
                type="button"
                class="flex-1 py-3 text-sm transition-colors focus:outline-none"
                :class="spec.palette"
                @click="settleWith(spec.choice)"
              >
                {{ spec.caption }}
              </button>
            </template>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
