interface PreblurOptions { // 实现
    blur: number;
    brightness: number;
}

interface PreblurCacheRecord {
    objectUrl: string;
    validUntil: number;
}

interface CenterCropPlan {
    cropSide: number;
    cropLeft: number;
    cropTop: number;
    canvasSide: number;
}

const STORE_CAPACITY = 3;
const RECORD_LIFETIME_MS = 3 * 60 * 1000;
const RENDER_TARGET_MAX = 512;
const RENDER_TARGET_MIN = 384;
const MIN_RENDER_BLUR_PX = 8;
const WEBP_ENCODE_QUALITY = 0.82;

/**
 * 以 LRU + TTL 规则保管已生成的预模糊 object URL：
 * 命中即续期并挪到队尾，过期/超容逐出时同步 revoke。
 */
class PreblurUrlStore {
    private readonly records = new Map<string, PreblurCacheRecord>();

    private revoke(record: PreblurCacheRecord | undefined) {
        if (record) {
            URL.revokeObjectURL(record.objectUrl);
        }
    }

    private sweep() {
        const now = Date.now();

        for (const [key, record] of this.records) {
            if (record.validUntil <= now) {
                this.revoke(record);
                this.records.delete(key);
            }
        }

        while (this.records.size > STORE_CAPACITY) {
            const eldest = this.records.keys().next().value;
            if (eldest === undefined) {
                break;
            }
            this.revoke(this.records.get(eldest));
            this.records.delete(eldest);
        }
    }

    acquire(key: string): string {
        this.sweep();

        const record = this.records.get(key);
        if (!record) {
            return "";
        }

        this.records.delete(key);
        this.records.set(key, {
            objectUrl: record.objectUrl,
            validUntil: Date.now() + RECORD_LIFETIME_MS,
        });
        return record.objectUrl;
    }

    keep(key: string, objectUrl: string) {
        this.revoke(this.records.get(key));
        this.records.delete(key);
        this.records.set(key, {
            objectUrl,
            validUntil: Date.now() + RECORD_LIFETIME_MS,
        });
        this.sweep();
    }

    dropEverything() {
        for (const record of this.records.values()) {
            this.revoke(record);
        }
        this.records.clear();
    }
}

const urlStore = new PreblurUrlStore();
const runningRenders = new Map<string, Promise<string>>();
let storeGeneration = 0;

function composeCacheKey(src: string, options: PreblurOptions) {
    return JSON.stringify({
        src,
        blur: Math.round(options.blur),
        brightness: Math.round(options.brightness * 100) / 100,
        max: RENDER_TARGET_MAX,
    });
}

function requestImage(src: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        const unbindHandlers = () => {
            image.onload = null;
            image.onerror = null;
        };

        image.onload = () => {
            unbindHandlers();
            resolve(image);
        };
        image.onerror = () => {
            unbindHandlers();
            image.src = "";
            reject(new Error("Failed to load background image"));
        };
        image.crossOrigin = "Anonymous";
        image.decoding = "async";
        image.src = src;
    });
}

function measureRenderTarget(image: HTMLImageElement) {
    const naturalSide = Math.max(
        image.naturalWidth || image.width,
        image.naturalHeight || image.height,
    );
    if (naturalSide <= 0) {
        return RENDER_TARGET_MIN;
    }
    return Math.round(
        Math.min(RENDER_TARGET_MAX, Math.max(RENDER_TARGET_MIN, naturalSide)),
    );
}

function planCenterCrop(
    image: HTMLImageElement,
    canvasSide: number,
): CenterCropPlan {
    const fullSizeW = image.naturalWidth || image.width;
    const fullSizeH = image.naturalHeight || image.height;
    const cropSide = Math.min(fullSizeW, fullSizeH);

    return {
        cropSide,
        cropLeft: Math.max(0, (fullSizeW - cropSide) / 2),
        cropTop: Math.max(0, (fullSizeH - cropSide) / 2),
        canvasSide,
    };
}

function scaleBlurToCanvas(blur: number, canvasSide: number) {
    return Math.max(
        MIN_RENDER_BLUR_PX,
        Math.round(blur * (canvasSide / RENDER_TARGET_MAX)),
    );
}

function encodeAsWebp(canvas: HTMLCanvasElement) {
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            (chunk) => {
                if (chunk) {
                    resolve(chunk);
                    return;
                }
                reject(new Error("Failed to encode preblurred background"));
            },
            "image/webp",
            WEBP_ENCODE_QUALITY,
        );
    });
}

async function renderPreblurredCopy(src: string, options: PreblurOptions) {
    const image = await requestImage(src);
    const canvas = document.createElement("canvas");

    try {
        const canvasSide = measureRenderTarget(image);
        canvas.width = canvasSide;
        canvas.height = canvasSide;
        const context = canvas.getContext("2d");

        if (!context) {
            return src;
        }

        const crop = planCenterCrop(image, canvasSide);
        context.filter = `blur(${scaleBlurToCanvas(options.blur, canvasSide)}px) brightness(${options.brightness})`;
        context.drawImage(
            image,
            crop.cropLeft,
            crop.cropTop,
            crop.cropSide,
            crop.cropSide,
            0,
            0,
            crop.canvasSide,
            crop.canvasSide,
        );

        const blob = await encodeAsWebp(canvas);
        return URL.createObjectURL(blob);
    } finally {
        canvas.width = 0;
        canvas.height = 0;
        image.onload = null;
        image.onerror = null;
        image.src = "";
    }
}

export async function getPreblurredBackgroundUrl(
    src: string,
    options: PreblurOptions,
) {
    if (!src || typeof document === "undefined") {
        return src;
    }

    const key = composeCacheKey(src, options);
    const readyUrl = urlStore.acquire(key);
    if (readyUrl) {
        return readyUrl;
    }

    const alreadyRunning = runningRenders.get(key);
    if (alreadyRunning) {
        return alreadyRunning;
    }

    const generationAtSubmit = storeGeneration;
    const task = renderPreblurredCopy(src, options)
        .then((url) => {
            if (generationAtSubmit !== storeGeneration) {
                if (url !== src) {
                    URL.revokeObjectURL(url);
                }
                return src;
            }

            if (url !== src) {
                urlStore.keep(key, url);
            }
            return url;
        })
        .catch(() => src)
        .finally(() => {
            runningRenders.delete(key);
        });

    runningRenders.set(key, task);
    return task;
}

export function clearPreblurredBackgroundCache() { // 实现
    storeGeneration += 1;
    urlStore.dropEverything();
    runningRenders.clear();
}

let visibilityHookBound = false;

const dropCacheWhenHidden = () => {
    if (document.visibilityState === "hidden") {
        clearPreblurredBackgroundCache();
    }
};

function bindVisibilityHook() {
    if (visibilityHookBound || typeof document === "undefined") {
        return;
    }
    document.addEventListener("visibilitychange", dropCacheWhenHidden);
    visibilityHookBound = true;
}

function unbindVisibilityHook() {
    if (!visibilityHookBound || typeof document === "undefined") {
        return;
    }
    document.removeEventListener("visibilitychange", dropCacheWhenHidden);
    visibilityHookBound = false;
}

bindVisibilityHook();

if (import.meta.hot) {
    import.meta.hot.dispose(unbindVisibilityHook);
}
