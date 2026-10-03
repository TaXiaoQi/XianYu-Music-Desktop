<script setup lang="ts"> // 实现
// 引导流程启动画面（欢迎页）：纯展示组件。
// 点击继续与自动推进的计时逻辑由主组件（useOnboardingState）持有。
defineProps<{
  splashVisible: boolean; // 实现
  splashHintVisible: boolean; // 实现
}>();

const emit = defineEmits<{
  (event: 'continue'): void;
}>();

// 点击任意位置继续：沿用原 continueFromSplash 入口语义，实际推进在主组件
const continueFromSplash = () => emit('continue');
</script>

<template>
  <div
    class="absolute inset-0 flex cursor-pointer select-none flex-col items-center justify-center text-center px-[clamp(1.5rem,4vw,4rem)]"
    @click="continueFromSplash"
  >
    <transition name="splash-title">
      <div v-if="splashVisible" class="flex flex-col items-center">
        <h1
          class="font-black tracking-tight text-black dark:text-white leading-none"
          style="font-size: clamp(64px, 10vw, 160px);"
        >
          弦予音乐
        </h1>
        <div
          class="mt-6 font-light tracking-[0.5em] text-black/50 dark:text-white/50 uppercase"
          style="font-size: clamp(28px, 3.5vw, 48px);"
        >
          XianYu Music
        </div>
        <div
          class="mt-[clamp(2.5rem,5vh,4rem)] font-light text-black/75 dark:text-white/75"
          style="font-size: clamp(28px, 2.8vw, 40px);"
        >
          将音乐给予你
        </div>
      </div>
    </transition>

    <transition name="splash-hint">
      <div
        v-if="splashHintVisible"
        class="absolute flex flex-col items-center gap-3"
        style="bottom: clamp(40px, 8vh, 80px);"
      >
        <div
          class="text-black/60 dark:text-white/60 font-light tracking-wide"
          style="font-size: clamp(20px, 1.6vw, 26px);"
        >
          点击任意位置以继续
        </div>
      </div>
    </transition>
  </div>
</template>
