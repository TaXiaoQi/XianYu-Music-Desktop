import { ref, computed, type CSSProperties } from 'vue';

// --- 类型定义 ---
interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

type AnimationPhase = 'idle' | 'entering' | 'leaving';

// --- 全局单例状态 ---
const DURATION = 500; // ms
const EASING = 'cubic-bezier(0.4, 0.0, 0.2, 1)';

const animationPhase = ref<AnimationPhase>('idle');
const isAnimating = ref(false);

// 底栏封面可见性（转场时隐藏以避免残影）
const footerCoverVisible = ref(true);

// 背景 opacity（0→1 连续过渡）
const bgOpacity = ref(0);

// 配角元素交错阶段（0=全隐, 1=顶栏, 2=歌曲信息+控件, 3=歌词区域）
const staggerPhase = ref(0);

// 记录的 First/Last 位置
const firstRect = ref<Rect | null>(null);

// 动画进度的样式（用 transform 实现 FLIP）
const flipTransform = ref('');
const flipBorderRadius = ref('');
const flipTransition = ref('');

// 当前动画 ID（用于取消）
let currentAnimationId = 0;

// Stagger 定时器集合
let staggerTimers: ReturnType<typeof setTimeout>[] = [];

function clearStaggerTimers() {
    staggerTimers.forEach(t => clearTimeout(t));
    staggerTimers = [];
}

/**
 * 记录 "First" 位置（底栏封面）
 */
function captureFirst(el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    firstRect.value = {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
    };
}

/**
 * 展开动画 - FLIP
 * 在详情页 DOM 挂载后调用，传入详情页封面元素
 */
function playEnter(lastEl: HTMLElement): Promise<void> {
    return new Promise((resolve) => {
        const animId = ++currentAnimationId;
        animationPhase.value = 'entering';
        isAnimating.value = true;
        footerCoverVisible.value = false;
        bgOpacity.value = 0;
        staggerPhase.value = 0;
        clearStaggerTimers();

        if (!firstRect.value) {
            // 没有起点信息，直接渐显
            bgOpacity.value = 1;
            staggerPhase.value = 3;
            setTimeout(() => {
                animationPhase.value = 'idle';
                isAnimating.value = false;
                footerCoverVisible.value = true;
                resolve();
            }, DURATION);
            return;
        }

        // "Last" — 详情页封面的最终位置
        const lRect = lastEl.getBoundingClientRect();

        // "Invert" — 计算从 Last 到 First 的反向偏移
        const dx = firstRect.value.x - lRect.left;
        const dy = firstRect.value.y - lRect.top;
        const sx = firstRect.value.width / lRect.width;
        const sy = firstRect.value.height / lRect.height;

        // 先设置反向 transform（无过渡）
        flipTransition.value = 'none';
        flipTransform.value = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
        flipBorderRadius.value = '8px'; // 底栏的 rounded-lg

        // "Play" — 下一帧释放动画
        requestAnimationFrame(() => {
            if (animId !== currentAnimationId) { resolve(); return; }
            requestAnimationFrame(() => {
                if (animId !== currentAnimationId) { resolve(); return; }

                // 启动封面 FLIP
                flipTransition.value = `transform ${DURATION}ms ${EASING}, border-radius ${DURATION}ms ${EASING}`;
                flipTransform.value = 'translate(0, 0) scale(1, 1)';
                flipBorderRadius.value = '16px'; // 详情页的 rounded-2xl

                // 背景 Cross-fade（立即开始）
                bgOpacity.value = 1;

                // 配角元素交错渐入
                staggerTimers.push(
                    setTimeout(() => {
                        if (animId !== currentAnimationId) return;
                        staggerPhase.value = 1; // 顶栏
                    }, DURATION * 0.45),

                    setTimeout(() => {
                        if (animId !== currentAnimationId) return;
                        staggerPhase.value = 2; // 歌曲信息 + 控件
                    }, DURATION * 0.6),

                    setTimeout(() => {
                        if (animId !== currentAnimationId) return;
                        staggerPhase.value = 3; // 歌词区域
                    }, DURATION * 0.8),
                );

                // 完成
                setTimeout(() => {
                    if (animId !== currentAnimationId) { resolve(); return; }
                    flipTransition.value = '';
                    flipTransform.value = '';
                    animationPhase.value = 'idle';
                    isAnimating.value = false;
                    footerCoverVisible.value = true;
                    resolve();
                }, DURATION);
            });
        });
    });
}

/**
 * 收起动画 - 反向 FLIP
 * 调用时传入详情页封面元素以获取当前位置
 */
function playLeave(detailCoverEl: HTMLElement): Promise<void> {
    return new Promise((resolve) => {
        const animId = ++currentAnimationId;
        animationPhase.value = 'leaving';
        isAnimating.value = true;
        clearStaggerTimers();

        // 先让配角元素立即淡出
        staggerPhase.value = 0;

        if (!firstRect.value) {
            bgOpacity.value = 0;
            setTimeout(() => {
                animationPhase.value = 'idle';
                isAnimating.value = false;
                footerCoverVisible.value = true;
                resolve();
            }, DURATION * 0.6);
            return;
        }

        // 重新获取底栏封面位置（可能因窗口 resize 而变化）
        const footerEl = document.querySelector('[data-footer-cover]') as HTMLElement | null;
        if (footerEl) {
            const rect = footerEl.getBoundingClientRect();
            firstRect.value = {
                x: rect.left,
                y: rect.top,
                width: rect.width,
                height: rect.height,
            };
        }

        const lRect = detailCoverEl.getBoundingClientRect();

        // 当前在 Last 位置，需要动画到 First
        const dx = firstRect.value.x - lRect.left;
        const dy = firstRect.value.y - lRect.top;
        const sx = firstRect.value.width / lRect.width;
        const sy = firstRect.value.height / lRect.height;

        // 当前位置（无偏移）
        flipTransition.value = 'none';
        flipTransform.value = 'translate(0, 0) scale(1, 1)';
        flipBorderRadius.value = '16px';

        // 背景淡出
        bgOpacity.value = 0;

        requestAnimationFrame(() => {
            if (animId !== currentAnimationId) { resolve(); return; }
            requestAnimationFrame(() => {
                if (animId !== currentAnimationId) { resolve(); return; }

                flipTransition.value = `transform ${DURATION}ms ${EASING}, border-radius ${DURATION}ms ${EASING}`;
                flipTransform.value = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
                flipBorderRadius.value = '8px';

                setTimeout(() => {
                    if (animId !== currentAnimationId) { resolve(); return; }
                    flipTransition.value = '';
                    flipTransform.value = '';
                    animationPhase.value = 'idle';
                    isAnimating.value = false;
                    footerCoverVisible.value = true;
                    resolve();
                }, DURATION);
            });
        });
    });
}

/**
 * 取消当前动画（快速连续点击场景）
 */
function cancel() {
    currentAnimationId++;
    clearStaggerTimers();
    flipTransition.value = '';
    flipTransform.value = '';
    flipBorderRadius.value = '';
    bgOpacity.value = 0;
    staggerPhase.value = 0;
    animationPhase.value = 'idle';
    isAnimating.value = false;
    footerCoverVisible.value = true;
}

/**
 * 封面动画样式（绑定到详情页封面元素）
 */
const coverStyle = computed<CSSProperties>(() => {
    const style: CSSProperties = {};
    if (flipTransform.value) {
        style.transform = flipTransform.value;
        style.transformOrigin = 'top left';
    }
    if (flipBorderRadius.value) {
        style.borderRadius = flipBorderRadius.value;
    }
    if (flipTransition.value && flipTransition.value !== 'none') {
        style.transition = flipTransition.value;
    } else if (flipTransition.value === 'none') {
        style.transition = 'none';
    }
    return style;
});

/**
 * composable 入口
 */
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
        DURATION,
    };
}
