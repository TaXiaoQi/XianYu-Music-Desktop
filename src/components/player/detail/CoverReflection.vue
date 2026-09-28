<script setup lang="ts">
defineProps<{
  /** 是否处于展开态（控制镜面倒影的挂载与过渡） */
  visible?: boolean;
  /** 倒影取图地址 */
  source?: string;
}>();
</script>

<template>
  <transition name="mirror-entrance" appear>
    <div v-if="visible" class="mirror-plate">
      <div class="mirror-glass mirror-glass--raw">
        <img v-if="source" :src="source" class="mirror-img" draggable="false" decoding="async" referrerpolicy="no-referrer" />
      </div>
      <div class="mirror-glass mirror-glass--soft">
        <img v-if="source" :src="source" class="mirror-img" draggable="false" decoding="async" referrerpolicy="no-referrer" />
      </div>
    </div>
  </transition>
</template>

<style scoped>
/* 铺在“桌面”上的斜切镜面：rotateX + skew 拉出平行四边形透视 */
.mirror-plate {
  position: absolute;
  top: calc(100% + 2px);
  left: 0;
  width: 100%;
  height: 65%;
  z-index: 10;
  overflow: hidden;
  border-radius: inherit;
  pointer-events: none;
  perspective: 1500px;
  transform-origin: top;
  transform: rotateX(40deg) skewX(-18deg) scale(1.01); opacity: 0.2;
}

.mirror-glass {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: inherit;
  -webkit-mask-image: linear-gradient(to bottom, black 0%, rgba(0, 0, 0, 0.5) 30%, transparent 85%);
  mask-image: linear-gradient(to bottom, black 0%, rgba(0, 0, 0, 0.5) 30%, transparent 85%);
}

.mirror-glass--raw {
  -webkit-mask-image:
    linear-gradient(to bottom, black 0%, rgba(0, 0, 0, 0.5) 30%, transparent 85%),
    linear-gradient(to right, transparent 0%, black 18%, black 82%, transparent 100%);
  mask-image:
    linear-gradient(to bottom, black 0%, rgba(0, 0, 0, 0.5) 30%, transparent 85%),
    linear-gradient(to right, transparent 0%, black 18%, black 82%, transparent 100%);
  -webkit-mask-composite: source-in;
  mask-composite: intersect;
}

.mirror-glass--soft {
  filter: blur(4px);
  -webkit-mask-image:
    linear-gradient(to bottom, black 0%, rgba(0, 0, 0, 0.5) 30%, transparent 85%),
    radial-gradient(ellipse 62% 62% at 50% 45%, transparent 55%, black 100%);
  mask-image:
    linear-gradient(to bottom, black 0%, rgba(0, 0, 0, 0.5) 30%, transparent 85%),
    radial-gradient(ellipse 62% 62% at 50% 45%, transparent 55%, black 100%);
  -webkit-mask-composite: source-in;
  mask-composite: intersect;
}

.mirror-img {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  transform: scaleY(-1);
}

.mirror-entrance-enter-active,
.mirror-entrance-appear-active {
  transition:
    transform 560ms cubic-bezier(0.22, 1, 0.36, 1) 220ms, opacity 420ms ease-out 220ms,
    filter 560ms cubic-bezier(0.22, 1, 0.36, 1) 220ms;
}

.mirror-entrance-leave-active {
  transition:
    transform 220ms cubic-bezier(0.4, 0, 0.2, 1), opacity 180ms ease-in,
    filter 220ms cubic-bezier(0.4, 0, 0.2, 1);
}

.mirror-entrance-enter-from,
.mirror-entrance-appear-from,
.mirror-entrance-leave-to {
  opacity: 0;
  filter: blur(10px);
}

.mirror-entrance-enter-from,
.mirror-entrance-appear-from {
  transform: translateY(-18px) rotateX(58deg) skewX(-22deg) scale(0.96); filter: blur(10px);
}

.mirror-entrance-leave-to {
  transform: translateY(-10px) rotateX(48deg) skewX(-20deg) scale(0.985); filter: blur(10px);
}
</style>
