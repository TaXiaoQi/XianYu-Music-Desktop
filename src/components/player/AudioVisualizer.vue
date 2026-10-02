<script setup lang="ts"> // 实现
import { onBeforeUnmount, onMounted, nextTick, ref, watch } from "vue";
import { playbackApi as backend } from "../../services/tauri/playbackApi";
import { useRenderingPower as powerSensor } from "../../composables/renderingPower";
import {
    fitBackingStore,
    paintSpectrumFrame,
    RENDERED_BAR_COUNT,
    SOURCE_BAND_COUNT,
} from "./visualizerSpectrum";

// 页脚频谱：组件只编排采样节奏与生命周期，绘制细节全部在 visualizerSpectrum 里。
interface VisualizerProps {
    active: boolean; // 详情页挂载且可视化被允许
    isPlaying: boolean; // 播放中才拉取实时样本
    songPath: string; // 切歌时清空频谱
}

const props = defineProps<VisualizerProps>();

const SAMPLE_PERIOD_MS = 66; // 采样拉取周期
const IDLE_EPSILON = 0.012; // 低于该值的残余能量视为已停稳

const { isMainWindowLowPower } = powerSensor();

const stageRef = ref<HTMLCanvasElement | null>(null);
const sourceBins = ref<number[]>(freshBins(SOURCE_BAND_COUNT));
const renderedBins = ref<number[]>(freshBins(RENDERED_BAR_COUNT));

let paintHandle: number | null = null;
let sampleTimer: ReturnType<typeof setInterval> | null = null;
let stageObserver: ResizeObserver | null = null;

function freshBins(size: number) {
    return Array.from({ length: size }, () => 0);
}

const hasResidualMotion = () =>
    renderedBins.value.some((level) => level > IDLE_EPSILON);

const keepPainting = () =>
    props.active &&
    !isMainWindowLowPower.value &&
    (props.isPlaying || hasResidualMotion());

const isSamplePullAllowed = () =>
    props.active && props.isPlaying && !isMainWindowLowPower.value;

const clearBins = () => {
    sourceBins.value = freshBins(SOURCE_BAND_COUNT);
    renderedBins.value = freshBins(RENDERED_BAR_COUNT);
};

const wipeSurface = () => {
    const stage = stageRef.value;
    if (!stage) return;

    const ctx = stage.getContext("2d");
    if (ctx) {
        ctx.clearRect(0, 0, stage.width, stage.height);
    }
    stage.width = 0;
    stage.height = 0;
};

const syncBackingStore = () => {
    const stage = stageRef.value;
    if (stage) {
        fitBackingStore(stage, window.devicePixelRatio || 1);
    }
};

const renderFrame = () => {
    const stage = stageRef.value;
    if (!stage) return;

    if (!props.active || isMainWindowLowPower.value) {
        wipeSurface();
        return;
    }

    syncBackingStore();
    const ctx = stage.getContext("2d");
    if (!ctx) return;

    paintSpectrumFrame({
        ctx,
        sourceBins: sourceBins.value,
        renderedBins: renderedBins.value,
        isPlaying: props.isPlaying,
        dpr: window.devicePixelRatio || 1,
    });

    if (keepPainting()) {
        requestPaint();
    }
};

const requestPaint = () => {
    if (paintHandle !== null) return;

    paintHandle = requestAnimationFrame(() => {
        paintHandle = null;
        renderFrame();
    });
};

const pullSamples = async () => {
    if (!isSamplePullAllowed()) return;

    try {
        const wave = await backend.getAudioVisualizerSamples();
        if (wave.length > 0) {
            sourceBins.value = wave.slice(0, SOURCE_BAND_COUNT);
            requestPaint();
        }
    } catch {}
};

const haltSampler = () => {
    if (sampleTimer !== null) {
        clearInterval(sampleTimer);
        sampleTimer = null;
    }
};

const refreshPipeline = () => {
    haltSampler();
    if (!isSamplePullAllowed()) {
        if (!props.active || isMainWindowLowPower.value) {
            clearBins();
            wipeSurface();
        }
        requestPaint();
        return;
    }

    void pullSamples();
    sampleTimer = setInterval(() => {
        void pullSamples();
    }, SAMPLE_PERIOD_MS);
};

watch(
    () => [props.active, props.isPlaying, isMainWindowLowPower.value] as const,
    refreshPipeline,
);

watch(
    () => [props.active, isMainWindowLowPower.value] as const,
    ([mounted, throttled]) => {
        if (!mounted || throttled) {
            clearBins();
            wipeSurface();
        } else {
            void nextTick(() => {
                syncBackingStore();
                requestPaint();
            });
        }
    },
);

const restartForTrack = () => {
    clearBins();
    requestPaint();
    refreshPipeline();
};

watch(() => props.songPath, restartForTrack);

const setupStage = () => {
    const stage = stageRef.value;
    if (stage) {
        stageObserver = new ResizeObserver(() => requestPaint());
        stageObserver.observe(stage);
    }

    void nextTick(() => {
        requestPaint();
        refreshPipeline();
    });
};

const teardownStage = () => {
    haltSampler();
    if (paintHandle !== null) {
        cancelAnimationFrame(paintHandle);
        paintHandle = null;
    }
    stageObserver?.disconnect();
    stageObserver = null;
    clearBins();
    wipeSurface();
};

onMounted(setupStage);
onBeforeUnmount(teardownStage);
</script>

<template>
    <canvas ref="stageRef" class="audio-visualizer" aria-hidden="true" />
</template>

<style scoped> /* 样式 */
canvas.audio-visualizer {
    display: block;
    inline-size: 100%;
    block-size: 100%;
}
</style>
