<script setup lang="ts">
/**
 * 播放详情页「多边形流光」背景（Voronoi 网格）。
 *
 * 效果原理（与网易云/参考实现的 mesh gradient 同类）：
 * 1. 在屏幕空间按哈希网格撒种子点（每个格子一个），种子随时间缓慢漂移；
 * 2. 每个像素取最近的种子（F1）作为自己的格子归属 → 自然形成随机边数的凸多边形；
 * 3. 多边形的颜色取自「封面低频色场」在该种子处的取样色；
 * 4. 用 F2-F1（到最近与次近种子的距离差）画多边形边界的细微高光，
 *    让多边形结构可见，得到"多边形流光"的观感。
 *
 * 渲染：WebGL2/WebGL1 + 单个全屏三角形，逐像素计算；封面色场作为纹理上传，
 * 换歌时用 uniform 交叉淡化两张色场。种子漂移在 GPU 内完成，不逐帧上传纹理。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { usePlaybackStore } from '../../features/playback/store';

const props = defineProps<{
  /** 详情页是否可见：不可见时暂停渲染 */
  active?: boolean;
}>();

const playbackStore = usePlaybackStore();
const { currentCover, currentCoverFull } = storeToRefs(playbackStore);

const canvasRef = ref<HTMLCanvasElement | null>(null);

// —— 可调参数 ——
/** Voronoi 格子密度：值越小多边形越大（参考图是大块面） */
const CELL_DENSITY = 4.3;
/** 种子在格内的随机偏移幅度：越大则各元胞面积差异越明显 */
const SEED_JITTER = 0.5;
/** 种子漂移速度 */
const DRIFT_SPEED = 0.42;
/** 接缝暗缝深度：相邻多边形之间压暗，形成切面感（参考图的柔和暗边） */
const SEAM_DEPTH = 0.16;
/** 接缝过渡宽度：越大越柔和 */
const SEAM_WIDTH = 0.14;
/** 多边形颜色向「按像素位置取色」的平滑渐变色混合的比例：
 *  0 = 纯平涂（块面感强、偏硬），1 = 纯渐变（柔和但没有多边形感）。
 *  取中间值可保留多边形结构的同时让相邻色块自然衔接。 */
const GRADIENT_BLEND = 0.45;
/** 色饱和度压缩：越低越接近参考图那种低饱和、柔和的观感 */
const SATURATION = 0.72;
/** 色场整体明度（<1 更暗更沉稳） */
const BRIGHTNESS = 0.86;
/** 渲染分辨率系数：低于 1 由浏览器放大，边缘自然柔化并显著降低填充率 */
const RENDER_SCALE = 0.45;
/** 换歌交叉淡化时长（ms） */
const FADE_MS = 900;
/** 封面色场采样分辨率（低频色场；越低，相邻多边形颜色越接近、整体越柔和） */
const COLORFIELD_SIZE = 14;

const VERT_SRC = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG_SRC = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform float uDensity;
uniform float uSeedJitter;
uniform float uDriftSpeed;
uniform float uSeamDepth;
uniform float uSeamWidth;
uniform float uGradientBlend;
uniform float uSaturation;
uniform float uBrightness;
uniform sampler2D uColorFieldA;
uniform sampler2D uColorFieldB;
uniform float uFade;

out vec4 fragColor;

// —— 哈希与随机方向 ——
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec2 hash22(vec2 p) {
  float n = hash21(p);
  return vec2(n, hash21(p + n + 17.31));
}

/** 第 i 个邻居的漂移单位方向（与时间无关，保证种子沿固定方向匀速漂移） */
vec2 driftDir(vec2 cell, float i) {
  return normalize(hash22(cell + i * 37.19) * 2.0 - 1.0);
}

/**
 * 求像素到所有邻近种子的最近距离 F1、次近距离 F2，以及最近种子的格子标识。
 * 3x3 邻域足以覆盖一个格子的影响范围（种子漂移量小于半格）。
 */
void voronoi(vec2 p, out float f1, out float f2, out vec2 nearestId) {
  vec2 baseCell = floor(p);
  f1 = 8.0;
  f2 = 8.0;
  nearestId = baseCell;

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 cell = baseCell + vec2(float(x), float(y));
      // 种子在格内随机偏移 + 随时间漂移（漂移方向固定，形成流动感）
      vec2 jitter = 0.5 + uSeedJitter * (hash22(cell) * 2.0 - 1.0);
      vec2 drift = driftDir(cell, 0.0) * 0.26 * sin(uTime * uDriftSpeed + hash21(cell) * 6.2831);
      vec2 seed = cell + clamp(jitter + drift, vec2(0.04), vec2(0.96));

      float d = distance(p, seed);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        nearestId = cell;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  // 保持格子在各方向等大（用分辨率较短的边归一化）
  float aspect = uResolution.x / uResolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y) * uDensity;

  float f1, f2;
  vec2 nearestId;
  voronoi(p, f1, f2, nearestId);

  // 关键：按「最近种子的格子」取样，整个多边形平涂一色。
  // 若按 floor(p) 取样，得到的是与 Voronoi 元胞不对齐的轴对齐矩形色块。
  vec2 cellCenter = (nearestId + 0.5) / uDensity;
  // 反算回屏幕 uv（与按像素取色共用同一映射，两者才能平滑混合）
  vec2 cellUv = clamp(vec2(cellCenter.x / aspect, cellCenter.y), 0.0, 1.0);

  // 纯平涂色（多边形感来源）
  vec3 flatA = texture(uColorFieldA, cellUv).rgb;
  vec3 flatB = texture(uColorFieldB, cellUv).rgb;
  vec3 flatColor = mix(flatA, flatB, uFade);

  // 按像素位置取色（连续渐变色，柔和的来源）
  vec2 pixelUv = clamp(uv, 0.0, 1.0);
  vec3 gradA = texture(uColorFieldA, pixelUv).rgb;
  vec3 gradB = texture(uColorFieldB, pixelUv).rgb;
  vec3 gradColor = mix(gradA, gradB, uFade);

  // 两者混合：保留可辨的多边形结构，同时让相邻色块之间柔和衔接
  vec3 color = mix(flatColor, gradColor, uGradientBlend);

  // 降饱和 + 压暗：贴近参考图那种低调、不刺眼的面色调
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luma), color, uSaturation) * uBrightness;

  // 相邻多边形之间压暗成柔和暗缝（切面感），不做亮线描边
  float seam = smoothstep(uSeamWidth, 0.0, f2 - f1);
  color *= 1.0 - seam * uSeamDepth;

  // 轻微暗角，让画面四周沉下去
  float vignette = smoothstep(1.15, 0.25, distance(uv, vec2(0.5)));
  color *= mix(0.82, 1.02, vignette);

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;

let gl: WebGL2RenderingContext | null = null;
let program: WebGLProgram | null = null;
let vao: WebGLVertexArrayObject | null = null;
let canvas: HTMLCanvasElement | null = null;
let uniformLoc: Record<string, WebGLUniformLocation | null> = {};

/** 封面色场纹理（A=当前，B=上一张，用于交叉淡化） */
let texA: WebGLTexture | null = null;
let texB: WebGLTexture | null = null;
let fadeStart = performance.now();
let hasPrev = false;

let rafId = 0;
let disposed = false;
let lastTime = 0;
let running = false;

function compile(glc: WebGL2RenderingContext, type: number, src: string) {
  const shader = glc.createShader(type);
  if (!shader) return null;
  glc.shaderSource(shader, src);
  glc.compileShader(shader);
  if (!glc.getShaderParameter(shader, glc.COMPILE_STATUS)) {
    console.warn('[MeshBackground] shader 编译失败:', glc.getShaderInfoLog(shader));
    glc.deleteShader(shader);
    return null;
  }
  return shader;
}

function initGl(): boolean {
  if (gl) return true;
  const target = canvasRef.value;
  if (!target) return false;

  const context = target.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
    preserveDrawingBuffer: false,
  });
  if (!context) {
    console.warn('[MeshBackground] WebGL2 不可用，回退为静态背景');
    return false;
  }

  const vs = compile(context, context.VERTEX_SHADER, VERT_SRC);
  const fs = compile(context, context.FRAGMENT_SHADER, FRAG_SRC);
  if (!vs || !fs) return false;

  const prog = context.createProgram();
  if (!prog) return false;
  context.attachShader(prog, vs);
  context.attachShader(prog, fs);
  context.linkProgram(prog);
  if (!context.getProgramParameter(prog, context.LINK_STATUS)) {
    console.warn('[MeshBackground] program 链接失败:', context.getProgramInfoLog(prog));
    return false;
  }

  gl = context;
  program = prog;
  canvas = target;

  // 全屏三角形
  vao = context.createVertexArray();
  context.bindVertexArray(vao);
  const buffer = context.createBuffer();
  context.bindBuffer(context.ARRAY_BUFFER, buffer);
  context.bufferData(
    context.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    context.STATIC_DRAW,
  );
  const posLoc = context.getAttribLocation(prog, 'aPos');
  context.enableVertexAttribArray(posLoc);
  context.vertexAttribPointer(posLoc, 2, context.FLOAT, false, 0, 0);

  for (const name of [
    'uResolution', 'uTime', 'uDensity', 'uSeedJitter', 'uDriftSpeed',
    'uSeamDepth', 'uSeamWidth', 'uGradientBlend', 'uSaturation', 'uBrightness',
    'uColorFieldA', 'uColorFieldB', 'uFade',
  ]) {
    uniformLoc[name] = context.getUniformLocation(prog, name);
  }

  texA = createTexture(context);
  texB = createTexture(context);

  context.useProgram(prog);
  context.uniform1i(uniformLoc.uColorFieldA ?? null, 0);
  context.uniform1i(uniformLoc.uColorFieldB ?? null, 1);

  return true;
}

function createTexture(context: WebGL2RenderingContext): WebGLTexture | null {
  const tex = context.createTexture();
  if (!tex) return null;
  context.bindTexture(context.TEXTURE_2D, tex);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
  return tex;
}

function resize() {
  if (!canvas || !gl) return;
  // 用低于 1 的分辨率系数渲染，由浏览器放大：边缘更柔和，填充率显著降低
  const dpr = Math.min(2, window.devicePixelRatio || 1) * RENDER_SCALE;
  const w = Math.max(1, Math.round(window.innerWidth * dpr));
  const h = Math.max(1, Math.round(window.innerHeight * dpr));
  if (canvas.width === w && canvas.height === h) return;
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  gl.viewport(0, 0, w, h);
}

function renderFrame() {
  if (!gl || !program || !canvas) return;
  const now = performance.now();
  const time = now / 1000;

  gl.useProgram(program);
  gl.uniform2f(uniformLoc.uResolution ?? null, canvas.width, canvas.height);
  gl.uniform1f(uniformLoc.uTime ?? null, time);
  gl.uniform1f(uniformLoc.uDensity ?? null, CELL_DENSITY);
  gl.uniform1f(uniformLoc.uSeedJitter ?? null, SEED_JITTER);
  gl.uniform1f(uniformLoc.uDriftSpeed ?? null, DRIFT_SPEED);
  gl.uniform1f(uniformLoc.uSeamDepth ?? null, SEAM_DEPTH);
  gl.uniform1f(uniformLoc.uSeamWidth ?? null, SEAM_WIDTH);
  gl.uniform1f(uniformLoc.uGradientBlend ?? null, GRADIENT_BLEND);
  gl.uniform1f(uniformLoc.uSaturation ?? null, SATURATION);
  gl.uniform1f(uniformLoc.uBrightness ?? null, BRIGHTNESS);

  // 交叉淡化进度
  const fade = hasPrev ? Math.min(1, (now - fadeStart) / FADE_MS) : 1;
  gl.uniform1f(uniformLoc.uFade ?? null, fade);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texA);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, hasPrev ? texB : texA);

  gl.bindVertexArray(vao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  if (hasPrev && fade >= 1) {
    // 淡化完成：把上一张纹理槽归还（下次换歌复用）
    hasPrev = false;
  }
}

function tick() {
  if (disposed) return;
  rafId = requestAnimationFrame(tick);
  if (!running) return;

  resize();
  // 背景漂移缓慢，30fps 足够顺滑且显著省电
  const now = performance.now();
  if (now - lastTime < 33) return;
  lastTime = now;

  renderFrame();
}

// —— 封面 → 低频色场 ——

const coverUrl = ref('');
let loadSeq = 0;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('cover load failed'));
    img.src = url;
  });
}

/**
 * 把封面降采样成低频色场（保留色相与大致明暗分布），
 * 供着色器按多边形种子位置取样。
 */
function buildColorField(image: HTMLImageElement): Uint8Array | null {
  const size = COLORFIELD_SIZE;
  const off = document.createElement('canvas');
  off.width = size;
  off.height = size;
  const offCtx = off.getContext('2d', { willReadFrequently: true });
  if (!offCtx) return null;

  // 等效 object-fit: cover
  const targetRatio = 1;
  const imgRatio = image.width / image.height;
  let sw = image.width;
  let sh = image.height;
  let sx = 0;
  let sy = 0;
  if (imgRatio > targetRatio) {
    sw = image.height * targetRatio;
    sx = (image.width - sw) / 2;
  } else {
    sh = image.width / targetRatio;
    sy = (image.height - sh) / 2;
  }
  offCtx.drawImage(image, sx, sy, sw, sh, 0, 0, size, size);

  const data = offCtx.getImageData(0, 0, size, size).data;
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // 低频色场本身先做一次柔化：轻度去饱和 + 暗部抬升，
    // 避免纯黑区域和过艳的颜色直接进入多边形色块（硬感的来源之一）。
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const sat = 0.78;
    const lift = 10; // 抬暗部，防止深色封面全黑
    out[i] = Math.max(0, Math.min(255, luma + (r - luma) * sat + lift));
    out[i + 1] = Math.max(0, Math.min(255, luma + (g - luma) * sat + lift));
    out[i + 2] = Math.max(0, Math.min(255, luma + (b - luma) * sat + lift));
    out[i + 3] = 255;
  }
  return out;
}

function uploadField(pixels: Uint8Array, texture: WebGLTexture | null) {
  if (!gl || !texture) return;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA, COLORFIELD_SIZE, COLORFIELD_SIZE, 0,
    gl.RGBA, gl.UNSIGNED_BYTE, pixels,
  );
}

async function rebuildColorField() {
  const url = coverUrl.value;
  if (!url || !initGl()) return;

  const seq = ++loadSeq;
  try {
    const image = await loadImage(url);
    if (seq !== loadSeq || disposed) return;

    const field = buildColorField(image);
    if (!field) return;

    // 当前色场挪到 B 槽做淡出，新色场写入 A 槽
    if (texA && gl) {
      const tmp = texB;
      texB = texA;
      texA = tmp;
      hasPrev = true;
      fadeStart = performance.now();
    }
    uploadField(field, texA);
    renderFrame();
  } catch {
    // 封面加载失败：保留上一次色场，不动
  }
}

watch([currentCover, currentCoverFull], () => {
  const next = currentCover.value || currentCoverFull.value || '';
  if (next === coverUrl.value) return;
  coverUrl.value = next;
  void rebuildColorField();
}, { immediate: true });

watch(() => props.active ?? true, (active) => {
  running = active;
  if (active) {
    lastTime = 0;
    renderFrame();
  }
}, { immediate: true });

const handleResize = () => {
  resize();
  renderFrame();
};

onMounted(() => {
  initGl();
  resize();
  void rebuildColorField();
  running = props.active ?? true;
  window.addEventListener('resize', handleResize);
  rafId = requestAnimationFrame(tick);
});

onBeforeUnmount(() => {
  disposed = true;
  running = false;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  window.removeEventListener('resize', handleResize);

  if (gl) {
    if (texA) gl.deleteTexture(texA);
    if (texB) gl.deleteTexture(texB);
    if (vao) gl.deleteVertexArray(vao);
    if (program) gl.deleteProgram(program);
    const lose = gl.getExtension('WEBGL_lose_context');
    lose?.loseContext();
  }
  gl = null;
  program = null;
  vao = null;
  texA = null;
  texB = null;
  canvas = null;
  uniformLoc = {};
});
</script>

<template>
  <div class="absolute inset-0 overflow-hidden pointer-events-none select-none">
    <canvas ref="canvasRef" class="block h-full w-full" />
    <!-- 上下压暗，保证歌词与标题的可读性 -->
    <div class="absolute inset-0 bg-gradient-to-b from-black/12 via-transparent to-black/32"></div>
  </div>
</template>
