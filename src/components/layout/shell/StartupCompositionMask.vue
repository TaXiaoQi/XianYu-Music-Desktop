<script setup lang="ts">
// 首帧启动骨架屏：以静态剪影模拟壳层布局，掩盖主界面首轮渲染，
// 挂载/卸载过渡与剪影样式全部收敛在本组件内。
</script>

<template>
  <div class="startup-composition-mask fixed inset-0 z-[10000] pointer-events-none overflow-hidden">
    <div class="startup-composition-mask__grain"></div>
    <div class="startup-composition-mask__shell">
      <div class="startup-composition-mask__sidebar">
        <div class="startup-composition-mask__brand">
          <div class="startup-composition-mask__brand-dot"></div>
          <div class="startup-composition-mask__brand-line"></div>
        </div>
        <div class="startup-composition-mask__nav">
          <div v-for="index in 6" :key="index" class="startup-composition-mask__nav-line"></div>
        </div>
      </div>
      <div class="startup-composition-mask__main">
        <div class="startup-composition-mask__topbar"></div>
        <div class="startup-composition-mask__content">
          <div class="startup-composition-mask__panel startup-composition-mask__panel--large"></div>
          <div class="startup-composition-mask__panel"></div>
          <div class="startup-composition-mask__panel"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.startup-composition-mask-enter-active,
.startup-composition-mask-leave-active {
  transition: opacity 0.22s ease;
}

.startup-composition-mask-enter-from,
.startup-composition-mask-leave-to {
  opacity: 0;
}

.startup-composition-mask {
  background:
    radial-gradient(circle at 18% 14%, rgba(236, 65, 65, 0.10), transparent 30%),
    linear-gradient(135deg, #f7f7f8 0%, #eeeeef 100%);
}

:global(.dark) .startup-composition-mask {
  background:
    radial-gradient(circle at 18% 14%, rgba(236, 65, 65, 0.10), transparent 30%),
    linear-gradient(135deg, #262626 0%, #2b2b2b 54%, #262626 100%);
}

.startup-composition-mask__grain {
  position: absolute;
  inset: 0;
  opacity: 0.035;
  background-image: linear-gradient(90deg, rgba(255,255,255,0.12) 1px, transparent 1px),
    linear-gradient(rgba(255,255,255,0.10) 1px, transparent 1px);
  background-size: 28px 28px;
}

.startup-composition-mask__shell {
  position: absolute;
  inset: 0;
  display: flex;
  opacity: 0.58;
}

.startup-composition-mask__sidebar {
  width: 220px;
  border-right: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.32);
  padding: 24px 18px;
}

:global(.dark) .startup-composition-mask__sidebar {
  border-right-color: rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.035);
}

.startup-composition-mask__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 34px;
}

.startup-composition-mask__brand-dot {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: rgba(236, 65, 65, 0.78);
  box-shadow: 0 12px 32px rgba(236, 65, 65, 0.22);
}

.startup-composition-mask__brand-line,
.startup-composition-mask__nav-line,
.startup-composition-mask__topbar,
.startup-composition-mask__panel {
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.08);
}

:global(.dark) .startup-composition-mask__brand-line,
:global(.dark) .startup-composition-mask__nav-line,
:global(.dark) .startup-composition-mask__topbar,
:global(.dark) .startup-composition-mask__panel {
  background: rgba(255, 255, 255, 0.07);
}

.startup-composition-mask__brand-line {
  width: 86px;
  height: 14px;
}

.startup-composition-mask__nav {
  display: grid;
  gap: 14px;
}

.startup-composition-mask__nav-line {
  width: 100%;
  height: 34px;
}

.startup-composition-mask__nav-line:nth-child(2),
.startup-composition-mask__nav-line:nth-child(5) {
  width: 78%;
}

.startup-composition-mask__main {
  flex: 1;
  min-width: 0;
  padding: 24px 28px;
}

.startup-composition-mask__topbar {
  height: 34px;
  width: min(560px, 58%);
  margin-left: auto;
}

.startup-composition-mask__content {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
  margin-top: 44px;
}

.startup-composition-mask__panel {
  min-height: 132px;
}

.startup-composition-mask__panel--large {
  grid-column: 1 / -1;
  min-height: 250px;
}

@media (max-width: 760px) {
  .startup-composition-mask__sidebar {
    width: 72px;
    padding-inline: 14px;
  }

  .startup-composition-mask__brand-line,
  .startup-composition-mask__nav-line {
    display: none;
  }

  .startup-composition-mask__content {
    grid-template-columns: 1fr;
  }
}
</style>
