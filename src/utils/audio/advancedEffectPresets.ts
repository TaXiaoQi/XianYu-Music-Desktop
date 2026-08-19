// ==================== 新增均衡器预设 ====================

export const advancedEqPresets = [
  { name: '超重低音', hz31: 12, hz62: 10, hz125: 8, hz250: 4, hz500: 0, hz1000: 0, hz2000: 0, hz4000: 0, hz8000: 0, hz16000: 0 },
  { name: '清澈高音', hz31: 0, hz62: 0, hz125: 0, hz250: 0, hz500: 0, hz1000: 2, hz2000: 4, hz4000: 6, hz8000: 8, hz16000: 10 },
  { name: '监听平直', hz31: 0, hz62: 0, hz125: 0, hz250: 0, hz500: 0, hz1000: 0, hz2000: 0, hz4000: 0, hz8000: 0, hz16000: 0 },
  { name: '摇滚加厚', hz31: 8, hz62: 7, hz125: 5, hz250: 3, hz500: 1, hz1000: -1, hz2000: 2, hz4000: 3, hz8000: 5, hz16000: 6 },
  { name: '空灵女声', hz31: -3, hz62: -2, hz125: -1, hz250: 0, hz500: 2, hz1000: 5, hz2000: 7, hz4000: 8, hz8000: 9, hz16000: 10 },
  { name: '重金属', hz31: 10, hz62: 8, hz125: 6, hz250: 2, hz500: -1, hz1000: -2, hz2000: 3, hz4000: 5, hz8000: 7, hz16000: 9 },
  { name: '古典弦乐', hz31: 5, hz62: 4, hz125: 3, hz250: 2, hz500: 1, hz1000: 3, hz2000: 5, hz4000: 7, hz8000: 8, hz16000: 9 },
] as const

// ==================== 算法混响预设 ====================

export interface AlgorithmicReverbPreset {
  name: string
  label: string
  duration: number   // 混响尾音长度（秒）
  decay: number      // 衰减幂（越大衰减越快）
  type: 'hall' | 'room' | 'plate' | 'spring' | 'tunnel' | 'valley' | 'metal'
  preDelay: number   // 预延迟（秒）
  dry: number        // 干声百分比（0~100），作为增益条默认值
  wet: number        // 湿声百分比（0~100），作为增益条默认值
  description: string
}

export const algorithmicReverbs: AlgorithmicReverbPreset[] = [
  { name: '小房间', label: 'algoRoom',    duration: 1.0, decay: 3.0, type: 'room',   preDelay: 0.005, dry: 82, wet: 34, description: '短促紧实的密闭空间' },
  { name: '大厅',   label: 'algoHall',    duration: 4.5, decay: 1.5, type: 'hall',   preDelay: 0.03,  dry: 68, wet: 54, description: '尾音悠长、明亮开阔的音乐厅' },
  { name: '暖房',   label: 'algoChamber', duration: 2.5, decay: 2.0, type: 'room',   preDelay: 0.01,  dry: 76, wet: 42, description: '温暖偏暗的中型空间' },
  { name: '隧道',   label: 'algoTunnel',  duration: 5.5, decay: 1.2, type: 'tunnel', preDelay: 0.02,  dry: 72, wet: 48, description: '窄长通道的密集回声' },
  { name: '山谷',   label: 'algoValley',  duration: 6.0, decay: 1.0, type: 'valley', preDelay: 0.05,  dry: 62, wet: 58, description: '开阔山野的超长回声' },
]

// ==================== 算法混响 IR 生成器 ====================

/**
 * 生成算法混响脉冲响应（Impulse Response）
 * 不同类型产生不同特性的衰减噪声
 */
export function generateReverbIR(
  ctx: AudioContext,
  preset: AlgorithmicReverbPreset,
): AudioBuffer {
  const sampleRate = ctx.sampleRate
  const preDelaySamples = Math.floor(sampleRate * preset.preDelay)
  const tailSamples = Math.floor(sampleRate * preset.duration)
  const totalLength = preDelaySamples + tailSamples
  const ir = ctx.createBuffer(2, totalLength, sampleRate)

  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch)

    // 预延迟部分：静音
    for (let i = 0; i < preDelaySamples; i++) {
      data[i] = 0
    }

    // 混响尾音
    for (let i = 0; i < tailSamples; i++) {
      const t = i / tailSamples
      const decayEnvelope = Math.pow(1 - t, preset.decay)
      let sample: number

      switch (preset.type) {
        case 'hall': {
          // 巨型音乐厅: Schroeder 式混响
          // 1. 早期反射 — 模拟声音从不同距离的墙面反射回来
          //    时间点基于真实音乐厅尺寸: ~11ms(侧墙), ~19ms(天花板), ~29ms(后墙), ~37ms(楼座), ~47ms(远墙), ~61ms, ~73ms
          const earlyTaps = [
            { time: 0.011, gain: 0.65 },
            { time: 0.019, gain: 0.52 },
            { time: 0.029, gain: 0.45 },
            { time: 0.037, gain: 0.38 },
            { time: 0.047, gain: 0.32 },
            { time: 0.061, gain: 0.26 },
            { time: 0.073, gain: 0.20 },
          ]
          const timeSec = i / sampleRate
          let earlyReflection = 0
          for (const tap of earlyTaps) {
            // 每个反射点是一个短脉冲 + 轻微扩散
            const dist = Math.abs(timeSec - tap.time)
            if (dist < 0.003) {
              const window = 1 - dist / 0.003
              earlyReflection += (Math.random() * 2 - 1) * tap.gain * window * window
            }
          }

          // 2. 扩散尾音 — 多层噪声叠加，模拟密集反射
          //    使用两个不同频率的噪声源叠加，增加密度
          const noise1 = (Math.random() * 2 - 1) * 0.6
          const noise2 = Math.sin(i * 0.0023 + ch * 1.7) * 0.3  // 低频调制增加暖度
          // 双指数衰减: 前段快速建立，后段缓慢消散（大厅特征）
          const buildUp = 1 - Math.exp(-t * 8)      // 0→1 快速建立（前 0.3s）
          const fadeOut = Math.exp(-t * 1.2)         // 缓慢消散
          const tail = (noise1 + noise2) * decayEnvelope * buildUp * fadeOut * 0.5

          sample = earlyReflection + tail
          break
        }
        case 'room': {
          // 房间: 快速衰减的噪声，更紧凑
          sample = (Math.random() * 2 - 1) * decayEnvelope * Math.exp(-t * 1.5)
          break
        }
        case 'plate': {
          // 板式: 明亮密集的衰减，高频成分更多
          const bright = Math.sin(i * 0.05) * 0.3 + (Math.random() * 2 - 1) * 0.7
          sample = bright * decayEnvelope * Math.exp(-t * 1.2)
          break
        }
        case 'spring': {
          // 弹簧: 特征性的 "boing" 调制 + 噪声
          const spring = Math.sin(i * 0.08) * Math.exp(-t * 3) * 0.4
          const noise = (Math.random() * 2 - 1) * decayEnvelope * 0.3
          sample = spring + noise
          break
        }
        case 'tunnel': {
          // 隧道: 离散回声，声波在隧道两端来回反弹
          // 回声间隔 ~120ms（对应约 20m 隧道长度）
          // 每次反弹衰减 0.75
          const echoIntervalSec = 0.12
          const echoIntervalSamples = Math.floor(sampleRate * echoIntervalSec)
          const bounceDecay = 0.75 // 每次反弹的衰减系数

          // 当前属于第几次反弹
          const bounceIdx = i / echoIntervalSamples
          const bounceNum = Math.floor(bounceIdx)
          // 在一个反弹周期内的位置 (0~1)
          const phaseInBounce = bounceIdx - bounceNum

          // 每次反弹的振幅
          const bounceAmp = Math.pow(bounceDecay, bounceNum)

          // 回声脉冲: 每个反弹周期开头有一个短脉冲，逐渐扩散
          // 脉冲宽度随反弹次数增大（越远的回声越模糊）
          const pulseWidth = 0.02 + bounceNum * 0.01 // 20ms + 每次+10ms
          const pulseEnv = Math.exp(-Math.pow((phaseInBounce) / pulseWidth, 2)) // 高斯窗

          // 扩散噪声: 隧道壁的不规则反射
          const diffusion = (Math.random() * 2 - 1) * 0.7 + Math.sin(i * 0.01 + ch * 2.1) * 0.3

          // 整体衰减包络
          sample = diffusion * pulseEnv * bounceAmp * decayEnvelope

          // 反弹之间也有低电平的残响填充
          if (pulseEnv < 0.1) {
            const fillNoise = (Math.random() * 2 - 1) * 0.08 * bounceAmp * decayEnvelope
            sample += fillNoise
          }

          break
        }
        case 'valley': {
          // 山谷: 离散回声，逐渐衰减
          const echoInterval = Math.floor(sampleRate * 0.15) // 150ms 间隔
          const echoIndex = i % echoInterval
          const echoDecay = Math.floor(i / echoInterval)
          const echoEnvelope = Math.pow(0.6, echoDecay)
          sample = (echoIndex < 3 ? (Math.random() * 2 - 1) * 0.8 : 0) * echoEnvelope * decayEnvelope
          break
        }
        case 'metal': {
          // 金属: 共振振铃 + 噪声
          const ring1 = Math.sin(i * 0.15) * Math.exp(-t * 2.5) * 0.3
          const ring2 = Math.sin(i * 0.23) * Math.exp(-t * 3) * 0.2
          const noise = (Math.random() * 2 - 1) * decayEnvelope * 0.3
          sample = ring1 + ring2 + noise
          break
        }
        default:
          sample = (Math.random() * 2 - 1) * decayEnvelope
      }

      // 左右声道微小差异增强空间感
      if (ch === 1) sample *= 0.97 + Math.random() * 0.06
      data[preDelaySamples + i] = sample
    }
  }

  return ir
}

// ==================== 失真曲线生成器 ====================

/**
 * 生成失真曲线
 * @param amount 失真量 (1-100)
 * @param type 'soft' 软失真（tanh）, 'hard' 硬失真（削波）
 */
export function makeDistortionCurve(amount: number, type: 'soft' | 'hard'): Float32Array {
  const samples = 8192
  const curve = new Float32Array(samples)
  const k = Math.max(1, amount)

  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1 // -1 to 1
    if (type === 'soft') {
      // 软失真: tanh 压缩，温暖自然的过载
      curve[i] = (Math.tanh(x * k) / Math.tanh(k)) * 0.8
    } else {
      // 硬失真: 硬削波，尖锐的破音
      const threshold = 1 / (k * 0.5 + 1)
      if (x > threshold) curve[i] = threshold * 0.9
      else if (x < -threshold) curve[i] = -threshold * 0.9
      else curve[i] = x * (k * 0.5 + 1) * 0.9
    }
  }
  return curve
}
