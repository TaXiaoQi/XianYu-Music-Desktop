<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { ArrowUpRight, BookOpen, CheckCircle2, Code2, ExternalLink, Github, Globe2, Heart, RefreshCw, ShieldCheck, Sparkles, UsersRound } from 'lucide-vue-next';
import { openUrl } from '@tauri-apps/plugin-opener';
import { APP_VERSION } from '../../../version';
import { useUpdateCheck } from '../../composables/useUpdateCheck';
import { useToast } from '../../composables/toast';
import { useDeveloperMode } from '../../features/settings/developerMode';
import { useI18n } from '../../features/i18n';
import { useThemeSettings } from '../../composables/useThemeSettings';
import { aboutConfig, startAboutConfigPolling, stopAboutConfigPolling } from '../../utils/aboutConfig';
import AcknowledgementsModal from '../common/AcknowledgementsModal.vue';

const appVersion = APP_VERSION;
const ackModalOpen = ref(false);
function openAcknowledgements() {
  ackModalOpen.value = true;
}
const refModalOpen = ref(false);
function openReferenceProjects() {
  refModalOpen.value = true;
}
const DEVELOPER_MODE_CLICK_COUNT = 5;
const DEVELOPER_MODE_CLICK_HINT_START = 3;
const DEVELOPER_MODE_CLICK_INTERVAL = 1500;
const developerModeClickCount = ref(0);
let lastDeveloperModeClickAt = 0;

const { isDeveloperMode, enableDeveloperMode } = useDeveloperMode();
const { showToast } = useToast();
const { isEnglish } = useI18n();
const { theme } = useThemeSettings();
const isGlassAbout = computed(() => theme.value.useGlassSwitch);
const buttonText = computed(() => isEnglish.value ? {
  update: 'Check for Updates',
  checking: 'Checking...',
  officialSite: 'Official Website',
  joinGroup: 'Join Community',
  project: 'Source Code',
  referenceProject: 'Reference Project',
  acknowledgements: 'Acknowledgements',
  version: 'Version',
  license: 'License',
  tech: 'Tech Stack',
} : {
  update: '检查更新',
  checking: '检查中...',
  officialSite: '前往官网',
  joinGroup: '加入群组',
  project: '开源地址',
  referenceProject: '参考项目',
  acknowledgements: '致谢名单',
  version: '版本',
  license: '许可证',
  tech: '技术栈',
});

function normalizeExternalUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

async function openExternal(url: string) {
  const normalized = normalizeExternalUrl(url);
  if (!normalized) return;
  try {
    await openUrl(normalized);
  } catch (error) {
    console.error('[openExternal] openUrl 失败，尝试 fallback', normalized, error);
    window.open(normalized, '_blank', 'noopener,noreferrer');
  }
}

function handleDeveloperModeClick() {
  if (isDeveloperMode.value) return;

  const now = Date.now();
  if (now - lastDeveloperModeClickAt > DEVELOPER_MODE_CLICK_INTERVAL) {
    developerModeClickCount.value = 0;
  }
  lastDeveloperModeClickAt = now;
  developerModeClickCount.value += 1;

  if (developerModeClickCount.value >= DEVELOPER_MODE_CLICK_COUNT) {
    developerModeClickCount.value = 0;
    enableDeveloperMode();
    showToast(isEnglish.value ? 'Developer mode enabled' : '已进入开发者模式', 'success');
    return;
  }
  if (developerModeClickCount.value >= DEVELOPER_MODE_CLICK_HINT_START) {
    const remaining = DEVELOPER_MODE_CLICK_COUNT - developerModeClickCount.value;
    showToast(isEnglish.value ? `Tap ${remaining} more times to enable developer mode` : `再点击 ${remaining} 次即可进入开发者模式`);
  }
}

const { isCheckingUpdate, checkUpdateManual } = useUpdateCheck();

onMounted(() => {
  startAboutConfigPolling();
});

onUnmounted(() => {
  stopAboutConfigPolling();
});
</script>

<template>
  <div v-if="!isGlassAbout" class="flat-about flex min-h-full min-w-0 flex-col items-center pb-8">
    <div class="flat-about__body flex w-full flex-1 flex-col items-center justify-center gap-7 py-5">
      <div class="flex min-w-0 flex-col items-center gap-4 text-center">
        <img src="/logo.png" alt="Logo" class="h-32 w-32 object-contain dark:invert" />
        <div class="space-y-1">
          <h1 class="text-2xl font-bold tracking-tight text-gray-800 dark:text-white">弦予音乐</h1>
          <button type="button" class="flat-about__version" @click="handleDeveloperModeClick">v{{ appVersion }}</button>
        </div>
        <p class="max-w-sm select-none text-sm text-gray-600 dark:text-gray-300">将音乐给予你</p>
      </div>

      <div class="flex max-w-full flex-col items-center gap-2.5 px-4">
        <div class="flex max-w-full flex-wrap items-center justify-center gap-2.5">
          <button v-if="aboutConfig.updateEnabled" type="button" :disabled="isCheckingUpdate" @click="checkUpdateManual" class="flat-about__primary">
            <RefreshCw v-if="isCheckingUpdate" class="h-3.5 w-3.5 animate-spin" />
            <CheckCircle2 v-else class="h-3.5 w-3.5" />
            {{ isCheckingUpdate ? buttonText.checking : buttonText.update }}
          </button>
          <button v-if="aboutConfig.officialSiteUrl" type="button" @click="openExternal(aboutConfig.officialSiteUrl)" class="flat-about__primary">
            <Globe2 class="h-3.5 w-3.5" />{{ buttonText.officialSite }}
          </button>
          <button v-if="aboutConfig.joinGroupUrl" type="button" @click="openExternal(aboutConfig.joinGroupUrl)" class="flat-about__primary">
            <UsersRound class="h-3.5 w-3.5" />{{ buttonText.joinGroup }}
          </button>
        </div>

        <div class="flex max-w-full flex-wrap items-center justify-center gap-2.5">
          <button v-if="aboutConfig.projectUrl" type="button" @click="openExternal(aboutConfig.projectUrl)" class="flat-about__secondary">
            <Github class="h-3.5 w-3.5" />{{ buttonText.project }}
          </button>
          <button v-if="aboutConfig.referenceProjects.length" type="button" @click="openReferenceProjects" class="flat-about__secondary">
            <Code2 class="h-3.5 w-3.5" />{{ buttonText.referenceProject }}
          </button>
          <button v-if="aboutConfig.acknowledgements.length" type="button" @click="openAcknowledgements" class="flat-about__secondary">
            <Heart class="h-3.5 w-3.5" />{{ buttonText.acknowledgements }}
          </button>
        </div>
      </div>
    </div>

    <div class="max-w-full shrink-0 px-6 pt-5 text-center text-xs leading-relaxed text-gray-400 dark:text-white/40">
      <div class="flex flex-wrap items-center justify-center gap-x-1">
        <span>开发者名单（排名不分先后）：</span>
        <a v-for="developer in ['@ShenYichenCN', '@TaXiaoQi', '@知难辞', '@绛狐']" :key="developer" :href="`https://github.com/${developer.slice(1)}`" target="_blank" rel="noreferrer" class="no-underline text-inherit transition-colors hover:text-[#EC4141]" :class="{ 'developer-vanish-on-hover': developer === '@绛狐' }">{{ developer }}</a>
      </div>
      <div>Copyright © 2026 XianYu Music Developer · 基于 XSAL-1.0 开源可见。</div>
    </div>
  </div>

  <div v-else class="glass-about relative min-h-full min-w-0 overflow-hidden pb-8">
    <div class="glass-about__content relative z-10 mx-auto flex min-h-full w-full max-w-4xl flex-col gap-4 px-4 py-5 sm:px-6 md:px-8">
      <section class="glass-about__hero">
        <div class="glass-about__logo"><img src="/logo.png" alt="Logo" class="h-16 w-16 object-contain dark:invert" /></div>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#ec4141]">
            <span>{{ isEnglish ? 'About Xian Yu Music' : '关于弦予音乐' }}</span>
            <button type="button" class="glass-about__version" aria-label="开发者模式入口" @pointerdown.stop.prevent="handleDeveloperModeClick">v{{ appVersion }}</button>
          </div>
          <h1 class="mt-2 text-3xl font-extrabold tracking-tight text-gray-800 dark:text-white">弦予音乐</h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-white/50">{{ isEnglish ? 'Give music a place to stay.' : '将音乐给予你' }}</p>
        </div>
        <Sparkles class="hidden h-5 w-5 shrink-0 text-[#ec4141]/75 sm:block" />
      </section>

      <div class="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <section class="glass-about__section">
          <div class="glass-about__eyebrow"><BookOpen class="h-4 w-4" />{{ isEnglish ? 'The idea' : '关于这款应用' }}</div>
          <h2>{{ isEnglish ? 'A quiet space for your whole library.' : '让整座音乐库，安静地属于你。' }}</h2>
          <p>{{ isEnglish ? 'Local files, online sources, playlists and lyrics in one focused desktop experience.' : '本地音乐、在线音源、歌单与歌词，汇聚在一个专注的桌面体验里。' }}</p>
          <div class="glass-about__facts">
            <span><small>{{ buttonText.version }}</small><button type="button" class="glass-about__facts-version" aria-label="开发者模式入口" @pointerdown.stop.prevent="handleDeveloperModeClick">v{{ appVersion }}</button></span>
            <span><small>{{ buttonText.license }}</small><strong>XSAL-1.0</strong></span>
            <span><small>{{ buttonText.tech }}</small><strong>Vue 3 · Tauri 2</strong></span>
          </div>
          <div class="mt-6 flex items-center gap-2 text-xs text-gray-500 dark:text-white/45"><ShieldCheck class="h-4 w-4 text-[#ec4141]" />{{ isEnglish ? 'Open source and made for everyday listening.' : '开源、注重隐私，为日常聆听而生。' }}</div>
        </section>

        <section class="glass-about__section">
          <div class="glass-about__eyebrow"><Sparkles class="h-4 w-4" />{{ isEnglish ? 'Quick access' : '快速入口' }}</div>
          <button v-if="aboutConfig.updateEnabled" type="button" class="glass-about__update" :disabled="isCheckingUpdate" @click="checkUpdateManual">
            <RefreshCw class="h-4 w-4 text-[#ec4141]" :class="{ 'animate-spin': isCheckingUpdate }" />
            <span><strong>{{ isCheckingUpdate ? buttonText.checking : buttonText.update }}</strong><small>{{ isEnglish ? 'Check for a new version' : '检查是否有新的版本可用' }}</small></span>
            <ArrowUpRight class="ml-auto h-4 w-4 opacity-50" />
          </button>
          <div class="glass-about__links">
            <button v-if="aboutConfig.officialSiteUrl" type="button" @click="openExternal(aboutConfig.officialSiteUrl)"><Globe2 /><span>{{ buttonText.officialSite }}</span><ExternalLink /></button>
            <button v-if="aboutConfig.joinGroupUrl" type="button" @click="openExternal(aboutConfig.joinGroupUrl)"><UsersRound /><span>{{ buttonText.joinGroup }}</span><ExternalLink /></button>
            <button v-if="aboutConfig.projectUrl" type="button" @click="openExternal(aboutConfig.projectUrl)"><Github /><span>{{ buttonText.project }}</span><ExternalLink /></button>
            <button v-if="aboutConfig.referenceProjects.length" type="button" @click="openReferenceProjects"><Code2 /><span>{{ buttonText.referenceProject }}</span><ArrowUpRight /></button>
            <button v-if="aboutConfig.acknowledgements.length" type="button" @click="openAcknowledgements"><Heart /><span>{{ buttonText.acknowledgements }}</span><ArrowUpRight /></button>
          </div>
        </section>
      </div>

      <section class="glass-about__credits">
        <CheckCircle2 class="h-4 w-4 shrink-0 text-[#ec4141]" />
        <span>{{ isEnglish ? 'Made with care by developers, contributors and open-source projects.' : '感谢开发者、贡献者，以及所有优秀的开源项目。' }}</span>
        <div class="glass-about__developers">
          <a v-for="developer in ['@ShenYichenCN', '@TaXiaoQi', '@知难辞', '@绛狐']" :key="developer" :href="`https://github.com/${developer.slice(1)}`" target="_blank" rel="noreferrer" :class="{ 'developer-vanish-on-hover': developer === '@绛狐' }">{{ developer }}</a>
        </div>
      </section>
      <footer class="text-center text-[10px] text-gray-400 dark:text-white/30">Copyright © 2026 XianYu Music Developer · XSAL-1.0</footer>
    </div>
  </div>

  <AcknowledgementsModal :visible="ackModalOpen" :items="aboutConfig.acknowledgements" @close="ackModalOpen = false" />
  <AcknowledgementsModal
    :visible="refModalOpen"
    :items="aboutConfig.referenceProjects"
    title="参考项目"
    subtitle="本项目的开发借鉴了以下优秀开源项目，排名不分先后"
    empty-text="暂无参考项目，由服务器后台配置下发"
    @close="refModalOpen = false"
  />
</template>

<style scoped>
.flat-about__body {
  min-height: 0;
}

.flat-about__version {
  display: block;
  width: fit-content;
  margin: 0 auto;
  cursor: pointer;
  border: 0;
  border-radius: 999px;
  background: transparent;
  padding: 4px 10px;
  color: rgba(71, 85, 105, 0.75);
  font-size: 13px;
  font-weight: 500;
  transition: 160ms ease;
}

.flat-about__version:hover,
.flat-about__version:active {
  background: rgba(236, 65, 65, 0.1);
  color: #ec4141;
}

.flat-about__primary,
.flat-about__secondary {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  white-space: nowrap;
  border-radius: 8px;
  padding: 8px 15px;
  font-size: 13px;
  font-weight: 600;
  transition: 160ms ease;
}

.flat-about__primary {
  background: #ec4141;
  color: white;
  box-shadow: 0 6px 16px rgba(236, 65, 65, 0.18);
}

.flat-about__primary:hover {
  background: #d83b3b;
}

.flat-about__primary:disabled {
  cursor: wait;
  opacity: 0.65;
}

.flat-about__secondary {
  border: 1px solid rgba(15, 23, 42, 0.1);
  background: rgba(15, 23, 42, 0.035);
  color: rgba(51, 65, 85, 0.9);
}

.flat-about__secondary:hover {
  border-color: rgba(236, 65, 65, 0.3);
  background: rgba(236, 65, 65, 0.08);
  color: #ec4141;
}

.dark .flat-about__secondary {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(226, 232, 240, 0.78);
}

.dark .flat-about__version {
  color: rgba(226, 232, 240, 0.62);
}

@media (max-width: 640px) {
  .flat-about__primary,
  .flat-about__secondary {
    max-width: 100%;
    white-space: normal;
    text-align: center;
  }
}

.glass-about {
  isolation: isolate;
}

.glass-about__content {
  animation: glass-about-rise 420ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.glass-about__hero,
.glass-about__section,
.glass-about__credits {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.46);
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.42), rgba(255, 255, 255, 0.16)),
    rgba(255, 255, 255, 0.2);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.12),
    inset 0 -14px 24px rgba(15, 23, 42, 0.06),
    0 18px 42px rgba(15, 23, 42, 0.12),
    0 3px 10px rgba(15, 23, 42, 0.06);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  backdrop-filter: blur(28px) saturate(180%);
}

.glass-about__hero::before,
.glass-about__section::before,
.glass-about__credits::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(120px 90px at 0% 0%, rgba(255, 255, 255, 0.26), transparent 100%),
    radial-gradient(150px 100px at 100% 100%, rgba(236, 65, 65, 0.08), transparent 100%);
}

.dark .glass-about__hero,
.dark .glass-about__section,
.dark .glass-about__credits {
  border-color: rgba(255, 255, 255, 0.1);
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.065), rgba(255, 255, 255, 0.018)),
    rgba(15, 23, 42, 0.2);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.035),
    inset 0 -16px 28px rgba(0, 0, 0, 0.24),
    0 18px 44px rgba(0, 0, 0, 0.3),
    0 3px 10px rgba(0, 0, 0, 0.18);
}

.dark .glass-about__hero::before,
.dark .glass-about__section::before,
.dark .glass-about__credits::before {
  background:
    radial-gradient(120px 90px at 0% 0%, rgba(255, 255, 255, 0.075), transparent 100%),
    radial-gradient(150px 100px at 100% 100%, rgba(236, 65, 65, 0.08), transparent 100%);
}

.glass-about__hero {
  display: flex;
  align-items: center;
  gap: 18px;
  min-width: 0;
  border-radius: 26px;
  padding: 22px;
}

.glass-about__logo {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 78px;
  height: 78px;
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.24);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.12),
    inset 0 -8px 14px rgba(15, 23, 42, 0.06),
    0 8px 18px rgba(15, 23, 42, 0.08);
  -webkit-backdrop-filter: blur(16px) saturate(160%);
  backdrop-filter: blur(16px) saturate(160%);
}

.dark .glass-about__logo {
  border-color: rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.06);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.06),
    inset 0 -8px 14px rgba(0, 0, 0, 0.18),
    0 8px 20px rgba(0, 0, 0, 0.2);
}

.glass-about__version {
  position: relative;
  z-index: 1;
  pointer-events: auto;
  cursor: pointer;
  border: 0;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.08);
  padding: 3px 8px;
  color: inherit;
  font-size: 10px;
  letter-spacing: normal;
  text-transform: none;
}

.dark .glass-about__version {
  background: rgba(255, 255, 255, 0.1);
}

.glass-about__section {
  min-width: 0;
  border-radius: 22px;
  padding: 22px;
}

.glass-about__eyebrow {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 15px;
  color: #ec4141;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.glass-about__section h2 {
  color: #1f2937;
  font-size: clamp(22px, 3vw, 30px);
  font-weight: 800;
  letter-spacing: -0.035em;
  line-height: 1.18;
}

.dark .glass-about__section h2 {
  color: #f8fafc;
}

.glass-about__section p {
  margin-top: 12px;
  color: rgba(71, 85, 105, 0.8);
  font-size: 13px;
  line-height: 1.8;
}

.dark .glass-about__section p {
  color: rgba(226, 232, 240, 0.58);
}

.glass-about__facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 24px;
}

.glass-about__facts span {
  min-width: 0;
  padding: 2px 0;
}

.glass-about__facts small,
.glass-about__update small {
  display: block;
  color: rgba(100, 116, 139, 0.75);
  font-size: 10px;
}

.glass-about__facts strong,
.glass-about__facts-version {
  display: block;
  overflow: hidden;
  margin-top: 4px;
  color: #334155;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.glass-about__facts-version {
  width: fit-content;
  cursor: pointer;
  border: 0;
  padding: 0;
  background: transparent;
  font-weight: 700;
  text-align: left;
  transition: color 160ms ease;
}

.glass-about__facts-version:hover {
  color: #ec4141;
}

.dark .glass-about__facts-version {
  color: #e2e8f0;
}

.dark .glass-about__facts-version:hover {
  color: #ec4141;
}

.dark .glass-about__facts strong {
  color: #e2e8f0;
}

.glass-about__update,
.glass-about__links button {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  text-align: left;
  color: #334155;
  transition: 160ms ease;
}

.glass-about__update {
  border-radius: 15px;
  background: rgba(236, 65, 65, 0.08);
  padding: 12px;
}

.glass-about__update:hover {
  background: rgba(236, 65, 65, 0.14);
}

.dark .glass-about__update {
  color: #f8fafc;
}

.glass-about__update:disabled {
  cursor: wait;
  opacity: 0.65;
}

.glass-about__update strong {
  display: block;
  font-size: 13px;
}

.dark .glass-about__update small {
  color: rgba(226, 232, 240, 0.68);
}

.glass-about__links {
  display: grid;
  gap: 3px;
  margin-top: 10px;
}

.glass-about__links button {
  min-width: 0;
  border-radius: 12px;
  padding: 10px 8px;
}

.glass-about__links button:hover {
  background: rgba(236, 65, 65, 0.08);
  color: #ec4141;
}

.dark .glass-about__links button {
  color: #e2e8f0;
}

.glass-about__links svg {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  opacity: 0.68;
}

.glass-about__links span {
  min-width: 0;
  flex: 1;
  overflow-wrap: anywhere;
  font-size: 12px;
  font-weight: 600;
}

.glass-about__credits {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  border-radius: 17px;
  padding: 13px 16px;
  color: rgba(71, 85, 105, 0.78);
  font-size: 11px;
}

.dark .glass-about__credits {
  color: rgba(226, 232, 240, 0.55);
}

.glass-about__developers {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 5px;
  margin-left: auto;
}

.glass-about__developers a {
  color: inherit;
  text-decoration: none;
}

.glass-about__developers a:hover {
  color: #ec4141;
}

.developer-vanish-on-hover {
  transition: opacity 160ms ease;
}

.developer-vanish-on-hover:hover {
  opacity: 0;
}

@keyframes glass-about-rise {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 700px) {
  .glass-about__hero {
    align-items: flex-start;
  }

  .glass-about__logo {
    width: 58px;
    height: 58px;
    border-radius: 17px;
  }

  .glass-about__logo img {
    width: 46px;
    height: 46px;
  }

  .glass-about__facts {
    grid-template-columns: 1fr 1fr;
  }

  .glass-about__facts span:last-child {
    grid-column: 1 / -1;
  }

  .glass-about__credits {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .glass-about__developers {
    justify-content: flex-start;
    width: 100%;
    margin-left: 24px;
  }
}

@media (max-width: 480px) {
  .glass-about__hero {
    gap: 12px;
    padding: 16px;
  }

  .glass-about__section {
    padding: 17px;
  }

  .glass-about__hero h1 {
    font-size: 27px;
  }
}
</style>
