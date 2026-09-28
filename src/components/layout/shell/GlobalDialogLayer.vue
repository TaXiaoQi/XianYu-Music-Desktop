<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useUiStore } from '../../../shared/stores/ui';
import {
  LazyToast,
  LazySettingsConflictDialog,
  LazyProfileLimitDialog,
  LazyBanDialog,
  LazyCiyuanxiDialog,
  LazyChangePasswordDialog,
  LazyDeleteAccountDialog,
  LazyShareLinkDialog,
  LazyCustomSkinModal,
} from './lazyShellOverlays';

// 全局常驻弹窗层：不受引导流程与迷你模式影响的底层对话框集合。
const { showCustomSkinModal } = storeToRefs(useUiStore());
</script>

<template>
  <LazyToast />
  <LazySettingsConflictDialog />
  <LazyProfileLimitDialog />
  <LazyBanDialog />
  <LazyCiyuanxiDialog />
  <LazyChangePasswordDialog />
  <LazyDeleteAccountDialog />
  <LazyShareLinkDialog />
  <LazyCustomSkinModal v-if="showCustomSkinModal" @close="showCustomSkinModal = false" />
</template>
