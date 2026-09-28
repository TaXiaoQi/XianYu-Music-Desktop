<script setup lang="ts">
import type { Announcement } from '../../../utils/announcement';
import { LazyAnnouncementModal } from './lazyShellOverlays';

// 公告类弹窗汇聚层：启动公告 / 反馈通知 / 昵称变更通知 / 听歌重置通知
// 复用同一 AnnouncementModal 呈现，仅挂载时机与关闭回调不同。
defineProps<{
  announcementVisible: boolean;
  announcementPayload: Announcement | null;
  feedbackVisible: boolean;
  feedbackPayload: Announcement | null;
  nicknameVisible: boolean;
  nicknamePayload: Announcement | null;
  listenResetVisible: boolean;
  listenResetPayload: Announcement | null;
}>();

// 事件沿用宽松声明：action 载荷由上游弹窗决定，原样向上透传。
defineEmits([
  'close-announcement',
  'action-announcement',
  'close-feedback',
  'close-nickname',
  'close-listen-reset',
]);
</script>

<template>
  <LazyAnnouncementModal
    v-if="announcementVisible"
    :visible="announcementVisible"
    :announcement="announcementPayload"
    @close="$emit('close-announcement')"
    @action="$emit('action-announcement')"
  />

  <LazyAnnouncementModal
    v-if="feedbackVisible"
    :visible="feedbackVisible"
    :announcement="feedbackPayload"
    @close="$emit('close-feedback')"
  />

  <LazyAnnouncementModal
    v-if="nicknameVisible"
    :visible="nicknameVisible"
    :announcement="nicknamePayload"
    @close="$emit('close-nickname')"
  />

  <LazyAnnouncementModal
    v-if="listenResetVisible"
    :visible="listenResetVisible"
    :announcement="listenResetPayload"
    @close="$emit('close-listen-reset')"
  />
</template>
