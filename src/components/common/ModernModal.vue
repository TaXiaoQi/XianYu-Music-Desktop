<script setup lang="ts"> // 实现
import { onBeforeUnmount, onMounted, ref } from "vue";

import AlertGlyph from "./modal/AlertGlyph.vue";
import DialogActions from "./modal/DialogActions.vue";
import DialogSurface from "./modal/DialogSurface.vue";

interface ModernModalProps {
    visible: boolean;
    title: string;
    content: string;
    confirmText?: string;
    cancelText?: string;
    type?: "danger" | "info";
}

const props = defineProps<ModernModalProps>();
const emit = defineEmits(["update:visible", "confirm", "cancel"]);

const CLOSE_ANIMATION_MS = 200;
const fadingOut = ref(false);
let settleTimer: ReturnType<typeof setTimeout> | null = null;

const settle = (outcome: "confirm" | "cancel") => {
    fadingOut.value = true;
    settleTimer = setTimeout(() => {
        if (outcome === "confirm") {
            emit("confirm");
        } else {
            emit("cancel");
        }
        emit("update:visible", false);
        fadingOut.value = false;
        settleTimer = null;
    }, CLOSE_ANIMATION_MS);
};

const dismiss = () => settle("cancel");
const accept = () => settle("confirm");

const onGlobalKeydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !props.visible) return;
    dismiss();
};

onMounted(() => {
    window.addEventListener("keydown", onGlobalKeydown);
});
onBeforeUnmount(() => {
    window.removeEventListener("keydown", onGlobalKeydown);
    if (settleTimer !== null) {
        clearTimeout(settleTimer);
        settleTimer = null;
    }
});
</script>

<template>
    <DialogSurface
        :shown="visible"
        :leaving="fadingOut"
        @backdrop-click="dismiss"
    >
        <div class="px-6 pb-2 pt-6 text-center">
            <AlertGlyph v-if="type === 'danger'" class="mx-auto mb-4" />
            <h3
                class="text-lg font-bold leading-6 text-gray-900 dark:text-white"
            >
                {{ title }}
            </h3>
        </div>

        <div class="pb-6 px-6 text-center">
            <p
                class="whitespace-pre-line text-sm leading-relaxed text-gray-500 dark:text-gray-300"
            >
                {{ content }}
            </p>
        </div>

        <DialogActions
            :confirm-label="confirmText"
            :cancel-label="cancelText"
            :tone="type"
            @confirm="accept"
            @dismiss="dismiss"
        />
    </DialogSurface>
</template>
