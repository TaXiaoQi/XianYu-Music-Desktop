<script setup lang="ts">
import type { FlowLayerSnapshot } from './flowSceneMath';

defineProps<{
  layers: FlowLayerSnapshot[];
}>();
</script>

<template>
  <div class="absolute inset-0 overflow-hidden">
    <div
      v-for="layer in layers"
      :key="layer.layerKey"
      class="flow-veil absolute inset-0 overflow-hidden"
      :class="[layer.shellTone, `flow-veil--${layer.phase}`]"
      :style="layer.motionVars"
    >
      <div
        class="absolute inset-0 transition-colors duration-[1500ms]"
        :style="layer.basePaint"
      ></div>

      <template v-if="!layer.motionFrozen">
        <div
          class="absolute inset-0 filter blur-[120px]"
          :style="{ opacity: layer.blobOpacity }"
        >
          <div
            class="drift-orb drift-orb--a absolute top-[-10%] left-[-10%] h-[60%] w-[60%] rounded-full mix-blend-multiply transition-colors duration-[1500ms] dark:mix-blend-screen"
            :style="{ backgroundColor: layer.palette[1] }"
          ></div>
          <div
            class="drift-orb drift-orb--b absolute bottom-[-10%] right-[-10%] h-[60%] w-[60%] rounded-full mix-blend-multiply transition-colors duration-[1500ms] dark:mix-blend-screen"
            :style="{ backgroundColor: layer.palette[2] || layer.palette[0] }"
          ></div>
          <div
            class="drift-orb drift-orb--c absolute top-[20%] right-[-10%] h-[70%] w-[70%] rounded-full mix-blend-multiply transition-colors duration-[1500ms] dark:mix-blend-screen"
            :style="{ backgroundColor: layer.palette[3] || layer.palette[1] }"
          ></div>
        </div>

        <div
          class="grain-veil absolute inset-0 z-10 pointer-events-none"
          :style="{ opacity: layer.noiseOpacity }"
        ></div>
      </template>

      <div
        class="absolute inset-0 z-20"
        :class="layer.overlayTone"
        :style="{ opacity: layer.overlayOpacity }"
      ></div>
    </div>
  </div>
</template>

<style scoped>
.flow-veil {
  will-change: opacity, transform;
  transition:
    opacity 920ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 920ms cubic-bezier(0.22, 1, 0.36, 1);
}

.flow-veil--current { opacity: 1; transform: scale(1); }
.flow-veil--entering { opacity: 0; transform: scale(1.028); }
.flow-veil--previous { opacity: 0; transform: scale(1.048); }

.grain-veil {
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3%3Ffilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/feTurbulence%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
}

@keyframes drift-a { 0% { transform: translate(-20%, 15%) scale(1) rotate(0deg); } 25% { transform: translate(30%, -10%) scale(1.1) rotate(90deg); } 50% { transform: translate(-15%, -25%) scale(0.9) rotate(180deg); } 75% { transform: translate(25%, 20%) scale(1.05) rotate(270deg); } 100% { transform: translate(-20%, 15%) scale(1) rotate(360deg); } }
@keyframes drift-b { 0% { transform: translate(25%, -20%) scale(1.1) rotate(0deg); } 25% { transform: translate(-30%, -15%) scale(0.9) rotate(-90deg); } 50% { transform: translate(20%, 25%) scale(1.2) rotate(-180deg); } 75% { transform: translate(-25%, 10%) scale(1) rotate(-270deg); } 100% { transform: translate(25%, -20%) scale(1.1) rotate(-360deg); } }
@keyframes drift-c { 0% { transform: translate(10%, 30%) scale(0.9) rotate(0deg); } 25% { transform: translate(-25%, -20%) scale(1.2) rotate(90deg); } 50% { transform: translate(30%, 15%) scale(1) rotate(180deg); } 75% { transform: translate(-15%, -30%) scale(1.1) rotate(270deg); } 100% { transform: translate(10%, 30%) scale(0.9) rotate(360deg); } }

.drift-orb--a { animation: drift-a var(--mesh-duration-1, 14s) ease-in-out infinite; }
.drift-orb--b { animation: drift-b var(--mesh-duration-2, 18s) ease-in-out infinite; }
.drift-orb--c { animation: drift-c var(--mesh-duration-3, 22s) ease-in-out infinite; }
</style>
