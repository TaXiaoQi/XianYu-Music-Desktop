import { ref, computed, type CSSProperties } from 'vue';

// 封面矩形（视口坐标）
interface ElementBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

// 全局单例：同一时刻只允许一条转场在跑
const TRANSITION_MS = 500;
const EASING_CURVE = 'cubic-bezier(0.4, 0.0, 0.2, 1)';
const IDENTITY_TRANSFORM = 'translate(0, 0) scale(1, 1)';

const animationPhase = ref<'idle' | 'entering' | 'leaving'>('idle');
const isAnimating = ref<boolean>(false);

// 底栏封面在转场期间隐藏，避免与详情页封面重影
const footerCoverVisible = ref(true);

// 页面背景的透明度（配合封面做交叉淡入淡出）
const bgOpacity = ref(0);

// 配角元素的交错入场阶段：0=全隐，1=顶栏，2=歌曲信息+控件，3=歌词区
const staggerPhase = ref(0);

// FLIP 的 First 位置（底栏封面最后一次测量的矩形）
const originBox = ref<ElementBox | null>(null);

// 封面动画进行中的样式值
const coverTransform = ref('');
const coverRadius = ref('');
const coverTransition = ref('');

// 自增的动画代号：每次新的转场都会让旧转场的回调失效
let latestAnimId = 0;

// 配角元素交错入场的定时器集合
let phaseTimers: ReturnType<typeof setTimeout>[] = [];

function resetPhaseTimers() {
    phaseTimers.forEach((timer) => clearTimeout(timer));
    phaseTimers = [];
}

const isStale = (animId: number) => animId !== latestAnimId;

const nextFrame = () => new Promise<void>((done) => requestAnimationFrame(() => done()));

function measureBox(el: HTMLElement): ElementBox {
    const box = el.getBoundingClientRect();
    return { x: box.left, y: box.top, width: box.width, height: box.height };
}

/** 计算"从 from 反推回 to"的 FLIP 反向变换串 */
function offsetTransform(from: ElementBox, to: DOMRect): string {
    const dx = from.x - to.left;
    const dy = from.y - to.top;
    const sx = from.width / to.width;
    const sy = from.height / to.height;
    return `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
}

function coverTransitionStyle(): string {
    return `transform ${TRANSITION_MS}ms ${EASING_CURVE}, border-radius ${TRANSITION_MS}ms ${EASING_CURVE}`;
}

/** 收尾：可选地清空封面样式，然后复位为静止状态 */
function settleAsIdle(clearCoverStyles: boolean) {
    if (clearCoverStyles) {
        coverTransition.value = '';
        coverTransform.value = '';
    }
    animationPhase.value = 'idle';
    isAnimating.value = false;
    footerCoverVisible.value = true;
}

/** 注册配角元素按 0.45 / 0.6 / 0.8 进度依次入场的定时器 */
function scheduleStaggerSteps(animId: number) {
    const steps: Array<[number, number]> = [
        [1, TRANSITION_MS * 0.45],
        [2, TRANSITION_MS * 0.6],
        [3, TRANSITION_MS * 0.8],
    ];
    steps.forEach(([phase, delay]) => {
        phaseTimers.push(
            setTimeout(() => {
                if (isStale(animId)) return;
                staggerPhase.value = phase;
            }, delay),
        );
    });
}

/** 等两帧后再执行：rAF 链中途动画被取消则提前 resolve */
async function playForwardFrames(animId: number): Promise<boolean> {
    await nextFrame();
    if (isStale(animId)) {
        return false;
    }
    await nextFrame();
    return !isStale(animId);
}

/** 记录 "First" 位置（一般为底栏封面的矩形） */
function captureFirst(el: HTMLElement) {
    originBox.value = measureBox(el);
}

/** 展开动画：详情页封面 DOM 挂载后调用，传入详情页封面元素作为 "Last" 位置 */
function playEnter(lastEl: HTMLElement): Promise<void> {
    return new Promise((resolve) => {
        const animId = ++latestAnimId;
        animationPhase.value = 'entering';
        isAnimating.value = true;
        footerCoverVisible.value = false;
        bgOpacity.value = 0;
        staggerPhase.value = 0;
        resetPhaseTimers();

        // 没有 First 位置时无从翻转，退化为整页直接淡入
        if (!originBox.value) {
            bgOpacity.value = 1;
            staggerPhase.value = 3;
            setTimeout(() => {
                settleAsIdle(false);
                resolve();
            }, TRANSITION_MS);
            return;
        }

        const startBox: ElementBox = originBox.value;
        const endBox = lastEl.getBoundingClientRect();

        // "Invert"：先无过渡地摆到起点位置
        coverTransition.value = 'none';
        coverTransform.value = offsetTransform(startBox, endBox);
        coverRadius.value = '8px';

        void (async () => {
            const framesOk = await playForwardFrames(animId);
            if (!framesOk) {
                resolve();
                return;
            }

            // "Play"：释放过渡，封面滑向最终位置，背景交叉淡入
            coverTransition.value = coverTransitionStyle();
            coverTransform.value = IDENTITY_TRANSFORM;
            coverRadius.value = '16px';
            bgOpacity.value = 1;

            scheduleStaggerSteps(animId);

            setTimeout(() => {
                if (isStale(animId)) {
                    resolve();
                    return;
                }
                settleAsIdle(true);
                resolve();
            }, TRANSITION_MS);
        })();
    });
}

/** 收起动画：反向 FLIP，把详情页封面收回底栏封面位置 */
function playLeave(detailCoverEl: HTMLElement): Promise<void> {
    return new Promise((resolve) => {
        const animId = ++latestAnimId;
        animationPhase.value = 'leaving';
        isAnimating.value = true;
        resetPhaseTimers();

        // 配角元素立刻整体淡出
        staggerPhase.value = 0;

        if (!originBox.value) {
            bgOpacity.value = 0;
            setTimeout(() => {
                settleAsIdle(false);
                resolve();
            }, TRANSITION_MS * 0.6);
            return;
        }

        // 重新测量底栏封面位置（窗口尺寸可能已经变化）
        const footerEl = document.querySelector('[data-footer-cover]') as HTMLElement | null;
        if (footerEl) {
            originBox.value = measureBox(footerEl);
        }

        const startBox: ElementBox = originBox.value;
        const endBox = detailCoverEl.getBoundingClientRect();

        // 当前处于 "Last" 位置（无偏移），随后动画滑回 First
        coverTransition.value = 'none';
        coverTransform.value = IDENTITY_TRANSFORM;
        coverRadius.value = '16px';

        bgOpacity.value = 0;

        void (async () => {
            const framesOk = await playForwardFrames(animId);
            if (!framesOk) {
                resolve();
                return;
            }

            coverTransition.value = coverTransitionStyle();
            coverTransform.value = offsetTransform(startBox, endBox);
            coverRadius.value = '8px';

            setTimeout(() => {
                if (isStale(animId)) {
                    resolve();
                    return;
                }
                settleAsIdle(true);
                resolve();
            }, TRANSITION_MS);
        })();
    });
}

/** 取消当前动画（连续快速触发转场时使用） */
function cancel() {
    latestAnimId++;
    resetPhaseTimers();
    coverTransition.value = '';
    coverTransform.value = '';
    coverRadius.value = '';
    bgOpacity.value = 0;
    staggerPhase.value = 0;
    animationPhase.value = 'idle';
    isAnimating.value = false;
    footerCoverVisible.value = true;
}

/** 封面元素绑定的动画样式 */
const coverStyle = computed<CSSProperties>(() => {
    const style: CSSProperties = {};
    const transform = coverTransform.value;
    const radius = coverRadius.value;
    const transition = coverTransition.value;

    if (transform) {
        style.transform = transform;
        style.transformOrigin = 'top left';
    }
    if (radius) {
        style.borderRadius = radius;
    }
    if (transition === 'none') {
        style.transition = 'none';
    } else if (transition) {
        style.transition = transition;
    }
    return style;
});

export function useSharedTransition() {
    return {
        animationPhase,
        isAnimating,
        coverStyle,
        footerCoverVisible,
        bgOpacity,
        staggerPhase,
        captureFirst,
        playEnter,
        playLeave,
        cancel,
        DURATION: TRANSITION_MS,
    };
}
