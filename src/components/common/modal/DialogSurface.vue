<script setup lang="ts">
defineProps<{
  /** Whether the overlay is mounted at all. */
  shown: boolean;
  /** True while the leaving animation is still running. */
  leaving: boolean;
}>();

const emit = defineEmits<{ backdropClick: [] }>();
</script>

<template>
  <Teleport to="body">
    <div
      v-if="shown"
      class="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      :class="{ 'pointer-events-none': leaving }"
    >
      <div
        class="absolute inset-0 bg-black/40 backdrop-blur-sm duration-300 ease-out transition-opacity"
        @click="emit('backdropClick')"
      ></div>

      <div
        class="relative w-full max-w-sm overflow-hidden rounded-2xl border border-white/20 bg-white/80 shadow-2xl ring-1 ring-black/5 backdrop-blur-md transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] dark:bg-gray-900/90"
        :class="leaving ? 'translate-y-4 scale-95 opacity-0' : 'translate-y-0 scale-100 opacity-100'"
      >
        <slot />
      </div>
    </div>
  </Teleport>
</template>
