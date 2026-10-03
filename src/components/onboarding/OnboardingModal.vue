<script setup lang="ts"> // 实现
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue';

import { useSettingsThemeControls } from '../../composables/useSettingsThemeControls'; // 实现
import { useOnboardingState } from '../../composables/onboarding/useOnboardingState';
import { useAuthStore } from '../../features/auth/store'; // 实现
import OnboardingAccountStep from './steps/OnboardingAccountStep.vue';
import OnboardingMaterialStep from './steps/OnboardingMaterialStep.vue';
import OnboardingPluginsStep from './steps/OnboardingPluginsStep.vue';
import OnboardingShortcutsStep from './steps/OnboardingShortcutsStep.vue';
import OnboardingSplashStep from './steps/OnboardingSplashStep.vue';
import OnboardingThemeStep from './steps/OnboardingThemeStep.vue';

const SettingsPlugins = defineAsyncComponent( // 实现
  () => import('../settings/SettingsPlugins.vue'), // 实现
);

const props = defineProps<{ // 实现
  visible: boolean; // 实现
}>();

const emit = defineEmits<{ // 实现
  (event: 'update:visible', value: boolean): void; // 实现
  (event: 'complete'): void; // 实现
}>();

const authStore = useAuthStore(); // 实现
const {
  materialMode, // 实现
} = useSettingsThemeControls(); // 实现

// --- 步骤状态机与启动画面计时（组合函数） ---
const {
  step,
  steps,
  currentStepIndex,
  totalSteps,
  splashVisible,
  splashHintVisible,
  clearSplashTimers,
  continueFromSplash,
  startSplashTimers,
  nextStep,
  prevStep,
} = useOnboardingState({
  onComplete: () => handleComplete(),
});

// --- 插件管理器遮罩 ---
const showPluginManager = ref(false); // 实现
const pluginManagerVisited = ref(false); // 实现
const stepContentHidden = ref(false);

const openPluginManager = () => { // 实现
  pluginManagerVisited.value = true; // 实现
  stepContentHidden.value = true;
  showPluginManager.value = true; // 实现
};

const closePluginManager = () => { // 实现
  showPluginManager.value = false; // 实现
};

const onPluginManagerClosed = () => {
  stepContentHidden.value = false;
};

const onboardingSurfaceClass = computed(() => { // 实现
  if (materialMode.value === 'none') { // 实现
    return 'bg-white dark:bg-[#262626]';
  }

  return materialMode.value === 'mica' // 实现
    ? 'bg-white/62 dark:bg-[#262626]/58'
    : 'bg-white/50 dark:bg-[#262626]/48';
});

// --- 完成时的未登录二次确认 ---
const showLoginConfirm = ref(false); // 实现

const handleComplete = () => { // 实现
  if (step.value === 'account' && !authStore.isLoggedIn) { // 实现
    showLoginConfirm.value = true; // 实现
    return;
  }
  emit('complete'); // 实现
  emit('update:visible', false); // 实现
};

const confirmSkipLogin = () => { // 实现
  showLoginConfirm.value = false; // 实现
  emit('complete'); // 实现
  emit('update:visible', false); // 实现
};

const cancelSkipLogin = () => { // 实现
  showLoginConfirm.value = false; // 实现
};

const skipRest = () => handleComplete(); // 实现

// --- 账号步骤登录/注册成功后的延迟完成（计时器留在主组件，保证行为与拆分前一致） ---
let authCompleteTimer: ReturnType<typeof setTimeout> | null = null;

const clearAuthCompleteTimer = () => {
  if (authCompleteTimer) {
    clearTimeout(authCompleteTimer);
    authCompleteTimer = null;
  }
};

const handleAuthorized = () => {
  if (authCompleteTimer) {
    clearTimeout(authCompleteTimer);
  }
  authCompleteTimer = setTimeout(() => {
    authCompleteTimer = null;
    handleComplete(); // 实现
  }, 600);
};

// --- 点击"自定义"主题：暂不支持，弹提示 ---
const showCustomUnsupported = ref(false); // 实现

watch(
  () => props.visible, // 实现
  val => {
    if (val) {
      step.value = 'splash'; // 实现
      showPluginManager.value = false; // 实现
      pluginManagerVisited.value = false; // 实现
      stepContentHidden.value = false;
      splashVisible.value = true; // 实现
      splashHintVisible.value = false; // 实现
      startSplashTimers(); // 实现
    } else {
      clearSplashTimers(); // 实现
    }
  },
);

onMounted(() => { // 实现
  if (props.visible) startSplashTimers(); // 实现
});

onUnmounted(() => { // 实现
  clearSplashTimers(); // 实现
  clearAuthCompleteTimer();
});
</script>

<template>
  <Teleport to="body">
    <transition name="onboarding-fade">
      <div
        v-if="visible"
        class="fixed inset-0 z-[9998] flex flex-col overflow-hidden transition-colors duration-300"
        :class="onboardingSurfaceClass"
      >
        <div
          data-tauri-drag-region
          class="absolute left-1/4 right-1/4 top-0 z-[70] h-10"
          aria-hidden="true"
          @click.stop
        ></div>

        <transition name="splash-fade">
          <OnboardingSplashStep
            v-if="step === 'splash'"
            :splash-visible="splashVisible"
            :splash-hint-visible="splashHintVisible"
            @continue="continueFromSplash"
          />
        </transition>

        <transition name="step-fade" mode="out-in">
          <div
            v-if="step !== 'splash'"
            :key="step"
            class="relative w-full h-full flex flex-col"
            :class="{ 'invisible pointer-events-none': stepContentHidden }"
          >
            <header
              class="flex items-center justify-between px-[clamp(2rem,4vw,4rem)] py-[clamp(1.5rem,3vh,2.5rem)]"
            >
              <div class="flex items-center gap-3">
                <span
                  class="font-black tracking-tight text-black dark:text-white"
                  style="font-size: clamp(18px, 1.5vw, 22px);"
                >
                  弦予音乐
                </span>
                <span class="text-black/20 dark:text-white/20">/</span>
                <span
                  class="text-black/50 dark:text-white/50 font-light tracking-wide"
                  style="font-size: clamp(13px, 1vw, 15px);"
                >
                  初次设置
                </span>
              </div>
              <div class="flex items-center gap-2">
                <template v-for="s in steps" :key="s.key">
                  <div
                    class="rounded-full transition-all duration-500"
                    :class="s.key === step
                      ? 'w-8 bg-[#EC4141]'
                      : steps.findIndex(x => x.key === step) > steps.findIndex(x => x.key === s.key)
                        ? 'w-3 bg-[#EC4141]/40'
                        : 'w-3 bg-black/10 dark:bg-white/10'"
                    style="height: 3px;"
                  ></div>
                </template>
                <span
                  class="ml-3 text-black/40 dark:text-white/40 tabular-nums font-light"
                  style="font-size: clamp(11px, 0.9vw, 13px);"
                >
                  {{ currentStepIndex }} / {{ totalSteps }}
                </span>
              </div>
            </header>

            <main class="flex-1 overflow-y-auto lg:overflow-hidden custom-scrollbar">
              <div class="max-w-6xl mx-auto min-h-full lg:h-full px-[clamp(2rem,5vw,5rem)] py-[clamp(1rem,3vh,3rem)] flex flex-col justify-center lg:block">

                <transition name="step-content" mode="out-in">
                  <OnboardingThemeStep
                    v-if="step === 'theme'"
                    key="theme"
                    @custom-select="showCustomUnsupported = true"
                  />

                  <OnboardingMaterialStep
                    v-else-if="step === 'material'"
                    key="material"
                  />

                  <OnboardingShortcutsStep
                    v-else-if="step === 'shortcuts'"
                    key="shortcuts"
                  />

                  <OnboardingPluginsStep
                    v-else-if="step === 'plugins'"
                    key="plugins"
                    @open-manager="openPluginManager"
                  />

                  <OnboardingAccountStep
                    v-else-if="step === 'account'"
                    key="account"
                    @authorized="handleAuthorized"
                  />
                </transition>
              </div>
            </main>

            <footer
              class="flex items-center justify-between px-[clamp(2rem,4vw,4rem)] py-[clamp(1.25rem,2.5vh,2rem)]"
            >
              <button
                type="button"
                class="text-black/70 dark:text-white/70 hover:text-[#EC4141] font-medium tracking-wide transition"
                style="font-size: clamp(14px, 1.1vw, 17px);"
                @click="skipRest"
              >
                暂不进行初始化设置
              </button>

              <div class="flex items-center gap-[clamp(1rem,2vw,2rem)]">
                <button
                  v-if="step !== 'theme'"
                  type="button"
                  class="text-black/70 dark:text-white/70 hover:text-black dark:hover:text-white font-semibold tracking-wide transition px-2 py-1"
                  style="font-size: clamp(14px, 1.1vw, 17px);"
                  @click="prevStep"
                >
                  上一步
                </button>
                <button
                  v-if="step !== 'account'"
                  type="button"
                  class="px-[clamp(1.75rem,2.5vw,2.75rem)] py-[clamp(0.75rem,1.2vh,1rem)] bg-[#EC4141] text-white font-medium tracking-wide hover:bg-red-600 transition"
                  style="font-size: clamp(14px, 1.1vw, 17px); border-radius: 999px;"
                  @click="nextStep"
                >
                  {{ step === 'plugins' ? (pluginManagerVisited ? '继续' : '稍后添加') : '下一步' }}
                </button>
                <button
                  v-else
                  type="button"
                  class="px-[clamp(2.25rem,3vw,3.25rem)] py-[clamp(0.75rem,1.2vh,1rem)] bg-[#EC4141] text-white font-medium tracking-wide hover:bg-red-600 transition"
                  style="font-size: clamp(15px, 1.2vw, 18px); border-radius: 999px;"
                  @click="handleComplete"
                >
                  完成
                </button>
              </div>
            </footer>

            <transition name="confirm-fade">
              <div
                v-if="showLoginConfirm"
                class="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
                @click.self="cancelSkipLogin"
              >
                <div
                  class="bg-white/80 dark:bg-gray-900/90 rounded-2xl shadow-2xl border border-black/10 dark:border-white/10 px-8 py-7 max-w-sm w-[90%] text-center"
                >
                  <div class="w-12 h-12 mx-auto mb-4 rounded-full bg-[#EC4141]/10 flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-[#EC4141]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093M12 17h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h3
                    class="font-bold text-black dark:text-white mb-2"
                    style="font-size: clamp(17px, 1.4vw, 21px);"
                  >
                    您尚未登陆账号，是否继续？
                  </h3>
                  <p
                    class="text-black/50 dark:text-white/50 font-light mb-6"
                    style="font-size: clamp(12px, 1vw, 14px);"
                  >
                    未登录将无法同步您的歌单和插件配置
                  </p>
                  <div class="flex gap-3 justify-center">
                    <button
                      type="button"
                      class="px-6 py-2.5 rounded-full border border-black/15 dark:border-white/15 text-black/70 dark:text-white/70 hover:bg-black/5 dark:hover:bg-white/5 font-medium tracking-wide transition"
                      style="font-size: clamp(13px, 1vw, 15px);"
                      @click="confirmSkipLogin"
                    >
                      暂不登录
                    </button>
                    <button
                      type="button"
                      class="px-7 py-2.5 rounded-full bg-[#EC4141] text-white font-medium tracking-wide hover:bg-red-600 transition shadow-sm"
                      style="font-size: clamp(13px, 1vw, 15px);"
                      @click="cancelSkipLogin"
                    >
                      登录
                    </button>
                  </div>
                </div>
              </div>
            </transition>
          </div>
        </transition>

        <transition name="step-fade" @after-leave="onPluginManagerClosed">
          <div
            v-if="showPluginManager"
            data-onboarding-plugin-manager-surface
            class="absolute inset-0 z-[60] flex flex-col overflow-hidden"
            :class="onboardingSurfaceClass"
          >
            <header class="flex items-center justify-between border-b border-black/10 dark:border-white/10 px-[clamp(2rem,4vw,4rem)] py-[clamp(1.25rem,2.5vh,2rem)]">
              <div>
                <div class="text-black/45 dark:text-white/45 font-light tracking-wider" style="font-size: clamp(11px, 0.9vw, 13px);">初次设置</div>
                <h2 class="mt-1 font-black tracking-tight text-black dark:text-white" style="font-size: clamp(22px, 2.2vw, 32px);">插件管理</h2>
              </div>
              <button
                type="button"
                class="rounded-full bg-[#EC4141] px-[clamp(1.5rem,2.5vw,2.5rem)] py-3 font-medium text-white transition hover:bg-red-600 active:scale-95"
                style="font-size: clamp(13px, 1vw, 15px);"
                @click="closePluginManager"
              >
                完成管理
              </button>
            </header>
            <main class="custom-scrollbar flex-1 overflow-y-auto">
              <div class="mx-auto w-full max-w-6xl px-[clamp(2rem,5vw,5rem)] py-[clamp(1.5rem,4vh,3.5rem)]">
                <Suspense>
                  <SettingsPlugins overlay-z-class="z-[10000]" />
                  <template #fallback>
                    <div class="flex min-h-64 items-center justify-center text-black/45 dark:text-white/45 font-light">正在加载插件管理…</div>
                  </template>
                </Suspense>
              </div>
            </main>
          </div>
        </transition>

        <transition name="confirm-fade">
          <div
            v-if="showCustomUnsupported"
            class="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
            @click.self="showCustomUnsupported = false"
          >
            <div
              class="bg-white/80 dark:bg-gray-900/90 rounded-2xl shadow-2xl border border-black/10 dark:border-white/10 px-8 py-7 max-w-sm w-[90%] text-center"
            >
              <div class="w-12 h-12 mx-auto mb-4 rounded-full bg-[#EC4141]/10 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-[#EC4141]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3
                class="font-bold text-black dark:text-white mb-2"
                style="font-size: clamp(17px, 1.4vw, 21px);"
              >
                暂不支持此选项
              </h3>
              <p
                class="text-black/50 dark:text-white/50 font-light mb-6"
                style="font-size: clamp(13px, 1vw, 15px);"
              >
                请前往 设置 → 外观 自行修改
              </p>
              <div class="flex gap-3 justify-center">
                <button
                  type="button"
                  class="px-7 py-2.5 rounded-full bg-[#EC4141] text-white font-medium tracking-wide hover:bg-red-600 transition shadow-sm"
                  style="font-size: clamp(13px, 1vw, 15px);"
                  @click="showCustomUnsupported = false"
                >
                  知道了
                </button>
              </div>
            </div>
          </div>
        </transition>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped> /* 样式 */
.custom-scrollbar::-webkit-scrollbar { /* 样式 */
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track { /* 样式 */
  background: transparent; /* 样式 */
}
.custom-scrollbar::-webkit-scrollbar-thumb { /* 样式 */
  background: rgba(0, 0, 0, 0.1); /* 样式 */
  border-radius: 10px; /* 样式 */
}
.dark .custom-scrollbar::-webkit-scrollbar-thumb { /* 样式 */
  background: rgba(255, 255, 255, 0.1); /* 样式 */
}

.onboarding-fade-enter-active, /* 样式 */
.onboarding-fade-leave-active { /* 样式 */
  transition: opacity 0.4s ease; /* 样式 */
}
.onboarding-fade-enter-from, /* 样式 */
.onboarding-fade-leave-to { /* 样式 */
  opacity: 0;
}

.splash-fade-enter-active, /* 样式 */
.splash-fade-leave-active { /* 样式 */
  transition: opacity 0.5s ease, transform 0.5s ease; /* 样式 */
}
.splash-fade-enter-from, /* 样式 */
.splash-fade-leave-to { /* 样式 */
  opacity: 0;
  transform: scale(0.96); /* 样式 */
}

.splash-title-enter-active { /* 样式 */
  transition: opacity 0.8s ease, transform 0.8s cubic-bezier(0.22, 1, 0.36, 1); /* 样式 */
}
.splash-title-enter-from { /* 样式 */
  opacity: 0;
  transform: translateY(20px); /* 样式 */
}

.splash-hint-enter-active { /* 样式 */
  transition: opacity 0.6s ease, transform 0.6s ease; /* 样式 */
}
.splash-hint-enter-from { /* 样式 */
  opacity: 0;
  transform: translateY(10px); /* 样式 */
}

.step-fade-enter-active, /* 样式 */
.step-fade-leave-active { /* 样式 */
  transition: opacity 0.3s ease, transform 0.3s ease; /* 样式 */
}
.step-fade-enter-from { /* 样式 */
  opacity: 0;
  transform: translateX(20px); /* 样式 */
}
.step-fade-leave-to { /* 样式 */
  opacity: 0;
  transform: translateX(-20px); /* 样式 */
}

.step-content-enter-active { /* 样式 */
  transition: opacity 0.3s ease, transform 0.3s ease; /* 样式 */
}
.step-content-enter-from { /* 样式 */
  opacity: 0;
  transform: translateY(10px); /* 样式 */
}
.step-content-leave-active { /* 样式 */
  transition: opacity 0.2s ease; /* 样式 */
}
.step-content-leave-to { /* 样式 */
  opacity: 0;
}

.confirm-fade-enter-active, /* 样式 */
.confirm-fade-leave-active { /* 样式 */
  transition: opacity 0.25s ease; /* 样式 */
}
.confirm-fade-enter-from, /* 样式 */
.confirm-fade-leave-to { /* 样式 */
  opacity: 0;
}
.confirm-fade-enter-active > div, /* 样式 */
.confirm-fade-leave-active > div { /* 样式 */
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s ease; /* 样式 */
}
.confirm-fade-enter-from > div, /* 样式 */
.confirm-fade-leave-to > div { /* 样式 */
  opacity: 0;
  transform: scale(0.92); /* 样式 */
}
</style>
