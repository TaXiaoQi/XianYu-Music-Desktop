/**
 * 离线导出模块 - 使用 OfflineAudioContext 在不播放的情况下处理音频并导出
 *
 * 核心流程：
 * 1. 获取音频文件 → decodeAudioData → AudioBuffer
 * 2. 创建 OfflineAudioContext
 * 3. 重建音效处理链：source → biquads(EQ) → [effectsRack] → convolver(reverb) → [spatial] → safetyLimiter → gain → destination
 * 4. 为空间音效 (8D/36D/3D) 预计算自动化曲线
 * 5. offlineCtx.startRendering() → rendered AudioBuffer
 * 6. 编码为 WAV / MP3 / FLAC
 */

import { freqs, convolutions } from './soundEffectEngine'
import { algorithmicReverbs, generateReverbIR } from './advancedEffects'
import { invoke } from '@tauri-apps/api/core'

// ===== 编码函数 =====

/** 将 AudioBuffer 编码为 WAV ArrayBuffer */
export function encodeWavFromBuffer(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const length = buffer.length
  const bytesPerSample = 2
  const blockAlign = numChannels * bytesPerSample
  const dataSize = length * blockAlign
  const totalSize = 44 + dataSize

  const arrayBuffer = new ArrayBuffer(totalSize)
  const view = new DataView(arrayBuffer)

  let offset = 0
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
  view.setUint16(offset, 1, true); offset += 2
  view.setUint16(offset, numChannels, true); offset += 2
  view.setUint32(offset, sampleRate, true); offset += 4
  view.setUint32(offset, sampleRate * blockAlign, true); offset += 4
  view.setUint16(offset, blockAlign, true); offset += 2
  view.setUint16(offset, 16, true); offset += 2
  writeString('data')
  view.setUint32(offset, dataSize, true); offset += 4

  // 获取各声道数据
  const channelData: Float32Array[] = []
  for (let ch = 0; ch < numChannels; ch++) {
    channelData.push(buffer.getChannelData(ch))
  }

  // 交错写入（带 TPDF 抖动，消除 float→int16 量化噪声）
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      // TPDF dither: 两个均匀分布随机数之差，消除量化失真
      const dither = (Math.random() - Math.random()) * (1 / 32768)
      const sample = Math.max(-1, Math.min(1, channelData[ch][i] + dither))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  }

  return arrayBuffer
}

/** 将 AudioBuffer 编码为 MP3 ArrayBuffer (使用 lamejs) */
export async function encodeMp3FromBuffer(buffer: AudioBuffer, kbps = 192): Promise<ArrayBuffer> {
  const lamejsModule = await import(/* @vite-ignore */ 'lamejs')
  const lamejs = (lamejsModule as any).default || lamejsModule
  const Mp3Encoder = (lamejs as any).Mp3Encoder || (lamejs as any).default?.Mp3Encoder
  const encoder = new Mp3Encoder(buffer.numberOfChannels, buffer.sampleRate, kbps)

  const left = buffer.getChannelData(0)
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left

  const leftI16 = new Int16Array(left.length)
  const rightI16 = new Int16Array(right.length)
  for (let i = 0; i < left.length; i++) {
    const l = Math.max(-1, Math.min(1, left[i]))
    const r = Math.max(-1, Math.min(1, right[i]))
    leftI16[i] = l < 0 ? l * 0x8000 : l * 0x7fff
    rightI16[i] = r < 0 ? r * 0x8000 : r * 0x7fff
  }

  const blockSize = 1152
  const dataChunks: Uint8Array[] = []
  for (let i = 0; i < left.length; i += blockSize) {
    const leftChunk = leftI16.subarray(i, i + blockSize)
    const rightChunk = rightI16.subarray(i, i + blockSize)
    const mp3buf = encoder.encodeBuffer(leftChunk, rightChunk)
    if (mp3buf.length > 0) dataChunks.push(new Uint8Array(mp3buf))
  }
  const endBuf = encoder.flush()
  if (endBuf.length > 0) dataChunks.push(new Uint8Array(endBuf))

  // 合并
  const totalLength = dataChunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const result = new Uint8Array(totalLength)
  let pos = 0
  for (const chunk of dataChunks) {
    result.set(chunk, pos)
    pos += chunk.length
  }
  return result.buffer
}

/** 将 AudioBuffer 编码为 FLAC ArrayBuffer (使用 libflacjs) */
export async function encodeFlacFromBuffer(buffer: AudioBuffer): Promise<ArrayBuffer> {
  try {
    const flacModule = await import('libflacjs')
    const Flac = (flacModule as any).default || flacModule

    const sampleRate = buffer.sampleRate
    const channels = buffer.numberOfChannels
    const length = buffer.length

    // 提取交错 PCM 数据
    const interleaved = new Int32Array(length * channels)
    for (let i = 0; i < length; i++) {
      for (let ch = 0; ch < channels; ch++) {
        const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]))
        interleaved[i * channels + ch] = sample < 0 ? sample * 0x80000000 : sample * 0x7fffffff
      }
    }

    const flacEncoder: any = (Flac as any).create_libflac_encoder(sampleRate, channels, 16, 0)
    if (!flacEncoder) throw new Error('Failed to create FLAC encoder')

    const flacData: Uint8Array[] = []
    const writeCallback = (dataBlock: Uint8Array, bytes: number) => {
      const data = new Uint8Array(dataBlock.subarray(0, bytes))
      flacData.push(data)
    }

    const initResult = (Flac as any).init_encoder_stream(flacEncoder, writeCallback)
    if (initResult !== 0) throw new Error('Failed to init FLAC stream')

    const state = (Flac as any).FLAC__stream_encoder_process_interleaved(flacEncoder, interleaved, length)
    if (!state) throw new Error('FLAC encoding failed')

    ;(Flac as any).FLAC__stream_encoder_finish(flacEncoder)
    ;(Flac as any).FLAC__stream_encoder_delete(flacEncoder)

    const totalLen = flacData.reduce((sum, chunk) => sum + chunk.length, 0)
    const result = new Uint8Array(totalLen)
    let pos = 0
    for (const chunk of flacData) {
      result.set(chunk, pos)
      pos += chunk.length
    }
    return result.buffer
  } catch (err) {
    console.warn('[OfflineExport] FLAC encoding failed, falling back to WAV:', err)
    return encodeWavFromBuffer(buffer)
  }
}

// ===== 离线渲染 =====

export interface OfflineExportOptions {
  /** 音频文件 URL */
  audioUrl: string
  /** 输出格式 */
  format: 'wav' | 'mp3' | 'flac'
  /** MP3 比特率 (仅 MP3 格式有效) */
  mp3Bitrate?: number
  /** 均衡器频段增益: { 31: 0, 62: 0, ... } */
  eqGains?: Record<number, number>
  /** 卷积混响 label (如 'church')，null 表示不启用 */
  convolutionLabel?: string | null
  /** 卷积混响干信号增益 */
  convMainGain?: number
  /** 卷积混响湿信号增益 */
  convSendGain?: number
  /** 算法混响 label，null 表示不启用 */
  algoReverbLabel?: string | null
  /** 8D 环绕声是否启用 */
  enable8D?: boolean
  /** 8D 旋转速度 (秒/圈) */
  rotationSpeed8D?: number
  /** 8D 虚拟距离 */
  virtualDistance8D?: number
  /** 36D环绕声是否启用 */
  enable36D?: boolean
  /** 36D旋转速度 (秒/圈) */
  rotationSpeed36D?: number
  /** 36D虚拟声源距离 */
  virtualDistance36D?: number
  /** 3D 环绕声是否启用 */
  enable3D?: boolean
  /** 3D 环绕强度 */
  surroundIntensity?: number
  /** 3D 声音距离 */
  soundDistance?: number
  /** 变速播放倍率 (0.5~2.0, 1=正常) */
  playbackRate?: number
  /** 进度回调 (0~1) */
  onProgress?: (progress: number) => void
}

/**
 * 离线渲染音频，应用所有音效，返回编码后的 ArrayBuffer
 */
export async function renderOfflineAudio(options: OfflineExportOptions): Promise<ArrayBuffer> {
  const {
    audioUrl,
    format,
    mp3Bitrate = 192,
    eqGains = {},
    convolutionLabel = null,
    convMainGain = 0,
    convSendGain = 0,
    algoReverbLabel = null,
    enable8D = false,
    rotationSpeed8D = 10,
    virtualDistance8D = 1,
    enable36D = false,
    rotationSpeed36D = 10,
    virtualDistance36D = 1,
    enable3D = false,
    surroundIntensity = 0.9,
    soundDistance = 0.9,
    playbackRate = 1,
    onProgress,
  } = options

  onProgress?.(0.05)

  // 1. 通过 Tauri 后端获取音频文件二进制数据（绕过 CORS）
  const audioBytes = await invoke<number[]>('fetch_audio_data', { url: audioUrl })
  const arrayBuffer = new Uint8Array(audioBytes).buffer

  // 使用临时 AudioContext 解码
  const tempCtx = new AudioContext()
  const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer)
  tempCtx.close()

  onProgress?.(0.15)

  const sampleRate = audioBuffer.sampleRate
  const originalDuration = audioBuffer.duration
  const channels = Math.min(2, audioBuffer.numberOfChannels)

  // 变速后的实际时长
  const effectiveRate = Math.max(0.5, Math.min(2, playbackRate))
  const renderDuration = originalDuration / effectiveRate

  // 2. 创建 OfflineAudioContext
  // 给混响尾音多留 3 秒
  const renderLength = Math.ceil((renderDuration + 3) * sampleRate)
  const offlineCtx = new OfflineAudioContext(channels, renderLength, sampleRate)

  // 3. 创建音频源
  const source = offlineCtx.createBufferSource()
  source.buffer = audioBuffer
  // [变速] 设置播放倍率（变速不变调，由 AudioBufferSourceNode 原生处理）
  source.playbackRate.value = effectiveRate

  // 3.5. 预淡入淡出增益节点 — 在所有处理之前应用
  // [修复咔嗒声核心] 压缩器/滤波器在 t=0 看到满幅信号时会产生瞬态失真，
  // 必须在信号进入 EQ/混响/压缩器/空间效果之前就做淡入，
  // 这样所有下游节点看到的是平滑渐变的信号，不会产生初始瞬态。
  const preFadeGain = offlineCtx.createGain()
  const preFadeInTime = 0.015   // 15ms 淡入
  const preFadeOutTime = 0.01   // 10ms 淡出（在源结束前）
  preFadeGain.gain.setValueAtTime(0, 0)
  preFadeGain.gain.linearRampToValueAtTime(1, preFadeInTime)
  preFadeGain.gain.setValueAtTime(1, Math.max(preFadeInTime, renderDuration - preFadeOutTime))
  preFadeGain.gain.linearRampToValueAtTime(0, renderDuration)

  // 4. 创建 10 段均衡器
  const biquads: BiquadFilterNode[] = []
  for (const freq of freqs) {
    const filter = offlineCtx.createBiquadFilter()
    filter.type = 'peaking'
    filter.frequency.value = freq
    filter.Q.value = 1.4
    filter.gain.value = eqGains[freq] || 0
    biquads.push(filter)
  }
  // 串联连接
  for (let i = 1; i < biquads.length; i++) {
    biquads[i - 1].connect(biquads[i])
  }

  // 5. 创建卷积混响
  const convSourceGain = offlineCtx.createGain()
  const convOutputGain = offlineCtx.createGain()
  const convCompressor = offlineCtx.createDynamicsCompressor()
  convCompressor.threshold.value = 0
  convCompressor.knee.value = 0
  convCompressor.ratio.value = 1
  convCompressor.attack.value = 0.003
  convCompressor.release.value = 0.25

  const convolver = offlineCtx.createConvolver()

  // 加载混响 IR
  let reverbLoaded = false
  if (convolutionLabel) {
    const conv = convolutions.find(c => c.label === convolutionLabel)
    if (conv) {
      try {
        const irResponse = await fetch(`/filters/${conv.source}`)
        const irBuffer = await irResponse.arrayBuffer()
        convolver.buffer = await offlineCtx.decodeAudioData(irBuffer)
        convSourceGain.gain.value = convMainGain
        convOutputGain.gain.value = convSendGain
        convCompressor.threshold.value = -12
        convCompressor.knee.value = 6
        convCompressor.ratio.value = 3
        reverbLoaded = true
      } catch (err) {
        console.warn('[OfflineExport] Failed to load convolution IR:', err)
      }
    }
  } else if (algoReverbLabel) {
    // 算法混响 - 生成 IR
    const algoReverb = algorithmicReverbs.find(r => r.label === algoReverbLabel)
    if (algoReverb) {
      try {
        convolver.buffer = generateReverbIR(offlineCtx as unknown as AudioContext, algoReverb)
        convSourceGain.gain.value = 1.0
        convOutputGain.gain.value = 2.0
        convCompressor.threshold.value = -12
        convCompressor.knee.value = 6
        convCompressor.ratio.value = 3
        reverbLoaded = true
      } catch (err) {
        console.warn('[OfflineExport] Failed to generate algorithmic reverb IR:', err)
      }
    }
  }

  if (!reverbLoaded) {
    convSourceGain.gain.value = 1
    convOutputGain.gain.value = 0
  }

  convolver.connect(convOutputGain)
  convSourceGain.connect(convCompressor)
  convOutputGain.connect(convCompressor)

  onProgress?.(0.3)

  // 6. 安全限制器
  // [修复咔嗒声] 使用更柔和的参数：软拐点 + 适中 ratio + 较慢 attack
  // 硬拐点(knee=0)和高 ratio(20:1)会在阈值附近产生突变，配合 preFadeGain 可完全消除瞬态
  const safetyLimiter = offlineCtx.createDynamicsCompressor()
  safetyLimiter.threshold.value = -1
  safetyLimiter.knee.value = 10
  safetyLimiter.ratio.value = 4
  safetyLimiter.attack.value = 0.005
  safetyLimiter.release.value = 0.25

  // 7. 输出增益节点（仅淡出，用于混响尾音的平滑结束）
  // 淡入已在 preFadeGain 完成，此处只需在渲染末尾淡出
  const gainNode = offlineCtx.createGain()
  const totalRenderDuration = renderDuration + 3 // 与 renderLength 对应
  const fadeOutTime = 0.05 // 50ms 淡出
  gainNode.gain.setValueAtTime(1, 0)
  gainNode.gain.setValueAtTime(1, Math.max(0, totalRenderDuration - fadeOutTime))
  gainNode.gain.linearRampToValueAtTime(0, totalRenderDuration)

  // 8. 连接基础链路: source → preFadeGain → biquads[0] → ... → biquads[last] → convSourceGain + convolver → convCompressor → safetyLimiter → gainNode → destination
  source.connect(preFadeGain)
  preFadeGain.connect(biquads[0])
  const lastBiquad = biquads[biquads.length - 1]
  lastBiquad.connect(convSourceGain)
  lastBiquad.connect(convolver)
  convCompressor.connect(safetyLimiter)

  // 9. 空间音效处理 (8D/36D/3D)
  let preGainNode: AudioNode = safetyLimiter

  if (enable8D) {
    // 8D 环绕声 - HRTF PannerNode + 旋转自动化
    const panner8D = offlineCtx.createPanner()
    panner8D.panningModel = 'HRTF'
    panner8D.distanceModel = 'inverse'
    panner8D.refDistance = 1
    panner8D.maxDistance = 10000
    panner8D.rolloffFactor = 1

    const radius = virtualDistance8D
    const speed = rotationSpeed8D // 秒/圈
    const angularSpeed = (2 * Math.PI) / speed // rad/s

    // [修复咔嗒声] 先用 setValueAtTime 初始化 t=0 位置，避免从默认 (0,0,0) 跳变
    const initAngle = 0
    panner8D.positionX.setValueAtTime(Math.cos(initAngle) * radius, 0)
    panner8D.positionZ.setValueAtTime(Math.sin(initAngle) * radius, 0)

    // [修复电流声] 使用 setValueCurveAtTime 预计算高密度旋转轨迹（每 10ms 一个点）
    const steps = Math.ceil(renderDuration * 100) // 每 10ms 一个点，足够平滑
    const positionX = new Float32Array(steps)
    const positionZ = new Float32Array(steps)
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * renderDuration
      const angle = angularSpeed * t
      positionX[i] = Math.cos(angle) * radius
      positionZ[i] = Math.sin(angle) * radius
    }

    try {
      panner8D.positionX.setValueCurveAtTime(positionX, 0, renderDuration)
      panner8D.positionZ.setValueCurveAtTime(positionZ, 0, renderDuration)
    } catch {
      // 降级：使用线性插值
      const numPoints = Math.ceil(renderDuration / 0.02)
      for (let i = 0; i <= numPoints; i++) {
        const t = (i / numPoints) * renderDuration
        const angle = angularSpeed * t
        panner8D.positionX.setValueAtTime(Math.cos(angle) * radius, t)
        panner8D.positionZ.setValueAtTime(Math.sin(angle) * radius, t)
        if (i < numPoints) {
          const nextT = ((i + 1) / numPoints) * renderDuration
          const nextAngle = angularSpeed * nextT
          panner8D.positionX.linearRampToValueAtTime(Math.cos(nextAngle) * radius, nextT)
          panner8D.positionZ.linearRampToValueAtTime(Math.sin(nextAngle) * radius, nextT)
        }
      }
    }

    preGainNode.connect(panner8D)
    preGainNode = panner8D
  } else if (enable36D) {
    // 36D环绕声 - HRTF PannerNode + 垂直摆动 + 距离波动 + 空气低通
    // 链路: preGainNode → filterReset(空气低通) → pannerReset(HRTF)
    const pannerReset = offlineCtx.createPanner()
    pannerReset.panningModel = 'HRTF'
    pannerReset.distanceModel = 'inverse'
    pannerReset.refDistance = 1
    pannerReset.maxDistance = 10000
    pannerReset.rolloffFactor = 1
    const filterReset = offlineCtx.createBiquadFilter()
    filterReset.type = 'lowpass'
    filterReset.Q.value = 0.5

    const baseR = virtualDistance36D
    const speed = rotationSpeed36D
    const angularSpeed = (2 * Math.PI) / speed

    // [修复咔嗒声] 初始化 t=0 的值，避免从默认 (0,0,0) 跳变
    const initAngle = 0
    const initR = Math.max(0.3, baseR * (1 + 0.6 * Math.sin(initAngle * 0.5)))
    const initX = Math.cos(initAngle) * initR
    const initZ = Math.sin(initAngle) * initR
    const initY = Math.sin(initAngle * 1.5) * baseR * 1.0
    const initDist = Math.sqrt(initX * initX + initY * initY + initZ * initZ)
    const initDistRatio = Math.min(1, initDist / (baseR * 1.8 + 0.01))
    pannerReset.positionX.setValueAtTime(initX, 0)
    pannerReset.positionY.setValueAtTime(initY, 0)
    pannerReset.positionZ.setValueAtTime(initZ, 0)
    filterReset.frequency.setValueAtTime(20000 - initDistRatio * 17500, 0)

    // [修复电流声] 使用 setValueCurveAtTime 预计算高密度轨迹（每 10ms 一个点）
    // [36D差异化] 三层动态叠加，参数与实时版 startPanner36D 完全一致
    const steps = Math.ceil(renderDuration * 100)
    const posX = new Float32Array(steps)
    const posY = new Float32Array(steps)
    const posZ = new Float32Array(steps)
    const freqCurve = new Float32Array(steps)
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * renderDuration
      const angle = angularSpeed * t
      // 1. 距离波动 ±60% (配合 HRTF inverse 衰减产生明显音量呼吸感)
      // [修复防御] 半径下限保护：避免 r'<=0 导致 HRTF 距离模型退化
      const r = Math.max(0.3, baseR * (1 + 0.6 * Math.sin(angle * 0.5)))
      const x = Math.cos(angle) * r
      const z = Math.sin(angle) * r
      // 2. 垂直摆动 (Y 轴 100% baseR,频率错开产生立体螺旋)
      const y = Math.sin(angle * 1.5) * baseR * 1.0
      // 3. 空气低通 (20000Hz → 2500Hz,远闷近亮)
      const dist = Math.sqrt(x * x + y * y + z * z)
      const distRatio = Math.min(1, dist / (baseR * 1.8 + 0.01))
      posX[i] = x
      posY[i] = y
      posZ[i] = z
      freqCurve[i] = 20000 - distRatio * 17500
    }

    try {
      pannerReset.positionX.setValueCurveAtTime(posX, 0, renderDuration)
      pannerReset.positionY.setValueCurveAtTime(posY, 0, renderDuration)
      pannerReset.positionZ.setValueCurveAtTime(posZ, 0, renderDuration)
      filterReset.frequency.setValueCurveAtTime(freqCurve, 0, renderDuration)
    } catch {
      // 降级：setValueAtTime + linearRampToValueAtTime
      const numPoints = Math.ceil(renderDuration / 0.02)
      for (let i = 0; i <= numPoints; i++) {
        const t = (i / numPoints) * renderDuration
        const angle = angularSpeed * t
        const r = Math.max(0.3, baseR * (1 + 0.6 * Math.sin(angle * 0.5)))
        const x = Math.cos(angle) * r
        const z = Math.sin(angle) * r
        const y = Math.sin(angle * 1.5) * baseR * 1.0
        const dist = Math.sqrt(x * x + y * y + z * z)
        const distRatio = Math.min(1, dist / (baseR * 1.8 + 0.01))
        pannerReset.positionX.setValueAtTime(x, t)
        pannerReset.positionY.setValueAtTime(y, t)
        pannerReset.positionZ.setValueAtTime(z, t)
        filterReset.frequency.setValueAtTime(20000 - distRatio * 17500, t)
        if (i < numPoints) {
          const nextT = ((i + 1) / numPoints) * renderDuration
          const nextAngle = angularSpeed * nextT
          const nextR = Math.max(0.3, baseR * (1 + 0.6 * Math.sin(nextAngle * 0.5)))
          const nextX = Math.cos(nextAngle) * nextR
          const nextZ = Math.sin(nextAngle) * nextR
          const nextY = Math.sin(nextAngle * 1.5) * baseR * 1.0
          const nextDist = Math.sqrt(nextX * nextX + nextY * nextY + nextZ * nextZ)
          const nextDistRatio = Math.min(1, nextDist / (baseR * 1.8 + 0.01))
          pannerReset.positionX.linearRampToValueAtTime(nextX, nextT)
          pannerReset.positionY.linearRampToValueAtTime(nextY, nextT)
          pannerReset.positionZ.linearRampToValueAtTime(nextZ, nextT)
          filterReset.frequency.linearRampToValueAtTime(20000 - nextDistRatio * 17500, nextT)
        }
      }
    }

    preGainNode.connect(filterReset)
    filterReset.connect(pannerReset)
    preGainNode = pannerReset
  } else if (enable3D) {
    // 3D 环绕声 - PannerNode 旋转
    const panner3D = offlineCtx.createPanner()
    panner3D.panningModel = 'HRTF'
    panner3D.distanceModel = 'inverse'

    const radius = soundDistance
    const speed = 2 * (surroundIntensity / 10)
    const angularSpeed = (2 * Math.PI) / speed

    // [修复咔嗒声] 初始化 t=0 位置
    panner3D.positionX.setValueAtTime(Math.cos(0) * radius, 0)
    panner3D.positionZ.setValueAtTime(Math.sin(0) * radius, 0)

    // [修复电流声] 使用 setValueCurveAtTime
    const steps3D = Math.ceil(renderDuration * 100)
    const posX3D = new Float32Array(steps3D)
    const posZ3D = new Float32Array(steps3D)
    for (let i = 0; i < steps3D; i++) {
      const t = (i / steps3D) * renderDuration
      const angle = angularSpeed * t
      posX3D[i] = Math.cos(angle) * radius
      posZ3D[i] = Math.sin(angle) * radius
    }

    try {
      panner3D.positionX.setValueCurveAtTime(posX3D, 0, renderDuration)
      panner3D.positionZ.setValueCurveAtTime(posZ3D, 0, renderDuration)
    } catch {
      const numPoints = Math.ceil(renderDuration / 0.02)
      for (let i = 0; i <= numPoints; i++) {
        const t = (i / numPoints) * renderDuration
        const angle = angularSpeed * t
        panner3D.positionX.setValueAtTime(Math.cos(angle) * radius, t)
        panner3D.positionZ.setValueAtTime(Math.sin(angle) * radius, t)
      }
    }

    preGainNode.connect(panner3D)
    preGainNode = panner3D
  }

  // 连接到 gain → destination
  preGainNode.connect(gainNode)
  gainNode.connect(offlineCtx.destination)

  onProgress?.(0.4)

  // 10. 离线渲染
  source.start(0)
  const renderedBuffer = await offlineCtx.startRendering()

  onProgress?.(0.7)

  // 11. 编码
  let result: ArrayBuffer
  switch (format) {
    case 'mp3':
      result = await encodeMp3FromBuffer(renderedBuffer, mp3Bitrate)
      break
    case 'flac':
      result = await encodeFlacFromBuffer(renderedBuffer)
      break
    case 'wav':
    default:
      result = encodeWavFromBuffer(renderedBuffer)
      break
  }

  onProgress?.(1.0)
  return result
}
