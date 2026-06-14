<script setup lang="ts">
defineProps<{
  currentStep: number;
  steps: { id: number; name: string; icon: string }[];
}>();
</script>

<template>
  <div class="flex items-center justify-between mb-8">
    <template v-for="(step, index) in steps" :key="step.id">
      <!-- Step Circle -->
      <div class="flex flex-col items-center">
        <div
          class="w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold transition-all duration-300"
          :class="[
            currentStep > step.id
              ? 'bg-green-500 text-white'
              : currentStep === step.id
              ? 'bg-[#EC4141] text-white ring-4 ring-red-200 dark:ring-red-500/30'
              : 'bg-gray-200 dark:bg-white/10 text-gray-500 dark:text-white/50'
          ]"
        >
          <span v-if="currentStep > step.id">✓</span>
          <span v-else>{{ step.icon }}</span>
        </div>
        <span
          class="mt-2 text-xs font-medium transition-colors"
          :class="[
            currentStep >= step.id
              ? 'text-gray-800 dark:text-gray-200'
              : 'text-gray-500 dark:text-white/50'
          ]"
        >
          {{ step.name }}
        </span>
      </div>

      <!-- Connector Line -->
      <div
        v-if="index < steps.length - 1"
        class="flex-1 h-1 mx-3 rounded-full transition-colors duration-300"
        :class="[
          currentStep > step.id
            ? 'bg-green-500'
            : 'bg-gray-200 dark:bg-white/10'
        ]"
      ></div>
    </template>
  </div>
</template>
