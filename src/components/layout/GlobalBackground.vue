<script setup lang="ts"> // 实现
import {
    computed,
    nextTick,
    onBeforeUnmount,
    onMounted,
    ref,
    watch,
} from "vue";
import { convertFileSrc } from "@tauri-apps/api/core";
import { storeToRefs } from "pinia";

import { usePlayer } from "../../features/playback";
import { usePlaybackStore } from "../../features/playback/store";
import { useThemeSettings } from "../../composables/useThemeSettings";
import { useCoverCache } from "../../composables/useCoverCache";
import { useWindowMaterial } from "../../composables/windowMaterial";
import { getPreblurredBackgroundUrl } from "../../composables/preblurredBackgroundCache";
import { useRenderingPower } from "../../composables/renderingPower";
import { usePerformanceMode } from "../../composables/usePerformanceMode";
import { calculateCoverGeometry } from "../../composables/useThemeBackgroundGeometry";

import FlowSceneStage from "./background/FlowSceneStage.vue";
import BlurCoverPlate from "./background/BlurCoverPlate.vue";
import CustomMediaPlate from "./background/CustomMediaPlate.vue";
import { useFlowScene } from "./background/useFlowScene";
import { useFlowLayerStack } from "./background/useFlowLayerStack";

/* ------------------------------------------------------------------ */
/* 依赖注入                                                            */
/* ------------------------------------------------------------------ */

const {
    currentCover,
    currentCoverFull,
    dominantColors,
    showPlayerDetail,
    isMiniMode,
} = usePlayer();
const { theme, isDarkTheme, patchTheme } = useThemeSettings(); // 实现
const { activeWindowMaterial } = useWindowMaterial(); // 实现
const { loadFullCover } = useCoverCache(); // 实现
const { isMainWindowLowPower } = useRenderingPower(); // 实现
const { isLowPerformance } = usePerformanceMode();
const playbackStore = usePlaybackStore(); // 实现
const { currentSongPath } = storeToRefs(playbackStore); // 实现

const materialActive = computed(() => activeWindowMaterial.value !== "none");
const micaActive = computed(() => activeWindowMaterial.value === "mica");
const motionFrozen = computed(
    () =>
        showPlayerDetail.value ||
        isMainWindowLowPower.value ||
        isLowPerformance.value,
);

/* ------------------------------------------------------------------ */
/* 容器物理尺寸测量                                                     */
/* ------------------------------------------------------------------ */

const viewport = ref({ width: window.innerWidth, height: window.innerHeight });

const syncViewport = () => {
    const stage = document.querySelector("[data-global-background]");
    if (stage) {
        const box = stage.getBoundingClientRect();
        if (box.width > 0 && box.height > 0) {
            viewport.value = { width: box.width, height: box.height };
            return;
        }
    }
    viewport.value = { width: window.innerWidth, height: window.innerHeight };
};

watch(isMiniMode, async (mini, wasMini) => {
    if (!wasMini || mini) return;
    await nextTick();
    syncViewport();
    setTimeout(syncViewport, 100);
});

onMounted(() => {
    syncViewport();
    window.addEventListener("resize", syncViewport);
});

onBeforeUnmount(() => {
    window.removeEventListener("resize", syncViewport);
});

/* ------------------------------------------------------------------ */
/* 背景方案解析                                                        */
/* ------------------------------------------------------------------ */

type BackdropVariant = "custom" | "flow" | "blur";

interface BackdropPlan {
    variant: BackdropVariant;
    source: string;
    mediaType: "image" | "video";
    blur: number;
    opacity: number;
    maskColor?: string;
    maskAlpha?: number;
    scale: number;
    translateX?: number;
    translateY?: number;
    animated: boolean;
}

const backdropPlan = computed<BackdropPlan | null>(() => {
    const current = theme.value;
    if (!current) return null;

    const customPath =
        current.mode === "custom" ? current.customBackground.imagePath : "";
    if (customPath) {
        const asVideo =
            current.customBackground.mediaType === "video" ||
            /\.mp4$/i.test(customPath);
        const preset = current.customBackground;
        return {
            variant: "custom",
            source: customPath,
            mediaType: asVideo ? "video" : "image",
            blur: preset.blur,
            opacity: preset.opacity,
            maskColor: preset.maskColor,
            maskAlpha: preset.maskAlpha,
            scale: preset.scale,
            translateX: preset.translateX,
            translateY: preset.translateY,
            animated: false,
        };
    }

    if (current.dynamicBgType === "flow") {
        return {
            variant: "flow",
            source: currentCover.value,
            mediaType: "image",
            blur: 60,
            opacity: 0.9,
            scale: 1,
            animated: true,
        };
    }

    if (current.dynamicBgType === "blur") {
        return {
            variant: "blur",
            source: currentCoverFull.value || currentCover.value,
            mediaType: "image",
            blur: 32,
            opacity: 0.75,
            scale: 1.25,
            animated: false,
        };
    }

    return null;
});

const isRemoteLike = (candidate: string) =>
    candidate.startsWith("http") || candidate.startsWith("data:");

const backdropSource = computed(() => {
    const raw = backdropPlan.value?.source;
    if (!raw) return "";
    return isRemoteLike(raw) ? raw : convertFileSrc(raw);
});

/* ------------------------------------------------------------------ */
/* 自定义媒体元数据                                                     */
/* ------------------------------------------------------------------ */

interface FrameSize {
    width: number;
    height: number;
}

const imageFrame = ref<FrameSize>({
    width: theme.value.customBackground?.imageWidth || 0,
    height: theme.value.customBackground?.imageHeight || 0,
});
const videoFrame = ref<FrameSize>({ width: 0, height: 0 });

const probeImageFrame = (src: string) =>
    new Promise<FrameSize>((resolve, reject) => {
        const img = new Image();
        const detach = () => {
            img.onload = null;
            img.onerror = null;
            img.src = "";
        };
        img.onload = () => {
            const frame = {
                width: img.naturalWidth,
                height: img.naturalHeight,
            };
            detach();
            resolve(frame);
        };
        img.onerror = () => {
            detach();
            reject(new Error("probe failed"));
        };
        img.src = src;
    });

watch(
    [
        () => theme.value.customBackground?.imagePath,
        () => theme.value.customBackground?.imageWidth,
        () => theme.value.customBackground?.imageHeight,
    ],
    async ([path, width, height], _prev, onCleanup) => {
        let stale = false;
        onCleanup(() => {
            stale = true;
        });

        if (!path) {
            imageFrame.value = { width: 0, height: 0 };
            return;
        }
        if (width && height) {
            imageFrame.value = { width, height };
            return;
        }

        try {
            const frame = await probeImageFrame(convertFileSrc(path));
            if (stale) return;
            imageFrame.value = frame;
            patchTheme({
                customBackground: {
                    ...theme.value.customBackground,
                    imageWidth: frame.width,
                    imageHeight: frame.height,
                },
            });
        } catch (err) {
            console.error(
                "Failed to load old custom theme background image size",
                err,
            );
        }
    },
    { immediate: true },
);

watch(
    [
        () => backdropPlan.value?.variant,
        () => backdropPlan.value?.mediaType,
        () => backdropPlan.value?.source,
    ],
    () => {
        videoFrame.value = { width: 0, height: 0 };
    },
);

const absorbVideoFrame = (frame: FrameSize) => {
    videoFrame.value = frame;
    if (!(frame.width && frame.height)) return;
    patchTheme({
        customBackground: { // 实现
            ...theme.value.customBackground,
            imageWidth: frame.width,
            imageHeight: frame.height,
        },
    });
};

const discardVideoFrame = () => {
    videoFrame.value = { width: 0, height: 0 };
};

/* ------------------------------------------------------------------ */
/* 流光场景                                                            */
/* ------------------------------------------------------------------ */

const flowEngaged = computed(() => backdropPlan.value?.variant === "flow");

const shellTone = computed(() => {
    if (micaActive.value) return "bg-white/40 dark:bg-black/8";
    if (materialActive.value) return "bg-white/60 dark:bg-black/25";
    return "bg-white dark:bg-[#262626]";
});

const overlayTone = computed(() => {
    if (micaActive.value) return "bg-white/[0.02] dark:bg-black/[0.08]";
    if (materialActive.value) return "bg-white/[0.02] dark:bg-black/[0.16]";
    return "bg-white/[0.03] dark:bg-black/[0.22]";
});

const { scene: flowScene, sceneSignature: flowSceneSignature } = useFlowScene({
    flowEngaged,
    themeSettings: theme,
    coverPalette: dominantColors,
    windowMaterial: activeWindowMaterial,
    motionFrozen,
    shellTone,
    overlayTone,
});

const { layers: flowLayers } = useFlowLayerStack(flowScene, flowSceneSignature);

/* ------------------------------------------------------------------ */
/* 模糊封面取全图与预模糊                                               */
/* ------------------------------------------------------------------ */

let coverFetchTicket = 0;
watch(
    [() => backdropPlan.value?.variant, currentSongPath],
    async ([variant, path]) => {
        if (variant !== "blur" || !path) {
            coverFetchTicket += 1;
            return;
        }
        const ticket = ++coverFetchTicket;
        try {
            const fetched = await loadFullCover(path);
            if (
                ticket !== coverFetchTicket ||
                currentSongPath.value !== path ||
                backdropPlan.value?.variant !== "blur"
            )
                return;
            playbackStore.currentCoverFull =
                fetched || playbackStore.currentCover;
        } catch {
            if (
                ticket !== coverFetchTicket ||
                currentSongPath.value !== path ||
                backdropPlan.value?.variant !== "blur"
            )
                return;
            playbackStore.currentCoverFull = playbackStore.currentCover;
        }
    },
    { immediate: true },
);

const plateBlur = computed(() => {
    const plan = backdropPlan.value;
    if (plan?.variant !== "blur") return 0;
    return micaActive.value ? Math.min(plan.blur, 26) : plan.blur;
});

const plateBrightness = computed(() => {
    const plan = backdropPlan.value;
    return plan?.variant === "blur" ? plan.opacity : 1;
});

const preblurredPlate = ref("");
const platePreblurred = ref(false);
let preblurTicket = 0;

watch(
    [
        () => backdropPlan.value?.variant,
        backdropSource,
        plateBlur,
        plateBrightness,
    ],
    async ([variant, source, blur, brightness]) => {
        const ticket = ++preblurTicket;
        preblurredPlate.value = "";
        platePreblurred.value = false;
        if (variant !== "blur" || !source) return;

        const boosted = await getPreblurredBackgroundUrl(source, {
            blur,
            brightness,
        });
        if (
            ticket !== preblurTicket ||
            backdropPlan.value?.variant !== "blur" ||
            backdropSource.value !== source
        )
            return;

        preblurredPlate.value = boosted;
        platePreblurred.value = boosted !== source;
    },
    { immediate: true },
);

/* ------------------------------------------------------------------ */
/* 材质遮罩 / 模糊底板外观                                              */
/* ------------------------------------------------------------------ */

const scrimStyle = computed(() => {
    if (!materialActive.value) return null;
    if (isDarkTheme.value) {
        return {
            backgroundColor: micaActive.value
                ? "rgba(32, 32, 32, 0.42)"
                : "rgba(28, 28, 28, 0.34)",
        };
    }
    return {
        backgroundColor: micaActive.value
            ? "rgba(248, 249, 251, 0.62)"
            : "rgba(250, 250, 252, 0.5)",
    };
});

const plateMaskClass = computed(() =>
    micaActive.value
        ? "bg-white/40 dark:bg-black/35"
        : "bg-white/50 dark:bg-black/50",
);

const plateImageOpacity = computed(() => (micaActive.value ? 0.35 : 1));

/* ------------------------------------------------------------------ */
/* 自定义媒体几何                                                      */
/* ------------------------------------------------------------------ */

const coverGeometry = computed(() => {
    const plan = backdropPlan.value;
    if (plan?.variant !== "custom") return null;
    const [nativeW, nativeH] =
        plan.mediaType === "video"
            ? [videoFrame.value.width, videoFrame.value.height]
            : [imageFrame.value.width, imageFrame.value.height];
    return calculateCoverGeometry(
        viewport.value.width,
        viewport.value.height,
        nativeW,
        nativeH,
    );
});

const coverTransform = computed(() => {
    const plan = backdropPlan.value;
    if (!plan || plan.variant !== "custom") return { tx: 0, ty: 0, scale: 1 };
    const blurAllowance = Math.min(0.08, (plan.blur || 0) * 0.002);
    return {
        tx: (plan.translateX || 0) * viewport.value.width,
        ty: (plan.translateY || 0) * viewport.value.height,
        scale: (plan.scale || 1.0) + blurAllowance,
    };
});

/* ------------------------------------------------------------------ */
/* 根节点外观                                                          */
/* ------------------------------------------------------------------ */

const rootTone = computed(() => {
    if (theme.value?.mode === "custom") return "bg-black";
    return materialActive.value
        ? "bg-transparent"
        : "bg-[#fafafa] dark:bg-[#262626]";
});

const rootClassList = computed(() => [
    rootTone.value,
    isMainWindowLowPower.value ? "global-background--low-power" : "",
]);

const flowStageVisible = computed(
    () => flowEngaged.value && flowLayers.value.length > 0,
);
const blurPlateVisible = computed(
    () => backdropPlan.value?.variant === "blur" && !!backdropSource.value,
);
const customMediaVisible = computed(
    () => backdropPlan.value?.variant === "custom" && !!backdropSource.value,
);
</script>

<template>
    <div
        data-global-background
        class="pointer-events-none fixed inset-0 z-0 overflow-hidden transition-colors duration-500"
        :class="rootClassList"
    >
        <div
            v-if="materialActive"
            class="absolute inset-0 z-[1] transition-colors duration-500"
            :style="scrimStyle"
        ></div>

        <transition name="fade">
            <FlowSceneStage v-if="flowStageVisible" :layers="flowLayers" />
        </transition>

        <transition name="fade-fast">
            <BlurCoverPlate
                v-if="blurPlateVisible"
                :key="backdropSource"
                :raw-source="backdropSource"
                :preblurred-source="preblurredPlate"
                :is-preblurred="platePreblurred"
                :blur-amount="plateBlur"
                :brightness="plateBrightness"
                :plate-scale="backdropPlan?.scale ?? 1"
                :plate-opacity="plateImageOpacity"
                :mask-class="plateMaskClass"
            />
        </transition>

        <transition name="fade">
            <CustomMediaPlate
                v-if="customMediaVisible"
                :source="backdropSource"
                :media-type="backdropPlan?.mediaType ?? 'image'"
                :blur="backdropPlan?.blur ?? 0"
                :opacity="backdropPlan?.opacity"
                :mask-color="backdropPlan?.maskColor"
                :mask-alpha="backdropPlan?.maskAlpha"
                :geometry="coverGeometry"
                :transform="coverTransform"
                :motion-frozen="motionFrozen"
                @video-measured="absorbVideoFrame"
                @video-broken="discardVideoFrame"
            />
        </transition>

        <div
            v-if="!backdropPlan"
            class="absolute inset-0 transition-colors duration-300"
            :class="
                materialActive ? 'bg-transparent' : 'bg-white dark:bg-[#262626]'
            "
        ></div>
    </div>
</template>

<style scoped> /* 样式 */
.fade-enter-active,
.fade-leave-active {
    transition: opacity 1s ease;
}
.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}

.fade-fast-enter-active,
.fade-fast-leave-active {
    transition: opacity 0.5s ease;
}
.fade-fast-enter-from,
.fade-fast-leave-to {
    opacity: 0;
}

.global-background--low-power,
.global-background--low-power :deep(*) {
    animation-play-state: paused !important;
    transition: none !important;
    will-change: auto !important;
}
</style>
