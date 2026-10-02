import { computed, ref, type CSSProperties } from "vue";

// 底栏封面 ↔ 详情页封面之间的共享位移动画（FLIP 方案）。
// 模块级单例：同一时刻只允许一条封面位移在跑，新的转场会让旧转场的回调失效。

type MorphPhase = "idle" | "entering" | "leaving";

// 视口坐标系里的矩形（left/top 与 DOMRect 字段对齐，便于直接换算位移）
interface Box {
    left: number; // 视口原点横坐标
    top: number; // 视口原点纵坐标
    width: number; // 水平跨度
    height: number; // 垂直跨度
}

const MORPH_MS = 500;
const MORPH_EASING = "cubic-bezier(0.4, 0.0, 0.2, 1)";
const NEUTRAL_SHIFT = "translate(0, 0) scale(1, 1)";
const DOCK_CORNER = "8px"; // 底栏封面的圆角
const STAGE_CORNER = "16px"; // 详情页封面的圆角
// 配角元素交错入场的进度点（占整段位移时长的比例）
const REVEAL_FRACTIONS = [0.45, 0.6, 0.8] as const;

// ---- 模块级状态 ----
const morphPhase = ref<MorphPhase>("idle");
const morphBusy = ref(false);
// 转场期间隐藏底栏封面，避免与详情页封面重影
const dockCoverShown = ref(true);
// 详情页背景的透明度（配合封面做交叉淡入淡出）
const backdropAlpha = ref(0);
// 配角元素交错入场阶段：0=全隐，1=顶栏，2=歌曲信息+控件，3=歌词区
const revealStage = ref(0);
// FLIP 的 First 位置（底栏封面最近一次测量的矩形）
const dockBox = ref<Box | null>(null);

// 封面位移进行中的样式分量
const shiftExpr = ref("");
const cornerExpr = ref("");
const tweenExpr = ref("");

// 自增代号：每次新转场都会让旧转场的回调失效
let ticket = 0;
// 交错入场的定时器集合
let revealTimers: ReturnType<typeof setTimeout>[] = [];

const superseded = (id: number) => id !== ticket;

const flushRevealTimers = () => {
    revealTimers.forEach((timer) => clearTimeout(timer));
    revealTimers = [];
};

const waitForPaint = () =>
    new Promise<void>((done) => requestAnimationFrame(() => done()));

const dwell = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

const readBox = (el: HTMLElement): Box => {
    const rect = el.getBoundingClientRect();
    return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
    };
};

/** 计算"从 dock 反推回 stage"的 FLIP 反向位移串 */
const rewindShift = (dock: Box, stage: Box) => {
    const shiftX = dock.left - stage.left;
    const shiftY = dock.top - stage.top;
    const scaleX = dock.width / stage.width;
    const scaleY = dock.height / stage.height;
    return `translate(${shiftX}px, ${shiftY}px) scale(${scaleX}, ${scaleY})`;
};

const morphTween = () =>
    `transform ${MORPH_MS}ms ${MORPH_EASING}, border-radius ${MORPH_MS}ms ${MORPH_EASING}`;

/** 收尾：可选地清空封面样式分量，然后复位为静止状态 */
const restMorph = (clearCoverStyles: boolean) => {
    if (clearCoverStyles) {
        tweenExpr.value = "";
        shiftExpr.value = "";
    }
    morphPhase.value = "idle";
    morphBusy.value = false;
    dockCoverShown.value = true;
};

/** 在指定阶段点亮配角元素；转场已被顶掉则忽略 */
const armReveal = (id: number, stage: number) => {
    if (superseded(id)) return;
    revealStage.value = stage;
};

/** 配角元素按 45% / 60% / 80% 进度依次入场 */
const armRevealSteps = (id: number) => {
    REVEAL_FRACTIONS.forEach((fraction, index) => {
        const fireAt = MORPH_MS * fraction;
        revealTimers.push(setTimeout(() => armReveal(id, index + 1), fireAt));
    });
};

// 一段位移动画的完整编排：起点摆位 → 等两帧 → 释放过渡 → 计时收尾
interface MorphPlan {
    id: number;
    startShift: string;
    startCorner: string;
    endShift: string;
    endCorner: string;
    backdrop: number;
    onRelease?: () => void;
}

const runMorphPlan = async (plan: MorphPlan) => {
    // "Invert"：先无过渡地摆到起点位置
    tweenExpr.value = "none";
    shiftExpr.value = plan.startShift;
    cornerExpr.value = plan.startCorner;
    backdropAlpha.value = plan.backdrop;

    await waitForPaint();
    if (superseded(plan.id)) return;
    await waitForPaint();
    if (superseded(plan.id)) return;

    // "Play"：释放过渡，滑向终点位置
    tweenExpr.value = morphTween();
    shiftExpr.value = plan.endShift;
    cornerExpr.value = plan.endCorner;
    plan.onRelease?.();

    await dwell(MORPH_MS);
    if (superseded(plan.id)) return;
    restMorph(true);
};

/** 记录 First 位置（一般为底栏封面的矩形） */
const markDockAnchor = (el: HTMLElement) => {
    dockBox.value = readBox(el);
};

/** 展开动画：详情页封面 DOM 挂载后调用，传入详情页封面元素作为 Last 位置 */
async function expandInto(stageCover: HTMLElement): Promise<void> {
    const id = ++ticket;
    flushRevealTimers();
    morphPhase.value = "entering";
    morphBusy.value = true;
    dockCoverShown.value = false;
    backdropAlpha.value = 0;
    revealStage.value = 0;

    // 没有 First 位置时无从翻转，退化为整页直接淡入
    const dock = dockBox.value;
    if (!dock) {
        backdropAlpha.value = 1;
        revealStage.value = 3;
        await dwell(MORPH_MS);
        restMorph(false);
        return;
    }

    await runMorphPlan({
        id,
        startShift: rewindShift(dock, readBox(stageCover)),
        startCorner: DOCK_CORNER,
        endShift: NEUTRAL_SHIFT,
        endCorner: STAGE_CORNER,
        backdrop: 0,
        onRelease: () => {
            // 背景交叉淡入，同时配角元素依次入场
            backdropAlpha.value = 1;
            armRevealSteps(id);
        },
    });
}

/** 收起动画：反向 FLIP，把详情页封面收回底栏封面位置 */
async function collapseBack(stageCover: HTMLElement): Promise<void> {
    const id = ++ticket;
    flushRevealTimers();
    morphPhase.value = "leaving";
    morphBusy.value = true;
    // 配角元素立刻整体淡出
    revealStage.value = 0;

    // 没有 First 位置时退化为背景淡出
    let dock = dockBox.value;
    if (!dock) {
        backdropAlpha.value = 0;
        await dwell(MORPH_MS * 0.6);
        restMorph(false);
        return;
    }

    // 重新测量底栏封面位置（窗口尺寸可能已经变化）
    const dockEl = document.querySelector(
        "[data-footer-cover]",
    ) as HTMLElement | null;
    if (dockEl) {
        dock = readBox(dockEl);
        dockBox.value = dock;
    }

    await runMorphPlan({
        id,
        startShift: NEUTRAL_SHIFT,
        startCorner: STAGE_CORNER,
        endShift: rewindShift(dock, readBox(stageCover)),
        endCorner: DOCK_CORNER,
        backdrop: 0,
    });
}

/** 取消当前动画（连续快速触发转场时使用） */
const abortMorph = () => {
    ticket += 1;
    flushRevealTimers();
    tweenExpr.value = "";
    shiftExpr.value = "";
    cornerExpr.value = "";
    backdropAlpha.value = 0;
    revealStage.value = 0;
    morphPhase.value = "idle";
    morphBusy.value = false;
    dockCoverShown.value = true;
};

/** 封面元素绑定的动画样式 */
const coverAppearance = computed<CSSProperties>(() => {
    const appearance: CSSProperties = {};
    if (shiftExpr.value) {
        appearance.transform = shiftExpr.value;
        appearance.transformOrigin = "top left";
    }
    if (cornerExpr.value) {
        appearance.borderRadius = cornerExpr.value;
    }
    if (tweenExpr.value === "none") {
        appearance.transition = "none";
    } else if (tweenExpr.value) {
        appearance.transition = tweenExpr.value;
    }
    return appearance;
});

export function useSharedTransition() { // 实现
    return {
        animationPhase: morphPhase,
        isAnimating: morphBusy,
        coverStyle: coverAppearance,
        footerCoverVisible: dockCoverShown,
        bgOpacity: backdropAlpha,
        staggerPhase: revealStage,
        captureFirst: markDockAnchor,
        playEnter: expandInto,
        playLeave: collapseBack,
        cancel: abortMorph,
        DURATION: MORPH_MS,
    };
}
