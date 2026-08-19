/**
 * 音效引擎 - 基于 Web Audio API
 * 参考 lx-music-desktop 的音效实现
 *
 * 音频节点连接链路：
 * source -> analyser -> biquadFilter -> [pitchShifter] -> [(convolver & convolverSource) -> convolverDynamicsCompressor] -> [effectsRack] -> [spatial effects] -> panner -> gain -> destination
 */

// 均衡器频段
export const freqs = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const
type Freqs = (typeof freqs)[number]

// 均衡器预设
export const freqsPreset = [
  { name: '流行', hz31: 6, hz62: 5, hz125: -3, hz250: -2, hz500: 5, hz1000: 4, hz2000: -4, hz4000: -3, hz8000: 6, hz16000: 4 },
  { name: '舞曲', hz31: 4, hz62: 3, hz125: -4, hz250: -6, hz500: 0, hz1000: 0, hz2000: 3, hz4000: 4, hz8000: 4, hz16000: 5 },
  { name: '摇滚', hz31: 7, hz62: 6, hz125: 2, hz250: 1, hz500: -3, hz1000: -4, hz2000: 2, hz4000: 1, hz8000: 4, hz16000: 5 },
  { name: '古典', hz31: 6, hz62: 7, hz125: 1, hz250: 2, hz500: -1, hz1000: 1, hz2000: -4, hz4000: -6, hz8000: -7, hz16000: -8 },
  { name: '人声', hz31: -5, hz62: -6, hz125: -4, hz250: -3, hz500: 3, hz1000: 4, hz2000: 5, hz4000: 4, hz8000: -3, hz16000: -3 },
  { name: '慢歌', hz31: 5, hz62: 4, hz125: 2, hz250: 0, hz500: -2, hz1000: 0, hz2000: 3, hz4000: 6, hz8000: 7, hz16000: 8 },
  { name: '电子乐', hz31: 6, hz62: 5, hz125: 0, hz250: -5, hz500: -4, hz1000: 0, hz2000: 6, hz4000: 8, hz8000: 8, hz16000: 7 },
  { name: '重低音', hz31: 8, hz62: 7, hz125: 5, hz250: 4, hz500: 0, hz1000: 0, hz2000: 0, hz4000: 0, hz8000: 0, hz16000: 0 },
  { name: '柔和', hz31: -5, hz62: -5, hz125: -4, hz250: -4, hz500: 3, hz1000: 2, hz2000: 4, hz4000: 4, hz8000: 0, hz16000: 0 },
] as const

// 新增均衡器预设（均衡衍生预设）
export { advancedEqPresets } from './advancedEffects'

// 卷积混响预设。
// dry/wet 即干声/湿声百分比（0~100），与音效面板滑杆单位一致：wet 作为混响尾音的
// 混合占比（约 20~60 为宜），dry 保持节目清晰度（约 70~95）。数值过大（>100）会
// 放大信号导致破音，这里预置值均控制在安全范围内，Rust 侧另有 [0,1] 夹取兜底。
export const convolutions = [
  { name: '电话', label: 'phone', dry: 15, wet: 55, source: 'filter-telephone.wav' },
  { name: '教堂', label: 'church', dry: 70, wet: 60, source: 's2_r4_bd.wav' },
  { name: '大厅', label: 'hall', dry: 80, wet: 45, source: 'bright-hall.wav' },
  { name: '电影院', label: 'cinema', dry: 75, wet: 50, source: 'cinema-diningroom.wav' },
  { name: '餐厅', label: 'restaurant', dry: 80, wet: 40, source: 'dining-living-true-stereo.wav' },
  { name: '卫生间', label: 'bathroom', dry: 85, wet: 35, source: 'living-bedroom-leveled.wav' },
  { name: '室内', label: 'room', dry: 88, wet: 30, source: 'spreader50-65ms.wav' },
  { name: '立体声', label: 'stereo', dry: 95, wet: 20, source: 's3_r1_bd.wav' },
  { name: '矩阵混响（1）', label: 'matrixReverb1', dry: 85, wet: 35, source: 'matrix-reverb1.wav' },
  { name: '矩阵混响（2）', label: 'matrixReverb2', dry: 82, wet: 40, source: 'matrix-reverb2.wav' },
  { name: '心形扩散', label: 'cardioidSpread', dry: 92, wet: 25, source: 'cardiod-35-10-spread.wav' },
  { name: '磁性立体声', label: 'magneticStereo', dry: 95, wet: 15, source: 'tim-omni-35-10-magnetic.wav' },
  { name: '反馈抑制', label: 'feedbackSuppressor', dry: 90, wet: 25, source: 'feedback-spring.wav' },
] as const

// 算法混响预设（程序生成 IR，无需音频文件）
export { algorithmicReverbs, generateReverbIR } from './advancedEffects'
export type { AlgorithmicReverbPreset } from './advancedEffects'
import type {EffectsRack} from './advancedEffects'
// ===== 高级效果架 =====
import {
  algorithmicReverbs as _algorithmicReverbs,
  createEffectsRack,
  generateReverbIR as _generateReverbIR
} from './advancedEffects'

let audioContext: AudioContext | null = null
let mediaSource: MediaElementAudioSourceNode | null = null
let analyser: AnalyserNode | null = null
let biquads: Map<`hz${Freqs}`, BiquadFilterNode> | null = null
let convolver: ConvolverNode | null = null
let convolverSourceGainNode: GainNode | null = null
let convolverOutputGainNode: GainNode | null = null
let convolverDynamicsCompressor: DynamicsCompressorNode | null = null
let gainNode: GainNode | null = null
let safetyLimiter: DynamicsCompressorNode | null = null
let panner: PannerNode | null = null
let pitchShifterNode: AudioWorkletNode | null = null
let pitchShifterNodePitchFactor: AudioParam | null = null
let pitchShifterNodeLoadStatus: 'none' | 'loading' | 'unconnect' | 'connected' = 'none'
let pitchShifterNodeTempValue = 1
let currentAudioElement: HTMLAudioElement | null = null
let isSourceConnected = false

// 录音用目标节点
let mediaStreamDestination: MediaStreamAudioDestinationNode | null = null

// 8D 环绕声节点
let panner8D: PannerNode | null = null
let panner8DInfo = {
  enabled: false,
  rad: 0,
  speed: 10, // 旋转一圈所需秒数
  radius: 1, // 虚拟声源距离
  intv: null as ReturnType<typeof setInterval> | null,
}

// 36D环绕声节点（HRTF + 垂直摆动 + 距离波动 + 空气低通）
// 在原 8D 水平旋转基础上，叠加 y 轴正弦摆动、半径周期性伸缩、空气吸收低通滤波
// 听感上比原 8D 更具立体层次与远近呼吸感
let panner36D: PannerNode | null = null
let filter36D: BiquadFilterNode | null = null
let panner36DInfo = {
  enabled: false,
  rad: 0,
  speed: 10, // 旋转一圈所需秒数
  radius: 1, // 虚拟声源基础距离
  intv: null as ReturnType<typeof setInterval> | null,
}

// 虚拟多声道环绕节点（7.1/5.1）
// 使用 ChannelSplitterNode 分离 L/R 声道，分别路由到对应虚拟扬声器
let virtualSurroundPanners: PannerNode[] = []
let virtualSurroundGains: GainNode[] = []
let virtualSurroundMerger: ChannelMergerNode | null = null
let virtualSurroundLFE: BiquadFilterNode | null = null
let virtualSurroundLFEGain: GainNode | null = null
let virtualSurroundInput: GainNode | null = null
let virtualSurroundInfo = {
  enabled: false,
  mode: '7.1' as '5.1' | '7.1',
  spread: 1, // 声场宽度
}

// 虚拟扬声器位置（听众在原点面朝 -Z 方向）
// Web Audio 坐标系: X=左右, Y=上下, Z=前后（-Z 为前方）
// 7.1 声道: FL/FR/C/SL/SR/RL/RR + LFE(低音炮)
const speakerPositions71 = [
  { x: -0.866, y: 0, z: -0.5 },   // 前左 FL (-30°)
  { x: 0.866, y: 0, z: -0.5 },    // 前右 FR (+30°)
  { x: 0, y: 0, z: -1 },           // 中置 C (0°)
  { x: -1, y: 0, z: 0 },           // 侧左 SL (-90°)
  { x: 1, y: 0, z: 0 },            // 侧右 SR (+90°)
  { x: -0.866, y: 0, z: 0.5 },     // 后左 RL (-150°)
  { x: 0.866, y: 0, z: 0.5 },      // 后右 RR (+150°)
]
// 5.1 声道: FL/FR/C/RL/RR + LFE(低音炮)
const speakerPositions51 = [
  { x: -0.866, y: 0, z: -0.5 },   // 前左 FL (-30°)
  { x: 0.866, y: 0, z: -0.5 },    // 前右 FR (+30°)
  { x: 0, y: 0, z: -1 },           // 中置 C (0°)
  { x: -0.707, y: 0, z: 0.707 },   // 后左 RL (-135°)
  { x: 0.707, y: 0, z: 0.707 },    // 后右 RR (+135°)
]

let effectsRack: EffectsRack | null = null

// 卷积缓冲区缓存
const bufferCache = new Map<string, AudioBuffer>()

// 环绕声状态
let pannerInfo = {
  x: 0,
  y: 0,
  z: 0,
  soundR: 0.5,
  rad: 0,
  speed: 1,
  intv: null as ReturnType<typeof setInterval> | null,
}

/** 初始化 AudioContext 和所有音频节点 */
const initAdvancedAudioFeatures = () => {
  if (audioContext) return
  audioContext = new AudioContext({ latencyHint: 'playback' })

  // 初始化 Analyser
  analyser = audioContext.createAnalyser()
  analyser.fftSize = 256

  // 初始化 BiquadFilter（10段均衡器）
  biquads = new Map()
  for (const item of freqs) {
    const filter = audioContext.createBiquadFilter()
    biquads.set(`hz${item}`, filter)
    filter.type = 'peaking'
    filter.frequency.value = item
    filter.Q.value = 1.4
    filter.gain.value = 0
    // [修复电流声] 不使用 oversample：2x/4x 过采样会让音频线程处理 2~4 倍采样量，
    // 在低 CPU 设备上直接导致 buffer underrun（爆音/卡顿）。Web Audio 的 peaking 滤波器
    // 在音频频段内不需要过采样即可获得足够的精度。
  }
  // 串联连接
  for (let i = 1; i < freqs.length; i++) {
    biquads.get(`hz${freqs[i - 1]}`)!.connect(biquads.get(`hz${freqs[i]}`)!)
  }

  // 初始化卷积混响
  convolverSourceGainNode = audioContext.createGain()
  convolverOutputGainNode = audioContext.createGain()
  // [修复电流声] DynamicsCompressor 默认参数 (threshold=-24, ratio=12) 会持续压缩干信号，
  // 在瞬态峰值上产生可听见的 pumping/clicking 声。
  // 默认设为透明状态 (threshold=0, ratio=1)，仅在混响启用时启用压缩。
  convolverDynamicsCompressor = audioContext.createDynamicsCompressor()
  convolverDynamicsCompressor.threshold.value = 0
  convolverDynamicsCompressor.knee.value = 0
  convolverDynamicsCompressor.ratio.value = 1
  convolverDynamicsCompressor.attack.value = 0.003
  convolverDynamicsCompressor.release.value = 0.25
  convolver = audioContext.createConvolver()
  convolver.connect(convolverOutputGainNode)
  convolverSourceGainNode.connect(convolverDynamicsCompressor)
  convolverOutputGainNode.connect(convolverDynamicsCompressor)

  // 初始化环绕声
  panner = audioContext.createPanner()

  // 初始化增益
  gainNode = audioContext.createGain()

  // 初始化 8D 环绕声节点（HRTF 模式，需使用耳机）
  panner8D = audioContext.createPanner()
  panner8D.panningModel = 'HRTF'
  panner8D.distanceModel = 'inverse'
  panner8D.refDistance = 1
  panner8D.maxDistance = 10000
  panner8D.rolloffFactor = 1
  panner8D.coneInnerAngle = 360
  panner8D.coneOuterAngle = 0
  panner8D.coneOuterGain = 0
  panner8D.positionX.value = 0
  panner8D.positionY.value = 0
  panner8D.positionZ.value = 0

  // 初始化 36D环绕声节点（HRTF PannerNode + 空气吸收低通滤波器）
  // 链路: input → filter36D(空气低通) → panner36D(HRTF空间) → panner
  panner36D = audioContext.createPanner()
  panner36D.panningModel = 'HRTF'
  panner36D.distanceModel = 'inverse'
  panner36D.refDistance = 1
  panner36D.maxDistance = 10000
  panner36D.rolloffFactor = 1
  panner36D.coneInnerAngle = 360
  panner36D.coneOuterAngle = 0
  panner36D.coneOuterGain = 0
  panner36D.positionX.value = 0
  panner36D.positionY.value = 0
  panner36D.positionZ.value = 0
  // 空气吸收低通: 频率随声源距离动态调整（远→闷，近→亮）
  filter36D = audioContext.createBiquadFilter()
  filter36D.type = 'lowpass'
  filter36D.frequency.value = 20000 // 默认全通（不染色）
  filter36D.Q.value = 0.5

  // 设置 AudioListener 位置和朝向（听众在原点，面朝 -Z 方向）
  // MDN: listener 的 forward 默认为 (0,0,-1)，up 默认为 (0,1,0)
  // 确保所有空间音效基于正确的听众位置计算
  const listener = audioContext.listener
  if (listener.positionX) {
    listener.positionX.value = 0
    listener.positionY.value = 0
    listener.positionZ.value = 0
    listener.forwardX.value = 0
    listener.forwardY.value = 0
    listener.forwardZ.value = -1
    listener.upX.value = 0
    listener.upY.value = 1
    listener.upZ.value = 0
  } else {
    // Firefox 旧版 API
    listener.setPosition?.(0, 0, 0)
    listener.setOrientation?.(0, 0, -1, 0, 1, 0)
  }

  // [CPU优化] 效果架延迟创建：首次启用音效时才创建 26 个模块节点链，减少空闲 CPU 占用
  // 初始链路: lastBiquad -> convolverSourceGainNode + convolver -> convolverDynamicsCompressor -> panner -> gain -> destination
  const lastFreq = freqs[freqs.length - 1]
  const lastBiquadFilter = biquads.get(`hz${lastFreq}` as `hz${Freqs}`)!
  lastBiquadFilter.connect(convolverSourceGainNode)
  lastBiquadFilter.connect(convolver)
  convolverDynamicsCompressor.connect(panner)
  panner.connect(gainNode)
  gainNode.connect(audioContext.destination)

  // 默认关闭混响输出
  convolverSourceGainNode.gain.value = 1
  convolverOutputGainNode.gain.value = 0

  // [修复电流声] 终端安全限制器：防止 EQ 增益叠加/混响/音效导致信号超过 0dBFS 削波
  // 削波是电流声/失真的最主要原因之一，限制器在 -1dB 硬限制，透明无副作用
  safetyLimiter = audioContext.createDynamicsCompressor()
  safetyLimiter.threshold.value = -1
  safetyLimiter.knee.value = 0
  safetyLimiter.ratio.value = 20
  safetyLimiter.attack.value = 0.001
  safetyLimiter.release.value = 0.05

  // 重新连接链路: panner -> safetyLimiter -> gainNode -> destination
  try { panner.disconnect() } catch {}
  panner.connect(safetyLimiter)
  safetyLimiter.connect(gainNode)

  // 初始化录音目标节点（从 gainNode 分支，不影响正常播放）
  mediaStreamDestination = audioContext.createMediaStreamDestination()
  gainNode.connect(mediaStreamDestination)
}

// [CPU优化] 效果架延迟创建
let effectsRackInitialized = false

/** 按需创建效果架并插入链路（首次启用任何音效时调用） */
const ensureEffectsRack = () => {
  if (effectsRackInitialized || !audioContext || !convolverDynamicsCompressor || !panner) return
  effectsRackInitialized = true
  effectsRack = createEffectsRack(audioContext)
  // 将效果架插入链路: convolverDynamicsCompressor -> effectsRack.input -> effectsRack.output -> panner
  try { convolverDynamicsCompressor.disconnect() } catch {}
  convolverDynamicsCompressor.connect(effectsRack.input)
  effectsRack.output.connect(panner)
}

/** 获取 panner 前的节点（效果架输出或 convolverDynamicsCompressor） */
const getPrePannerNode = (): AudioNode => {
  if (effectsRack) return effectsRack.output
  return convolverDynamicsCompressor!
}

// [CPU自适应] 检测设备性能等级，动态调整音效处理强度
const detectDevicePerformance = (): 'low' | 'medium' | 'high' => {
  const cores = navigator.hardwareConcurrency || 4
  const memory = (navigator as any).deviceMemory || 4
  if (cores <= 2 || memory <= 2) return 'low'
  if (cores <= 4 || memory <= 4) return 'medium'
  return 'high'
}
const devicePerf = detectDevicePerformance()
// 空间音效定时器间隔（ms）：低性能设备使用更大间隔减少 HRTF 卷积频率
const SPATIAL_INTERVAL_MS = devicePerf === 'low' ? 50 : devicePerf === 'medium' ? 33 : 16

let audioContextResumed = false

/** 确保 AudioContext 已恢复（必须在用户交互中调用） */
const ensureAudioContextResumed = async () => {
  if (!audioContext || audioContextResumed) return
  if (audioContext.state === 'suspended') {
    try {
      await audioContext.resume()
      audioContextResumed = true
    } catch (e) {
      console.warn('[SoundEffect] Failed to resume AudioContext:', e)
    }
  } else {
    audioContextResumed = true
  }
}

// 全局用户交互恢复 AudioContext（只需一次）
let globalResumeListenerAdded = false
const addGlobalResumeListener = () => {
  if (globalResumeListenerAdded) return
  globalResumeListenerAdded = true
  const resumeOnInteraction = () => {
    ensureAudioContextResumed()
    document.removeEventListener('click', resumeOnInteraction)
    document.removeEventListener('keydown', resumeOnInteraction)
  }
  document.addEventListener('click', resumeOnInteraction)
  document.addEventListener('keydown', resumeOnInteraction)
}

/** 将 HTMLAudioElement 连接到音效处理链 */
export const connectAudioElement = async (audio: HTMLAudioElement) => {
  if (currentAudioElement === audio && isSourceConnected) return
  disconnectAudioElement()

  initAdvancedAudioFeatures()
  if (!audioContext) return

  // 恢复 AudioContext（浏览器自动暂停策略）— 必须在用户交互中完成
  await ensureAudioContextResumed()
  addGlobalResumeListener()

  currentAudioElement = audio
  mediaSource = audioContext.createMediaElementSource(audio)
  mediaSource.connect(analyser!)
  // [修复防御]: analyser 必须连接到第一个 biquad 滤波器，否则音频链路断开无声
  analyser!.connect(biquads!.get(`hz${freqs[0]}` as `hz${Freqs}`)!)
  isSourceConnected = true

  // [修复防御]: 切歌时新 audio 元素需重新应用倍速和音调补偿，否则恢复默认值
  if (currentPlaybackRate !== 1) {
    audio.defaultPlaybackRate = currentPlaybackRate
    audio.playbackRate = currentPlaybackRate
  }
  if (!currentPreservesPitch) {
    audio.preservesPitch = currentPreservesPitch
  }

  // 播放事件再次确保 AudioContext 恢复
  audio.addEventListener('playing', handleAudioPlaying)
}

/** 断开当前 AudioElement 的连接，并挂起 AudioContext */
export const disconnectAudioElement = () => {
  if (mediaSource && isSourceConnected) {
    try {
      mediaSource.disconnect()
    } catch {}
    try {
      analyser?.disconnect()
    } catch {}
    isSourceConnected = false
  }
  if (currentAudioElement) {
    currentAudioElement.removeEventListener('playing', handleAudioPlaying)
    currentAudioElement = null
  }
  // [修复电流声] 不再挂起 AudioContext：suspend/resume 循环会在恢复时产生爆音。
  // 只断开 mediaSource 即可，AudioContext 保持运行状态，切歌时无缝衔接。
}

const handleAudioPlaying = () => {
  if (audioContext?.state === 'suspended') {
    audioContext.resume().catch(console.error)
  }
}

/** 获取 AudioContext（懒初始化） */
export const getAudioContext = (): AudioContext => {
  initAdvancedAudioFeatures()
  return audioContext!
}

/** 获取 AnalyserNode */
export const getAnalyser = (): AnalyserNode | null => {
  initAdvancedAudioFeatures()
  return analyser
}

/** 获取 BiquadFilter Map */
export const getBiquadFilter = (): Map<`hz${Freqs}`, BiquadFilterNode> => {
  initAdvancedAudioFeatures()
  return biquads!
}

// ===== 均衡器控制 =====

/** 设置某个频段的增益
 * 参考 lx 项目 Android Equalizer.setBandLevel：原生 API 直接平滑设置
 * Web Audio 对应做法：用 setTargetAtTime 代替 setValueAtTime，避免离散跳变产生咔哒声
 */
export const setBiquadFilterGain = (freq: Freqs, gain: number) => {
  initAdvancedAudioFeatures()
  const node = biquads?.get(`hz${freq}`)
  if (!node || !audioContext) return
  // [修复] setTargetAtTime 比 setValueAtTime 更平滑，不会在拖动滑块时产生咔哒声
  node.gain.setTargetAtTime(gain, audioContext.currentTime, 0.02)
}

/** 应用预设 */
export const applyEqPreset = (preset: typeof freqsPreset[number]) => {
  for (const freq of freqs) {
    const key = `hz${freq}` as keyof typeof preset
    const val = preset[key] as number
    setBiquadFilterGain(freq, val)
  }
}

/** 重置均衡器（所有频段归零） */
export const resetBiquadFilter = () => {
  for (const freq of freqs) {
    setBiquadFilterGain(freq, 0)
  }
}

// ===== 卷积混响控制 =====

/** 异步加载脉冲响应文件 */
const loadBuffer = async (fileName: string): Promise<AudioBuffer> => {
  if (bufferCache.has(fileName)) {
    return bufferCache.get(fileName)!
  }

  const path = `/filters/${fileName}`
  const response = await fetch(path)
  const arrayBuffer = await response.arrayBuffer()

  const ctx = getAudioContext()
  const buffer = await ctx.decodeAudioData(arrayBuffer)
  bufferCache.set(fileName, buffer)
  return buffer
}

/** 设置卷积混响 */
export const setConvolver = async (fileName: string | null, mainGain: number, sendGain: number) => {
  initAdvancedAudioFeatures()
  if (!convolver || !convolverSourceGainNode || !convolverOutputGainNode) return

  if (fileName) {
    try {
      convolver.buffer = await loadBuffer(fileName)
      // [修复电流声] 用 setTargetAtTime 替代直接 .value 赋值，避免 zipper noise
      // 混响启用时启用压缩器控制混响峰值
      const t = audioContext!.currentTime
      convolverDynamicsCompressor!.threshold.setTargetAtTime(-12, t, 0.05)
      convolverDynamicsCompressor!.ratio.setTargetAtTime(3, t, 0.05)
      convolverSourceGainNode.gain.setTargetAtTime(mainGain, t, 0.05)
      convolverOutputGainNode.gain.setTargetAtTime(sendGain, t, 0.05)
    } catch (err) {
      console.error('[SoundEffect] Failed to load convolution buffer:', err)
    }
  } else {
    convolver.buffer = null
    const t = audioContext!.currentTime
    // 混响关闭时压缩器设为透明，避免压缩干信号
    convolverDynamicsCompressor!.threshold.setTargetAtTime(0, t, 0.05)
    convolverDynamicsCompressor!.ratio.setTargetAtTime(1, t, 0.05)
    convolverSourceGainNode.gain.setTargetAtTime(1, t, 0.05)
    convolverOutputGainNode.gain.setTargetAtTime(0, t, 0.05)
  }
}

/** 设置混响干信号增益 */
export const setConvolverMainGain = (gain: number) => {
  if (!audioContext || !convolverSourceGainNode) return
  // [修复] 用 setTargetAtTime 替代 setValueAtTime，拖动滑块时更平滑
  convolverSourceGainNode.gain.setTargetAtTime(gain, audioContext.currentTime, 0.02)
}

/** 设置混响湿信号增益 */
export const setConvolverSendGain = (gain: number) => {
  if (!audioContext || !convolverOutputGainNode) return
  // [修复] 用 setTargetAtTime 替代 setValueAtTime，拖动滑块时更平滑
  convolverOutputGainNode.gain.setTargetAtTime(gain, audioContext.currentTime, 0.02)
}

// ===== 环绕声控制 =====

const setPannerXYZ = (nx: number, ny: number, nz: number) => {
  pannerInfo.x = nx
  pannerInfo.y = ny
  pannerInfo.z = nz
  if (!panner || !audioContext) return
  const t = audioContext.currentTime
  // [修复] 使用 setTargetAtTime 替代直接 .value 赋值，避免 zipper noise
  panner.positionX.setTargetAtTime(nx * pannerInfo.soundR, t, SMOOTH_TC)
  panner.positionY.setTargetAtTime(ny * pannerInfo.soundR, t, SMOOTH_TC)
  panner.positionZ.setTargetAtTime(nz * pannerInfo.soundR, t, SMOOTH_TC)
}

/** 设置环绕半径 */
export const setPannerSoundR = (r: number) => {
  pannerInfo.soundR = r
}

/** 设置环绕速度 */
export const setPannerSpeed = (speed: number) => {
  pannerInfo.speed = speed
  if (pannerInfo.intv) startPanner()
}

/** 停止环绕声 */
export const stopPanner = () => {
  if (pannerInfo.intv) {
    clearInterval(pannerInfo.intv)
    pannerInfo.intv = null
    pannerInfo.rad = 0
  }
  if (panner) {
    panner.positionX.value = 0
    panner.positionY.value = 0
    panner.positionZ.value = 0
  }
}

/** 启动环绕声 */
export const startPanner = () => {
  initAdvancedAudioFeatures()
  if (pannerInfo.intv) {
    clearInterval(pannerInfo.intv)
    pannerInfo.intv = null
    pannerInfo.rad = 0
  }
  pannerInfo.intv = setInterval(() => {
    pannerInfo.rad += 1
    if (pannerInfo.rad > 360) pannerInfo.rad -= 360
    setPannerXYZ(
      Math.sin(pannerInfo.rad * Math.PI / 180),
      Math.cos(pannerInfo.rad * Math.PI / 180),
      Math.cos(pannerInfo.rad * Math.PI / 180)
    )
  }, pannerInfo.speed * 10)
}

// ===== 变调器控制 =====

const connectPitchShifterNode = () => {
  if (!pitchShifterNode || !audioContext) return

  // [修复电流声] 移除 playing/pause/waiting/emptied 事件监听器
  // 原实现会在 'waiting' 事件（拖动滑块时浏览器缓冲触发）断开 analyser 连接，
  // 导致音频链路反复断开重连，产生一卡一卡的现象。
  // phase-vocoder 本身有内部缓冲，播放暂停时保持连接即可，不需要断开。

  const lastFreq = freqs[freqs.length - 1]
  const lastBiquadFilter = biquads!.get(`hz${lastFreq}` as `hz${Freqs}`)!

  // [修复电流声] 不能直接 disconnect！硬断开会切断正在传输的音频信号，
  // 产生瞬态爆音（click）。改用增益淡入淡出：
  // 1. 先用 convolverSourceGainNode 做临时的静音过渡
  const t = audioContext.currentTime
  convolverSourceGainNode!.gain.cancelScheduledValues(t)
  convolverSourceGainNode!.gain.setValueAtTime(convolverSourceGainNode!.gain.value, t)
  convolverSourceGainNode!.gain.linearRampToValueAtTime(0.0001, t + 0.005)

  setTimeout(() => {
    if (!pitchShifterNode || !audioContext) return
    try { lastBiquadFilter.disconnect() } catch {}
    lastBiquadFilter.connect(pitchShifterNode)

    pitchShifterNode.connect(convolver!)
    pitchShifterNode.connect(convolverSourceGainNode!)

    // 恢复增益
    const t2 = audioContext.currentTime
    convolverSourceGainNode!.gain.cancelScheduledValues(t2)
    convolverSourceGainNode!.gain.setValueAtTime(0.0001, t2)
    convolverSourceGainNode!.gain.linearRampToValueAtTime(1, t2 + 0.005)
  }, 6)
  pitchShifterNodeLoadStatus = 'connected'
  if (pitchShifterNodePitchFactor) {
    pitchShifterNodePitchFactor.value = pitchShifterNodeTempValue
  }
}

const loadPitchShifterNode = () => {
  pitchShifterNodeLoadStatus = 'loading'
  initAdvancedAudioFeatures()
  if (!audioContext) return

  // [修复] AudioWorklet.addModule() 不支持 ES module import 语句。
  // 原始 phase-vocoder.js 使用 import FFT/OLAProcessor 会导致加载失败。
  // 改用合并后的自包含文件 phase-vocoder-bundle.js
  const workletUrl = new URL(/* @vite-ignore */ './pitch-shifter/phase-vocoder-bundle.js', import.meta.url)

  audioContext.audioWorklet.addModule(workletUrl).then(() => {
    pitchShifterNode = new AudioWorkletNode(audioContext!, 'phase-vocoder-processor', { outputChannelCount: [2] })
    const pitchFactorParam = pitchShifterNode.parameters.get('pitchFactor')
    if (!pitchFactorParam) {
      console.error('[SoundEffect] pitchFactor parameter not found on worklet node')
      pitchShifterNodeLoadStatus = 'none'
      return
    }
    pitchShifterNodePitchFactor = pitchFactorParam
    pitchShifterNodeLoadStatus = 'unconnect'
    // [修复] 加载完成后如果当前值不是 1，立即连接并应用
    if (pitchShifterNodeTempValue !== 1) {
      connectPitchShifterNode()
    }
  }).catch((err) => {
    console.error('[SoundEffect] Failed to load pitch shifter worklet:', err)
    pitchShifterNodeLoadStatus = 'none'
  })
}

/** 设置变调（pitchFactor: 0.5 ~ 1.5）
 * 参考 lx-music-desktop：直接在 AudioParam 上平滑过渡，不重连节点
 * 使用较大的 timeConstant (0.05) 让 phase-vocoder 内部缓冲自然过渡，避免咔哒声
 */
export const setPitchShifter = (val: number) => {
  pitchShifterNodeTempValue = val
  switch (pitchShifterNodeLoadStatus) {
    case 'loading':
      // 加载中，值已暂存到 pitchShifterNodeTempValue，加载完成后会自动应用
      break
    case 'none':
      loadPitchShifterNode()
      break
    case 'connected':
      if (pitchShifterNodePitchFactor && audioContext) {
        // [修复] 使用 setTargetAtTime + 较大时间常数(0.05)，让 phase-vocoder 内部重叠缓冲平滑过渡
        // 0.01 太小会导致每次拖动滑块时产生离散跳变；0.05 约等于 2~3 帧的过渡
        pitchShifterNodePitchFactor.setTargetAtTime(val, audioContext.currentTime, 0.05)
      }
      break
    case 'unconnect':
      connectPitchShifterNode()
      break
  }
}

// ===== 倍速播放控制 =====

// 记录当前倍速和音调补偿状态，切歌时恢复到新 audio 元素
let currentPlaybackRate = 1
let currentPreservesPitch = true
// [修复] rAF 防抖：拖动滑块时频繁设置 playbackRate 会引发缓冲区重算导致卡顿
let playbackRateRafId: number | null = null
let pendingPlaybackRate: number | null = null

/** 设置播放速率（参考 lx-music-desktop 实现，增加 rAF 防抖） */
export const setPlaybackRate = (rate: number) => {
  currentPlaybackRate = rate
  pendingPlaybackRate = rate
  if (playbackRateRafId !== null) return
  // 用 requestAnimationFrame 合并同一帧内的多次调用
  playbackRateRafId = requestAnimationFrame(() => {
    playbackRateRafId = null
    if (pendingPlaybackRate === null || !currentAudioElement) return
    const r = pendingPlaybackRate
    currentAudioElement.defaultPlaybackRate = r
    currentAudioElement.playbackRate = r
  })
}

/** 设置音调补偿（参考 lx-music-desktop 实现） */
export const setPreservesPitch = (preservesPitch: boolean) => {
  currentPreservesPitch = preservesPitch
  if (!currentAudioElement) return
  currentAudioElement.preservesPitch = preservesPitch
}

/** 检查高级音频功能是否已初始化 */
export const hasInitedAdvancedAudioFeatures = (): boolean => audioContext !== null

// ===== 8D 环绕声控制 =====
// 8D 音效通过 HRTF PannerNode 让声源在水平面绕听众头部旋转，需佩戴耳机

/** 启动 8D 环绕声 */
export const startPanner8D = () => {
  initAdvancedAudioFeatures()
  if (!panner8D || !panner || !convolverDynamicsCompressor) return

  // 将 8D panner 插入链路: prePanner -> panner8D -> panner
  const prePanner = getPrePannerNode()
  try { prePanner.disconnect() } catch {}
  prePanner.connect(panner8D)
  panner8D.connect(panner)

  panner8DInfo.enabled = true
  panner8DInfo.rad = 0

  if (panner8DInfo.intv) clearInterval(panner8DInfo.intv)
  // [CPU优化] 根据设备性能动态调整定时器间隔，减少 HRTF 卷积频率
  const intervalMs = getSpatialIntervalMs()
  const radPerMs = (2 * Math.PI) / (panner8DInfo.speed * 1000)
  panner8DInfo.intv = setInterval(() => {
    if (!panner8D || !audioContext) return
    panner8DInfo.rad += radPerMs * intervalMs
    // 在水平面（X-Z 平面）做圆周运动
    const x = Math.cos(panner8DInfo.rad) * panner8DInfo.radius
    const z = Math.sin(panner8DInfo.rad) * panner8DInfo.radius
    const t = audioContext.currentTime
    // [修复] 使用 setTargetAtTime 替代直接 .value 赋值
    // HRTF PannerNode 每次位置变化都需要重新卷积 HRTF 脉冲响应，
    // 直接赋值 .value 会在相邻位置间产生离散跳变，导致 zipper noise（电流声/咔哒声）。
    // setTargetAtTime 让参数平滑过渡，SMOOTH_TC=0.033 约等于 1 帧的过渡时间。
    panner8D.positionX.setTargetAtTime(x, t, SMOOTH_TC)
    panner8D.positionY.setTargetAtTime(0, t, SMOOTH_TC)
    panner8D.positionZ.setTargetAtTime(z, t, SMOOTH_TC)
  }, intervalMs)
}

/** 停止 8D 环绕声 */
export const stopPanner8D = () => {
  if (!panner8DInfo.enabled) return
  panner8DInfo.enabled = false
  if (panner8DInfo.intv) {
    clearInterval(panner8DInfo.intv)
    panner8DInfo.intv = null
  }
  panner8DInfo.rad = 0
  if (panner8D) {
    // 从链路中移除 8D panner: prePanner -> panner 直接连接
    const prePanner = getPrePannerNode()
    try { panner8D.disconnect() } catch {}
    try { prePanner.disconnect() } catch {}
    try { prePanner.connect(panner!) } catch {}
    panner8D.positionX.value = 0
    panner8D.positionY.value = 0
    panner8D.positionZ.value = 0
  }
}

/** 设置 8D 旋转速度（秒/圈） */
export const setPanner8DSpeed = (secondsPerRound: number) => {
  panner8DInfo.speed = secondsPerRound
  // 如果正在运行，重启以应用新速度
  if (panner8DInfo.intv) startPanner8D()
}

/** 设置 8D 虚拟声源距离 */
export const setPanner8DRadius = (radius: number) => {
  panner8DInfo.radius = radius
}

// ===== 平滑位置更新工具函数 =====
// MDN 推荐: 使用 setTargetAtTime 代替直接赋值 .value，避免音频咔哒声/爆音
// timeConstant=0.033 约等于 1 帧的平滑过渡（30ms 内达到 95%）
const SMOOTH_TC = 0.033
// ===== 36D环绕声控制 =====
// 在原 8D 水平圆周旋转基础上叠加三层动态:
//  1. 垂直摆动: y = sin(rad*2) * radius * 0.3 — 上下摆动增加立体感
//  2. 距离波动: r' = radius * (1 + 0.3*sin(rad*0.5)) — 远近呼吸感
//  3. 空气低通: filterFreq 随当前距离动态衰减 — 模拟空气中高频吸收
// 链路: prePanner → filter36D(空气低通) → panner36D(HRTF空间) → panner

/** 启动 36D环绕声 */
export const startPanner36D = () => {
  initAdvancedAudioFeatures()
  if (!panner36D || !filter36D || !panner || !convolverDynamicsCompressor) return

  // 构建链路: prePanner → filter36D → panner36D → panner
  const prePanner = getPrePannerNode()
  try { prePanner.disconnect() } catch {}
  prePanner.connect(filter36D)
  filter36D.connect(panner36D)
  panner36D.connect(panner)

  panner36DInfo.enabled = true
  panner36DInfo.rad = 0

  if (panner36DInfo.intv) clearInterval(panner36DInfo.intv)
  // [CPU优化] 根据设备性能动态调整定时器间隔
  const intervalMs = getSpatialIntervalMs()
  const radPerMs = (2 * Math.PI) / (panner36DInfo.speed * 1000)
  panner36DInfo.intv = setInterval(() => {
    if (!panner36D || !filter36D || !audioContext) return
    panner36DInfo.rad += radPerMs * intervalMs
    const rad = panner36DInfo.rad
    const baseR = panner36DInfo.radius
    const t = audioContext.currentTime

    // [36D差异化] 三层动态叠加，确保与原 8D 有明显听感差异:
    // 1. 距离波动 ±60%: r' 在 0.4~1.6 倍 baseR 间呼吸
    //    配合 HRTF distanceModel='inverse' 衰减,音量在 2.5x~0.625x 波动,远近感明显
    // [修复防御] 半径下限保护：避免 r'<=0 导致 HRTF 距离模型退化
    const r = Math.max(0.3, baseR * (1 + 0.6 * Math.sin(rad * 0.5)))
    // 2. 水平旋转 (X-Z 平面)
    const x = Math.cos(rad) * r
    const z = Math.sin(rad) * r
    // 3. 垂直摆动 (Y 轴): 幅度为基础半径的 100%,频率用 sin(rad*1.5) 错开水平旋转
    //    产生立体螺旋而非平面圆,且 HRTF 频谱线索更明显
    const y = Math.sin(rad * 1.5) * baseR
    // 4. 空气低通: 距离越远高频越衰减 (20000Hz → 2500Hz,远闷近亮对比明显)
    const dist = Math.sqrt(x * x + y * y + z * z)
    const distRatio = Math.min(1, dist / (baseR * 1.8 + 0.01))
    const freq = 20000 - distRatio * 17500

    panner36D.positionX.setTargetAtTime(x, t, SMOOTH_TC)
    panner36D.positionY.setTargetAtTime(y, t, SMOOTH_TC)
    panner36D.positionZ.setTargetAtTime(z, t, SMOOTH_TC)
    filter36D.frequency.setTargetAtTime(freq, t, SMOOTH_TC)
  }, intervalMs)
}

/** 停止 36D环绕声 */
export const stopPanner36D = () => {
  if (!panner36DInfo.enabled) return
  panner36DInfo.enabled = false
  if (panner36DInfo.intv) {
    clearInterval(panner36DInfo.intv)
    panner36DInfo.intv = null
  }
  panner36DInfo.rad = 0
  const t = audioContext?.currentTime ?? 0
  if (panner36D) {
    panner36D.positionX.setTargetAtTime(0, t, SMOOTH_TC)
    panner36D.positionY.setTargetAtTime(0, t, SMOOTH_TC)
    panner36D.positionZ.setTargetAtTime(0, t, SMOOTH_TC)
  }
  if (filter36D) {
    // 恢复全通状态，避免下次启用前残留染色
    filter36D.frequency.setTargetAtTime(20000, t, SMOOTH_TC)
  }
  // 断开链路
  try { filter36D?.disconnect() } catch {}
  try { panner36D?.disconnect() } catch {}
  const prePanner = getPrePannerNode()
  try { prePanner.disconnect() } catch {}
  try { prePanner.connect(panner!) } catch {}
}

/** 设置 36D旋转速度（秒/圈） */
export const setPanner36DSpeed = (secondsPerRound: number) => {
  panner36DInfo.speed = secondsPerRound
  if (panner36DInfo.intv) startPanner36D()
}

/** 设置 36D虚拟声源距离 */
export const setPanner36DRadius = (radius: number) => {
  panner36DInfo.radius = radius
}

// ===== 7.1/5.1 虚拟多声道环绕控制 =====
// 将双声道立体声模拟成多声道影院声场
// 使用 ChannelSplitterNode 分离 L/R，分别路由到对应虚拟扬声器位置
// 中置声道取 L+R 混合，LFE 低音炮取 L+R 低通滤波

/** 启动虚拟多声道环绕 */
export const startVirtualSurround = () => {
  initAdvancedAudioFeatures()
  if (!audioContext || !convolverDynamicsCompressor || !panner) return

  const positions = virtualSurroundInfo.mode === '7.1' ? speakerPositions71 : speakerPositions51
  const numSpeakers = positions.length
  const spread = virtualSurroundInfo.spread

  // 创建输入 GainNode 和 ChannelSplitterNode 分离立体声
  virtualSurroundInput = audioContext.createGain()
  const splitter = audioContext.createChannelSplitter(2)
  virtualSurroundInput.connect(splitter)

  // 创建 ChannelMergerNode 将所有虚拟扬声器输出合并为立体声
  virtualSurroundMerger = audioContext.createChannelMerger(2)

  virtualSurroundPanners = []
  virtualSurroundGains = []

  // 为每个虚拟扬声器创建 HRTF PannerNode + GainNode
  for (let i = 0; i < numSpeakers; i++) {
    const p = audioContext.createPanner()
    p.panningModel = 'HRTF'
    p.distanceModel = 'inverse'
    p.refDistance = 1
    p.maxDistance = 10000
    p.rolloffFactor = 0.5
    p.coneInnerAngle = 360
    p.coneOuterAngle = 0
    p.coneOuterGain = 0
    p.positionX.value = positions[i].x * spread
    p.positionY.value = positions[i].y
    p.positionZ.value = positions[i].z * spread

    const g = audioContext.createGain()
    // 前置声道增益较高，后置/侧环稍低
    const isFront = positions[i].z < 0
    g.gain.value = isFront ? 0.35 : 0.2

    p.connect(g)
    g.connect(virtualSurroundMerger, 0, 0)
    g.connect(virtualSurroundMerger, 0, 1)

    virtualSurroundPanners.push(p)
    virtualSurroundGains.push(g)
  }

  // 路由: L 声道 -> 前左/后左/侧左 Panner, R 声道 -> 前右/后右/侧右 Panner
  // 中置声道: L+R 混合
  const centerIdx = positions.findIndex(pos => pos.x === 0 && pos.z === -1)
  if (centerIdx >= 0) {
    splitter.connect(virtualSurroundPanners[centerIdx], 0)
    splitter.connect(virtualSurroundPanners[centerIdx], 1)
  }
  // 左侧扬声器（x < 0）接收 L 声道
  for (let i = 0; i < numSpeakers; i++) {
    if (i === centerIdx) continue
    if (positions[i].x < 0) {
      splitter.connect(virtualSurroundPanners[i], 0)
    } else {
      splitter.connect(virtualSurroundPanners[i], 1)
    }
  }

  // LFE 低音炮: L+R 混合后低通滤波（120Hz 以下）
  virtualSurroundLFE = audioContext.createBiquadFilter()
  virtualSurroundLFE.type = 'lowpass'
  virtualSurroundLFE.frequency.value = 120
  virtualSurroundLFE.Q.value = 0.7
  virtualSurroundLFEGain = audioContext.createGain()
  virtualSurroundLFEGain.gain.value = 0.6
  splitter.connect(virtualSurroundLFE, 0)
  splitter.connect(virtualSurroundLFE, 1)
  virtualSurroundLFE.connect(virtualSurroundLFEGain)
  virtualSurroundLFEGain.connect(virtualSurroundMerger, 0, 0)
  virtualSurroundLFEGain.connect(virtualSurroundMerger, 0, 1)

  // 插入链路: prePanner -> input -> splitter -> [panners] -> merger -> panner
  const prePanner = getPrePannerNode()
  try { prePanner.disconnect() } catch {}
  prePanner.connect(virtualSurroundInput)
  virtualSurroundMerger.connect(panner)

  virtualSurroundInfo.enabled = true
}

/** 停止虚拟多声道环绕 */
export const stopVirtualSurround = () => {
  if (!virtualSurroundInfo.enabled) return
  virtualSurroundInfo.enabled = false

  try { virtualSurroundInput?.disconnect() } catch {}
  try { virtualSurroundMerger?.disconnect() } catch {}
  for (const p of virtualSurroundPanners) { try { p.disconnect() } catch {} }
  for (const g of virtualSurroundGains) { try { g.disconnect() } catch {} }
  try { virtualSurroundLFE?.disconnect() } catch {}
  try { virtualSurroundLFEGain?.disconnect() } catch {}

  virtualSurroundPanners = []
  virtualSurroundGains = []
  virtualSurroundMerger = null
  virtualSurroundLFE = null
  virtualSurroundLFEGain = null
  virtualSurroundInput = null

  // 恢复链路: prePanner -> panner
  const prePanner = getPrePannerNode()
  try { prePanner.disconnect() } catch {}
  try { prePanner.connect(panner!) } catch {}
}

/** 设置虚拟多声道模式（5.1 / 7.1） */
export const setVirtualSurroundMode = (mode: '5.1' | '7.1') => {
  virtualSurroundInfo.mode = mode
  if (virtualSurroundInfo.enabled) {
    stopVirtualSurround()
    startVirtualSurround()
  }
}

/** 设置虚拟多声道声场宽度 */
export const setVirtualSurroundSpread = (spread: number) => {
  virtualSurroundInfo.spread = spread
  if (virtualSurroundInfo.enabled && virtualSurroundPanners.length > 0 && audioContext) {
    const positions = virtualSurroundInfo.mode === '7.1' ? speakerPositions71 : speakerPositions51
    const t = audioContext.currentTime
    // [修复电流声] 用 setTargetAtTime 替代直接 .value 赋值，避免 HRTF PannerNode 位置跳变产生 zipper noise
    for (let i = 0; i < virtualSurroundPanners.length; i++) {
      virtualSurroundPanners[i].positionX.setTargetAtTime(positions[i].x * spread, t, SMOOTH_TC)
      virtualSurroundPanners[i].positionZ.setTargetAtTime(positions[i].z * spread, t, SMOOTH_TC)
    }
  }
}

// ===== 算法混响控制 =====

/** 设置算法混响（生成 IR 并应用到现有 ConvolverNode） */
export const setAlgorithmicReverb = async (presetLabel: string | null) => {
  initAdvancedAudioFeatures()
  if (!convolver || !convolverSourceGainNode || !convolverOutputGainNode) return

  if (presetLabel) {
    const preset = _algorithmicReverbs.find(p => p.label === presetLabel)
    if (!preset) return
    try {
      const ctx = getAudioContext()
      convolver.buffer = _generateReverbIR(ctx, preset)
      // [修复电流声] 用 setTargetAtTime 替代直接 .value 赋值
      const t = ctx.currentTime
      convolverDynamicsCompressor!.threshold.setTargetAtTime(-12, t, 0.05)
      convolverDynamicsCompressor!.ratio.setTargetAtTime(3, t, 0.05)
      convolverSourceGainNode.gain.setTargetAtTime(1, t, 0.05)
      convolverOutputGainNode.gain.setTargetAtTime(2.0, t, 0.05)
    } catch (err) {
      console.error('[SoundEffect] Failed to generate reverb IR:', err)
    }
  } else {
    convolver.buffer = null
    const t = audioContext!.currentTime
    convolverDynamicsCompressor!.threshold.setTargetAtTime(0, t, 0.05)
    convolverDynamicsCompressor!.ratio.setTargetAtTime(1, t, 0.05)
    convolverSourceGainNode.gain.setTargetAtTime(1, t, 0.05)
    convolverOutputGainNode.gain.setTargetAtTime(0, t, 0.05)
  }
}

// ===== 高级效果架控制导出 =====

/** 获取效果架实例（确保已初始化） */
export const getEffectsRack = (): EffectsRack | null => {
  initAdvancedAudioFeatures()
  ensureEffectsRack()
  return effectsRack
}

/** 消人声 */
export const setVocalRemoval = (enabled: boolean) => {
  initAdvancedAudioFeatures()
  if (enabled) ensureEffectsRack()
  effectsRack?.setVocalRemoval(enabled)
}

/** 颤音 */
export const setVibrato = (enabled: boolean, rate: number, depth: number) => {
  initAdvancedAudioFeatures()
  if (enabled) ensureEffectsRack()
  effectsRack?.setVibrato(enabled, rate, depth)
}

/** 动态音调漂移 */
export const setPitchDrift = (enabled: boolean, speed: number, range: number) => {
  initAdvancedAudioFeatures()
  if (enabled) ensureEffectsRack()
  effectsRack?.setPitchDrift(enabled, speed, range)
}

/** 抖音效果器 (Tremolo) */
export const setTremolo = (enabled: boolean, rate: number, depth: number) => {
  initAdvancedAudioFeatures()
  if (enabled) ensureEffectsRack()
  effectsRack?.setTremolo(enabled, rate, depth)
}

/** Bass 重低音增强 */
export const setBassBoost = (enabled: boolean, gain: number, dynamic: boolean) => {
  initAdvancedAudioFeatures()
  if (enabled) ensureEffectsRack()
  effectsRack?.setBassBoost(enabled, gain, dynamic)
}

/** 动态均衡 */
export const setDynamicEq = (enabled: boolean) => {
  initAdvancedAudioFeatures()
  if (enabled) ensureEffectsRack()
  effectsRack?.setDynamicEq(enabled)
}

/** 失真 */
export const setDistortion = (enabled: boolean, amount: number, type: 'soft' | 'hard') => {
  initAdvancedAudioFeatures()
  if (enabled) ensureEffectsRack()
  effectsRack?.setDistortion(enabled, amount, type)
}

/** 镶边效果 (Flanger) */
export const setFlanger = (enabled: boolean, rate: number, depth: number, feedback: number, mix: number) => {
  initAdvancedAudioFeatures()
  if (enabled) ensureEffectsRack()
  effectsRack?.setFlanger(enabled, rate, depth, feedback, mix)
}

/** 相位效果 (Phaser) */
export const setPhaser = (enabled: boolean, rate: number, depth: number, feedback: number, mix: number) => {
  initAdvancedAudioFeatures()
  if (enabled) ensureEffectsRack()
  effectsRack?.setPhaser(enabled, rate, depth, feedback, mix)
}

/** 延迟回声 */
export const setDelayEffect = (enabled: boolean, time: number, feedback: number, mix: number, type: 'single' | 'pingpong') => {
  initAdvancedAudioFeatures()
  if (enabled) ensureEffectsRack()
  effectsRack?.setDelay(enabled, time, feedback, mix, type)
}

/** 压缩器 */
export const setCompressor = (enabled: boolean, threshold: number, ratio: number, attack: number, release: number) => {
  initAdvancedAudioFeatures()
  if (enabled) ensureEffectsRack()
  effectsRack?.setCompressor(enabled, threshold, ratio, attack, release)
}

/** Crossfeed 耳机互馈 */
export const setCrossfeed = (enabled: boolean, strength: number) => {
  initAdvancedAudioFeatures()
  if (enabled) ensureEffectsRack()
  effectsRack?.setCrossfeed(enabled, strength)
}

/** 立体声拓宽 */
export const setStereoWiden = (enabled: boolean, amount: number) => {
  initAdvancedAudioFeatures()
  if (enabled) ensureEffectsRack()
  effectsRack?.setStereoWiden(enabled, amount)
}

/** 单声道合并 */
export const setMonoMerge = (enabled: boolean) => {
  initAdvancedAudioFeatures()
  if (enabled) ensureEffectsRack()
  effectsRack?.setMonoMerge(enabled)
}

/** 左右声道交换 */
export const setChannelSwap = (enabled: boolean) => {
  initAdvancedAudioFeatures()
  if (enabled) ensureEffectsRack()
  effectsRack?.setChannelSwap(enabled)
}

/** V4A 组合音效 */
export const setV4A = (enabled: boolean) => {
  initAdvancedAudioFeatures()
  if (enabled) ensureEffectsRack()
  effectsRack?.setV4A(enabled)
}

/** 重置所有高级效果 */
export const resetAllAdvancedEffects = () => {
  effectsRack?.resetAll()
}

// ===== 新增音效导出 =====

/** 多段压缩器 */
export const setMultibandCompressor = (enabled: boolean, lowFreq: number, midFreq: number, threshold: number, ratio: number) => {
  initAdvancedAudioFeatures()
  if (enabled) ensureEffectsRack()
  effectsRack?.setMultibandCompressor(enabled, lowFreq, midFreq, threshold, ratio)
}

/** 限制器 */
export const setLimiter = (enabled: boolean, threshold: number) => {
  initAdvancedAudioFeatures()
  if (enabled) ensureEffectsRack()
  effectsRack?.setLimiter(enabled, threshold)
}

/** 噪声门 */
export const setNoiseGate = (enabled: boolean, threshold: number, attack: number, release: number) => {
  initAdvancedAudioFeatures()
  if (enabled) ensureEffectsRack()
  effectsRack?.setNoiseGate(enabled, threshold, attack, release)
}

/** 扩展器 */
export const setExpander = (enabled: boolean, threshold: number, ratio: number) => {
  initAdvancedAudioFeatures()
  if (enabled) ensureEffectsRack()
  effectsRack?.setExpander(enabled, threshold, ratio)
}

/** 谐波激励器 */
export const setExciter = (enabled: boolean, amount: number, frequency: number) => {
  initAdvancedAudioFeatures()
  if (enabled) ensureEffectsRack()
  effectsRack?.setExciter(enabled, amount, frequency)
}

/** 次谐波低音增强 */
export const setSubBass = (enabled: boolean, amount: number, frequency: number) => {
  initAdvancedAudioFeatures()
  if (enabled) ensureEffectsRack()
  effectsRack?.setSubBass(enabled, amount, frequency)
}

/** 去齿音 */
export const setDeEsser = (enabled: boolean, threshold: number, frequency: number) => {
  initAdvancedAudioFeatures()
  if (enabled) ensureEffectsRack()
  effectsRack?.setDeEsser(enabled, threshold, frequency)
}

/** 自动增益控制 */
export const setAGC = (enabled: boolean, targetLevel: number) => {
  initAdvancedAudioFeatures()
  if (enabled) ensureEffectsRack()
  effectsRack?.setAGC(enabled, targetLevel)
}

/** Lo-Fi 低保真 */
export const setLoFi = (enabled: boolean, sampleRate: number, bitDepth: number, noise: number) => {
  initAdvancedAudioFeatures()
  if (enabled) ensureEffectsRack()
  effectsRack?.setLoFi(enabled, sampleRate, bitDepth, noise)
}

/** 比特粉碎 */
export const setBitcrush = (enabled: boolean, bits: number) => {
  initAdvancedAudioFeatures()
  if (enabled) ensureEffectsRack()
  effectsRack?.setBitcrush(enabled, bits)
}

/** 立体声分离度调节 */
export const setStereoSeparation = (enabled: boolean, width: number, centerLevel: number) => {
  initAdvancedAudioFeatures()
  if (enabled) ensureEffectsRack()
  effectsRack?.setStereoSeparation(enabled, width, centerLevel)
}

/** AB 对比旁通 */
export const setBypass = (bypassed: boolean) => {
  initAdvancedAudioFeatures()
  effectsRack?.setBypass(bypassed)
}

// ===== 音频性能级别 =====
// 保留 0-100 滑块 UI 控制，但不再通过 Worker/内存占用拉高 CPU（那会抢占音频线程导致更严重的爆音）
// 滑块现在仅影响空间音效更新频率和 AnalyserNode 精度

let audioBoostLevel = 60 // 默认 60%

/** 获取性能增强级别 (0-100) */
export const getAudioBoostLevel = () => audioBoostLevel

/** 根据 0-100 级别获取对应的空间音效定时器间隔 (ms) */
const boostToSpatialInterval = (level: number): number => {
  if (level <= 0) return SPATIAL_INTERVAL_MS
  const minInterval = 16
  const ratio = level / 100
  return Math.round(SPATIAL_INTERVAL_MS + (minInterval - SPATIAL_INTERVAL_MS) * ratio)
}

/**
 * 设置音频性能级别 (0-100)
 * 仅影响空间音效更新频率和 AnalyserNode 精度
 */
export const setAudioBoost = (level: number) => {
  audioBoostLevel = Math.max(0, Math.min(100, Math.round(level)))

  // 更新 AnalyserNode FFT 分辨率
  if (analyser) {
    analyser.fftSize = audioBoostLevel <= 0 ? 128 : audioBoostLevel <= 50 ? 256 : 512
    analyser.smoothingTimeConstant = 0.8 - (audioBoostLevel / 100) * 0.2
  }

  // 更新空间音效定时器频率（如果正在运行则重启）
  if (panner8DInfo.intv) {
    startPanner8D()
  }
  if (panner36DInfo.intv) {
    startPanner36D()
  }
}

/** 获取当前空间音效定时器间隔（受性能级别影响） */
export const getSpatialIntervalMs = () => {
  return boostToSpatialInterval(audioBoostLevel)
}

// ===== 录音控制 =====

/** 获取录音用的 MediaStream（包含所有音效处理后的音频） */
export const getRecordingStream = (): MediaStream | null => {
  initAdvancedAudioFeatures()
  return mediaStreamDestination?.stream ?? null
}

/** 检查录音功能是否可用 */
export const hasRecordingSupport = (): boolean => {
  initAdvancedAudioFeatures()
  return mediaStreamDestination !== null
}

/**
 * 使用 ScriptProcessor 捕获原始 PCM 数据用于 WAV 编码
 * 返回一个包含 start/stop 方法的控制器
 */
export const createWavRecorder = () => {
  initAdvancedAudioFeatures()
  if (!audioContext || !gainNode) return null

  const sampleRate = audioContext.sampleRate
  const bufferSize = 16384 // [修复电流声] 增大缓冲区，减少 underrun 导致的爆音
  const channels = 2

  const processor = audioContext.createScriptProcessor(bufferSize, channels, channels)

  // 分别收集 L/R 声道数据用于 WAV 编码
  const leftChannelData: Float32Array[] = []
  const rightChannelData: Float32Array[] = []

  processor.onaudioprocess = (e) => {
    leftChannelData.push(new Float32Array(e.inputBuffer.getChannelData(0)))
    if (channels > 1) {
      rightChannelData.push(new Float32Array(e.inputBuffer.getChannelData(1)))
    }
  }

  gainNode.connect(processor)
  // ScriptProcessor 需要连接到 destination 才能工作，但会产生静音输出
  // 使用零增益节点避免重复播放
  const silentGain = audioContext.createGain()
  silentGain.gain.value = 0
  processor.connect(silentGain)
  silentGain.connect(audioContext.destination)

  let isRecording = true

  const stop = (): ArrayBuffer => {
    isRecording = false
    try { processor.disconnect() } catch {}
    try { silentGain.disconnect() } catch {}

    // 合并所有 chunks
    const totalLength = leftChannelData.reduce((sum, chunk) => sum + chunk.length, 0)
    const leftFlat = new Float32Array(totalLength)
    const rightFlat = new Float32Array(totalLength)
    let offset = 0
    for (let i = 0; i < leftChannelData.length; i++) {
      leftFlat.set(leftChannelData[i], offset)
      if (rightChannelData[i]) {
        rightFlat.set(rightChannelData[i], offset)
      }
      offset += leftChannelData[i].length
    }

    // 编码为 WAV
    return encodeWav(leftFlat, rightFlat, sampleRate)
  }

  const getIsRecording = () => isRecording

  return { stop, getIsRecording }
}

/** 将 Float32Array PCM 数据编码为 WAV ArrayBuffer */
const encodeWav = (left: Float32Array, right: Float32Array, sampleRate: number): ArrayBuffer => {
  const numChannels = 2
  const bytesPerSample = 2 // 16-bit
  const blockAlign = numChannels * bytesPerSample
  const dataSize = left.length * blockAlign
  const bufferSize = 44 + dataSize

  const buffer = new ArrayBuffer(bufferSize)
  const view = new DataView(buffer)

  let offset = 0

  // WAV 文件头
  const writeString = (str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset++, str.charCodeAt(i))
    }
  }

  writeString('RIFF')
  view.setUint32(offset, 36 + dataSize, true); offset += 4
  writeString('WAVE')
  writeString('fmt ')
  view.setUint32(offset, 16, true); offset += 4
  view.setUint16(offset, 1, true); offset += 2 // PCM format
  view.setUint16(offset, numChannels, true); offset += 2
  view.setUint32(offset, sampleRate, true); offset += 4
  view.setUint32(offset, sampleRate * blockAlign, true); offset += 4 // byte rate
  view.setUint16(offset, blockAlign, true); offset += 2
  view.setUint16(offset, 16, true); offset += 2 // bits per sample
  writeString('data')
  view.setUint32(offset, dataSize, true); offset += 4

  // 交错写入 L/R 声道数据，转换为 16-bit PCM
  for (let i = 0; i < left.length; i++) {
    const l = Math.max(-1, Math.min(1, left[i]))
    const r = Math.max(-1, Math.min(1, right[i]))
    view.setInt16(offset, l < 0 ? l * 0x8000 : l * 0x7fff, true); offset += 2
    view.setInt16(offset, r < 0 ? r * 0x8000 : r * 0x7fff, true); offset += 2
  }

  return buffer
}

/** 将 Float32Array PCM 数据编码为 MP3 ArrayBuffer (使用 lamejs) */
const encodeMp3 = async (left: Float32Array, right: Float32Array, sampleRate: number, kbps = 192): Promise<ArrayBuffer> => {
  const lamejs = (await import('lamejs')).default || await import('lamejs')
  const Mp3Encoder = (lamejs as any).Mp3Encoder || (lamejs as any).default?.Mp3Encoder
  const encoder = new Mp3Encoder(2, sampleRate, kbps)

  // 转换为 Int16Array
  const leftI16 = new Int16Array(left.length)
  const rightI16 = new Int16Array(right.length)
  for (let i = 0; i < left.length; i++) {
    const l = Math.max(-1, Math.min(1, left[i]))
    const r = Math.max(-1, Math.min(1, right[i]))
    leftI16[i] = l < 0 ? l * 0x8000 : l * 0x7fff
    rightI16[i] = r < 0 ? r * 0x8000 : r * 0x7fff
  }

  const blockSize = 1152
  const chunks: Uint8Array[] = []

  for (let i = 0; i < left.length; i += blockSize) {
    const leftChunk = leftI16.subarray(i, i + blockSize)
    const rightChunk = rightI16.subarray(i, i + blockSize)
    const mp3buf = encoder.encodeBuffer(leftChunk, rightChunk)
    if (mp3buf.length > 0) {
      chunks.push(new Uint8Array(mp3buf))
    }
  }
  const end = encoder.flush()
  if (end.length > 0) {
    chunks.push(new Uint8Array(end))
  }

  // 合并所有 chunks
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)
  const result = new Uint8Array(totalLength)
  let offset2 = 0
  for (const c of chunks) {
    result.set(c, offset2)
    offset2 += c.length
  }

  return result.buffer
}

/**
 * 将 Float32Array PCM 数据编码为 FLAC ArrayBuffer
 * 使用 libflac.js 的 WASM 编码器
 * 如果无法加载 WASM，回退到 WAV 格式
 */
const encodeFlac = async (left: Float32Array, right: Float32Array, sampleRate: number): Promise<ArrayBuffer> => {
  // 尝试动态加载 libflac.js
  try {
    // 使用工厂函数加载 WASM 变体
    const createFlac = (await import('libflacjs')).default || await import('libflacjs')
    const Flac = typeof createFlac === 'function' ? createFlac('wasm') : createFlac

    // 等待库初始化完成
    if (!(Flac as any).isReady()) {
      await new Promise<void>((resolve) => {
        if ((Flac as any).isReady()) {
          resolve()
        } else {
          (Flac as any).onready = () => resolve()
        }
      })
    }

    const samples = left.length
    const totalSamples = samples * 2 // interleaved

    // 创建编码器: sampleRate, channels=2, bps=16, compression_level=5, total_samples
    const enc = (Flac as any).create_libflac_encoder(sampleRate, 2, 16, 5, samples)
    if (!enc) throw new Error('FLAC encoder creation failed')

    // 收集编码后的 FLAC 数据
    const flacData: Uint8Array[] = []

    // 初始化编码器流，设置写入回调
    const writeCallback = (data: Uint8Array, numberOfBytes: number) => {
      if (numberOfBytes > 0) {
        flacData.push(new Uint8Array(data.subarray(0, numberOfBytes)))
      }
    }
    const initStatus = (Flac as any).init_encoder_stream(enc, writeCallback)
    if (initStatus !== 0) {
      throw new Error(`FLAC encoder init failed with status: ${initStatus}`)
    }

    // 转换为交错 16-bit PCM
    const interleave = new Int16Array(totalSamples)
    for (let i = 0; i < samples; i++) {
      const l = Math.max(-1, Math.min(1, left[i]))
      const r = Math.max(-1, Math.min(1, right[i]))
      interleave[i * 2] = l < 0 ? l * 0x8000 : l * 0x7fff
      interleave[i * 2 + 1] = r < 0 ? r * 0x8000 : r * 0x7fff
    }

    // 编码交错 PCM 数据
    const success = (Flac as any).FLAC__stream_encoder_process_interleaved(enc, interleave, samples)
    if (!success) {
      throw new Error('FLAC encoding process failed')
    }

    // 完成编码
    ;(Flac as any).FLAC__stream_encoder_finish(enc)
    // 删除编码器释放资源
    ;(Flac as any).FLAC__stream_encoder_delete(enc)

    // 合并所有 FLAC 数据
    const totalLength = flacData.reduce((sum, c) => sum + c.length, 0)
    const result = new Uint8Array(totalLength)
    let offset2 = 0
    for (const c of flacData) {
      result.set(c, offset2)
      offset2 += c.length
    }
    return result.buffer
  } catch (err) {
    // 回退方案：无法加载 libflac.js，使用 WAV
    console.warn('[SoundEffect] FLAC encoding failed, falling back to WAV:', err)
    return encodeWav(left, right, sampleRate)
  }
}

/**
 * 创建 PCM 录音器，支持多种输出格式
 * 返回控制器，stop() 时根据 format 编码
 */
export const createPcmRecorder = (format: 'wav' | 'mp3' | 'flac' | 'webm', mp3Bitrate = 192) => {
  initAdvancedAudioFeatures()
  if (!audioContext || !gainNode) return null

  const sampleRate = audioContext.sampleRate
  const bufferSize = 16384 // [修复电流声] 增大缓冲区，减少 underrun 导致的爆音/电流声
  const channels = 2

  // WebM 模式使用 MediaRecorder
  let mediaRec: MediaRecorder | null = null
  let webmChunks: Blob[] = []
  const stream = mediaStreamDestination?.stream ?? null

  if (format === 'webm') {
    if (!stream) return null
    try {
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      mediaRec = new MediaRecorder(stream, { mimeType })
      mediaRec.ondataavailable = (e) => {
        if (e.data.size > 0) webmChunks.push(e.data)
      }
      mediaRec.start(100)
    } catch {
      return null
    }
  }

  // PCM 模式使用 ScriptProcessor
  const processor = audioContext.createScriptProcessor(bufferSize, channels, channels)
  const leftChannelData: Float32Array[] = []
  const rightChannelData: Float32Array[] = []

  if (format !== 'webm') {
    processor.onaudioprocess = (e) => {
      leftChannelData.push(new Float32Array(e.inputBuffer.getChannelData(0)))
      if (channels > 1) {
        rightChannelData.push(new Float32Array(e.inputBuffer.getChannelData(1)))
      }
    }
    gainNode.connect(processor)
    // [修复电流声] ScriptProcessor 需要连接到 destination 才能工作
    // 使用零增益节点避免重复播放，但确保 onaudioprocess 回调稳定触发
    const silentGain = audioContext.createGain()
    silentGain.gain.value = 0
    processor.connect(silentGain)
    silentGain.connect(audioContext.destination)
    // 保存引用以便 stop 时正确断开
    ;(processor as any)._silentGain = silentGain
  }

  let isRecording = true

  const stop = async (): Promise<ArrayBuffer> => {
    isRecording = false

    if (format === 'webm') {
      // 停止 MediaRecorder
      if (mediaRec && mediaRec.state !== 'inactive') {
        await new Promise<void>((resolve) => {
          mediaRec!.onstop = () => resolve()
          mediaRec!.stop()
        })
      }
      const blob = new Blob(webmChunks, { type: 'audio/webm' })
      webmChunks = []
      return blob.arrayBuffer()
    }

    // PCM 模式
    try { processor.disconnect() } catch {}
    // [修复电流声] 正确断开 silentGain，避免残留连接导致噪声
    try {
      const sg = (processor as any)._silentGain as GainNode | undefined
      if (sg) {
        sg.disconnect()
      }
    } catch {}

    // 合并所有 chunks
    const totalLength = leftChannelData.reduce((sum, chunk) => sum + chunk.length, 0)
    const leftFlat = new Float32Array(totalLength)
    const rightFlat = new Float32Array(totalLength)
    let offset = 0
    for (let i = 0; i < leftChannelData.length; i++) {
      leftFlat.set(leftChannelData[i], offset)
      if (rightChannelData[i]) {
        rightFlat.set(rightChannelData[i], offset)
      }
      offset += leftChannelData[i].length
    }

    // 根据格式编码
    switch (format) {
      case 'mp3':
        return encodeMp3(leftFlat, rightFlat, sampleRate, mp3Bitrate)
      case 'flac':
        return encodeFlac(leftFlat, rightFlat, sampleRate)
      case 'wav':
      default:
        return encodeWav(leftFlat, rightFlat, sampleRate)
    }
  }

  const pause = () => {
    if (mediaRec && mediaRec.state === 'recording') {
      mediaRec.pause()
    }
  }

  const resume = () => {
    if (mediaRec && mediaRec.state === 'paused') {
      mediaRec.resume()
    }
  }

  const getIsRecording = () => isRecording

  return { stop, pause, resume, getIsRecording }
}
