<script setup lang="ts">
import { Bell, Mic, Moon, Sun } from 'lucide-vue-next';
import type { TopBarItemKey } from '../../types';

defineOptions({ inheritAttrs: false });

withDefaults(defineProps<{
  itemKey: TopBarItemKey;
  active?: boolean;
  isDark?: boolean;
}>(), {
  active: false,
  isDark: false,
});
</script>

<template>
  <!-- 后退 -->
  <svg v-if="itemKey === 'back'" v-bind="$attrs" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" /></svg>

  <!-- 搜索 -->
  <svg v-else-if="itemKey === 'search'" v-bind="$attrs" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>

  <!-- 听歌识曲 -->
  <Mic v-else-if="itemKey === 'recognize'" v-bind="$attrs" :stroke-width="2" />

  <!-- 主题切换 -->
  <Sun v-else-if="itemKey === 'theme' && isDark" v-bind="$attrs" :stroke-width="2" />
  <Moon v-else-if="itemKey === 'theme'" v-bind="$attrs" :stroke-width="2" />

  <!-- 公告 -->
  <Bell v-else-if="itemKey === 'announcement'" v-bind="$attrs" :stroke-width="2" />

  <!-- 设置 -->
  <svg v-else-if="itemKey === 'settings'" v-bind="$attrs" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>

  <!-- 账号 -->
  <svg v-else-if="itemKey === 'account'" v-bind="$attrs" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>

  <!-- 配色方案（自定义） -->
  <svg v-else-if="itemKey === 'colorScheme'" v-bind="$attrs" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.38 3.46L16 2a4 4 0 01-8 0L3.62 3.46a2 2 0 00-1.34 2.23l.58 3.47a1 1 0 00.99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 002-2V10h2.15a1 1 0 00.99-.84l.58-3.47a2 2 0 00-1.34-2.23z" /></svg>
</template>