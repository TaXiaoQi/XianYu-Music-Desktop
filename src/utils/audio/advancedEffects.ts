/**
 * 高级音效引擎 - 扩展音效处理模块
 *
 * 包含:
 * - 新增均衡器预设（超重低音、清澈高音、监听平直、摇滚加厚、空灵女声、重金属、古典弦乐）
 * - 算法混响预设（录音棚、音乐厅、浴室、隧道、山谷、金属腔体、板式、弹簧、预延迟）
 * - 卡拉OK消人声
 * - 动态音调漂移 / 颤音 / 抖音效果器 / 滑音变调
 * - Bass重低音增强（含动态低音回弹）
 * - 失真效果（软失真/硬失真）
 * - 镶边效果（Flanger）
 * - 相位效果（Phaser）
 * - 延迟回声（单次/乒乓）
 * - 压缩器（动态音量压缩）
 * - 动态均衡（自动压制刺耳高频、补强低音）
 * - Crossfeed 耳机互馈
 * - 立体声拓宽 / 单声道合并 / 左右声道交换
 * - V4A 组合音效 / Reverb+Delay 链式组合
 *
 * 效果架插入位置: convolverDynamicsCompressor → [效果架] → 空间音效 → panner
 * 效果架内部顺序: 消人声 → 颤音 → 音调漂移 → 低音增强 → 动态均衡 → 失真 → 镶边 → 相位 → 延迟 → 压缩器 → 互馈 → 立体声拓宽 → 单声道合并 → 声道交换
 */

import { makeDistortionCurve } from './advancedEffectPresets'

export {
  advancedEqPresets,
  algorithmicReverbs,
  generateReverbIR,
  makeDistortionCurve,
} from './advancedEffectPresets'
export type { AlgorithmicReverbPreset } from './advancedEffectPresets'

// ==================== 效果架接口定义 ====================

export interface EffectsRack {
  /** 效果架输入节点（连接到 convolverDynamicsCompressor） */
  input: GainNode
  /** 效果架输出节点（连接到空间音效/panner） */
  output: GainNode

  // ----- 消人声 -----
  setVocalRemoval(enabled: boolean): void

  // ----- 颤音 -----
  setVibrato(enabled: boolean, rate: number, depth: number): void

  // ----- 动态音调漂移 -----
  setPitchDrift(enabled: boolean, speed: number, range: number): void

  // ----- 抖音效果器（Tremolo） -----
  setTremolo(enabled: boolean, rate: number, depth: number): void

  // ----- Bass 重低音增强 -----
  setBassBoost(enabled: boolean, gain: number, dynamic: boolean): void

  // ----- 动态均衡 -----
  setDynamicEq(enabled: boolean): void

  // ----- 失真 -----
  setDistortion(enabled: boolean, amount: number, type: 'soft' | 'hard'): void

  // ----- 镶边（Flanger） -----
  setFlanger(enabled: boolean, rate: number, depth: number, feedback: number, mix: number): void

  // ----- 相位（Phaser） -----
  setPhaser(enabled: boolean, rate: number, depth: number, feedback: number, mix: number): void

  // ----- 延迟回声 -----
  setDelay(enabled: boolean, time: number, feedback: number, mix: number, type: 'single' | 'pingpong'): void

  // ----- 压缩器 -----
  setCompressor(enabled: boolean, threshold: number, ratio: number, attack: number, release: number): void

  // ----- Crossfeed 耳机互馈 -----
  setCrossfeed(enabled: boolean, strength: number): void

  // ----- 立体声拓宽 -----
  setStereoWiden(enabled: boolean, amount: number): void

  // ----- 单声道合并 -----
  setMonoMerge(enabled: boolean): void

  // ----- 左右声道交换 -----
  setChannelSwap(enabled: boolean): void

  // ----- 多段压缩器 -----
  setMultibandCompressor(enabled: boolean, lowFreq: number, midFreq: number, threshold: number, ratio: number): void

  // ----- 限制器 -----
  setLimiter(enabled: boolean, threshold: number): void

  // ----- 噪声门 -----
  setNoiseGate(enabled: boolean, threshold: number, attack: number, release: number): void

  // ----- 扩展器 -----
  setExpander(enabled: boolean, threshold: number, ratio: number): void

  // ----- 谐波激励器 -----
  setExciter(enabled: boolean, amount: number, frequency: number): void

  // ----- 次谐波低音增强 -----
  setSubBass(enabled: boolean, amount: number, frequency: number): void

  // ----- 去齿音 -----
  setDeEsser(enabled: boolean, threshold: number, frequency: number): void

  // ----- 自动增益 -----
  setAGC(enabled: boolean, targetLevel: number): void

  // ----- Lo-Fi 低保真 -----
  setLoFi(enabled: boolean, sampleRate: number, bitDepth: number, noise: number): void

  // ----- 比特粉碎 -----
  setBitcrush(enabled: boolean, bits: number): void

  // ----- 立体声分离度调节 (M/S) -----
  setStereoSeparation(enabled: boolean, width: number, centerLevel: number): void

  // ----- AB 对比旁通 -----
  setBypass(bypassed: boolean): void

  // ----- V4A 组合音效 -----
  setV4A(enabled: boolean): void

  // ----- 重置所有效果 -----
  resetAll(): void

  // ----- 获取当前状态 -----
  getState(): Record<string, unknown>
}

// ==================== 效果架工厂函数 ====================

/**
 * 创建效果架
 * 在 convolverDynamicsCompressor 和 panner 之间插入
 * 所有效果默认关闭（直通）
 */
export function createEffectsRack(ctx: AudioContext): EffectsRack {
  const input = ctx.createGain()
  const output = ctx.createGain()
  input.gain.value = 1
  output.gain.value = 1

  // ===== 状态 =====
  const state: Record<string, unknown> = {}

  // ===== 模块类型（支持动态属性赋值） =====
  interface EffectModuleData {
    modInput: GainNode
    modOutput: GainNode
    [key: string]: unknown
  }

  // ===== 工具函数: 创建直通模块 =====
  // 每个模块有 input 和 output GainNode
  // 默认 input → output 直通
  function createModule(): EffectModuleData {
    const modInput = ctx.createGain()
    const modOutput = ctx.createGain()
    modInput.connect(modOutput) // 默认直通
    return { modInput, modOutput }
  }

  // ===== 工具函数: 切换模块路由（串联式） =====
  // enabled=true 时走效果路径, enabled=false 时走直通
  // 注意: 此函数会自动连接 effectNodes 之间的内部连线
  // 仅适用于普通串联效果链（如 filter→gain→filter）
  // [修复电流声] 断开/重连前用 gain ramp 做 5ms 淡入淡出，避免瞬态咔哒声
  function toggleModule(
    modInput: GainNode,
    modOutput: GainNode,
    enabled: boolean,
    effectNodes: AudioNode[], // 效果链节点: [first, ..., last]
  ) {
    // 淡出当前路径
    const t0 = ctx.currentTime
    modInput.gain.cancelScheduledValues(t0)
    modInput.gain.setValueAtTime(modInput.gain.value, t0)
    modInput.gain.linearRampToValueAtTime(0.0001, t0 + 0.005)

    // 在淡出完成后切换路由（用 setTimeout 对齐音频时钟）
    setTimeout(() => {
      try { modInput.disconnect() } catch {}
      if (enabled && effectNodes.length > 0) {
        modInput.connect(effectNodes[0])
        // 连接效果链内部
        for (let i = 0; i < effectNodes.length - 1; i++) {
          effectNodes[i].connect(effectNodes[i + 1])
        }
        effectNodes[effectNodes.length - 1].connect(modOutput)
      } else {
        modInput.connect(modOutput) // 直通
      }
      // 淡入新路径
      const t1 = ctx.currentTime
      modInput.gain.cancelScheduledValues(t1)
      modInput.gain.setValueAtTime(0.0001, t1)
      modInput.gain.linearRampToValueAtTime(1, t1 + 0.005)
    }, 6)
  }

  // ===== 工具函数: 切换模块路由（首尾式，不添加内部连接） =====
  // 适用于 splitter/merger 等已有自定义内部路由的模块
  // 只连接 modInput → firstNode 和 lastNode → modOutput
  // 不会在 firstNode 和 lastNode 之间添加任何连接
  // [修复电流声] 断开/重连前用 gain ramp 做 5ms 淡入淡出
  function togglePassthrough(
    modInput: GainNode,
    modOutput: GainNode,
    enabled: boolean,
    firstNode: AudioNode,
    lastNode: AudioNode,
  ) {
    const t0 = ctx.currentTime
    modInput.gain.cancelScheduledValues(t0)
    modInput.gain.setValueAtTime(modInput.gain.value, t0)
    modInput.gain.linearRampToValueAtTime(0.0001, t0 + 0.005)

    setTimeout(() => {
      try { modInput.disconnect() } catch {}
      if (enabled) {
        modInput.connect(firstNode)
        lastNode.connect(modOutput)
      } else {
        modInput.connect(modOutput) // 直通
      }
      const t1 = ctx.currentTime
      modInput.gain.cancelScheduledValues(t1)
      modInput.gain.setValueAtTime(0.0001, t1)
      modInput.gain.linearRampToValueAtTime(1, t1 + 0.005)
    }, 6)
  }

  // ===== 工具函数: 切换湿/干混合模块 =====
  // [修复电流声] 断开/重连前用 gain ramp 做 5ms 淡入淡出
  function toggleWetDry(
    modInput: GainNode,
    modOutput: GainNode,
    enabled: boolean,
    dryGain: GainNode,
    wetGain: GainNode,
    effectFirst: AudioNode,
    effectLast: AudioNode,
    wetAmount: number,
    dryAmount: number,
  ) {
    const t0 = ctx.currentTime
    modInput.gain.cancelScheduledValues(t0)
    modInput.gain.setValueAtTime(modInput.gain.value, t0)
    modInput.gain.linearRampToValueAtTime(0.0001, t0 + 0.005)

    setTimeout(() => {
      try { modInput.disconnect() } catch {}
      if (enabled) {
        wetGain.gain.setTargetAtTime(wetAmount, ctx.currentTime, 0.01)
        dryGain.gain.setTargetAtTime(dryAmount, ctx.currentTime, 0.01)
        modInput.connect(dryGain)
        dryGain.connect(modOutput)
        modInput.connect(effectFirst)
        effectLast.connect(wetGain)
        wetGain.connect(modOutput)
      } else {
        modInput.connect(modOutput)
      }
      const t1 = ctx.currentTime
      modInput.gain.cancelScheduledValues(t1)
      modInput.gain.setValueAtTime(0.0001, t1)
      modInput.gain.linearRampToValueAtTime(1, t1 + 0.005)
    }, 6)
  }

  // ==================== 模块 1: 消人声 ====================
  const vocalRemoval = createModule()
  {
    const splitter = ctx.createChannelSplitter(2)
    const inverter = ctx.createGain()
    inverter.gain.value = -1
    const summer = ctx.createGain()
    summer.gain.value = 1
    summer.channelCount = 1
    summer.channelCountMode = 'explicit'
    const merger = ctx.createChannelMerger(2)

    // L → inverter → summer, R → summer → summer 输出 (L-R)
    splitter.connect(inverter, 0)
    inverter.connect(summer)
    splitter.connect(summer, 1)
    // summer 输出到左右双声道
    summer.connect(merger, 0, 0)
    summer.connect(merger, 0, 1)

    const setVocalRemoval = (enabled: boolean) => {
      state.vocalRemoval = enabled
      // 使用 togglePassthrough: splitter 和 merger 之间的路由已在创建时设置好
      // 不能用 toggleModule，否则会额外添加 splitter→merger 的默认直通连接（L→L, R→R），覆盖反相求和
      togglePassthrough(vocalRemoval.modInput, vocalRemoval.modOutput, enabled, splitter, merger)
    }
    vocalRemoval._setVocalRemoval = setVocalRemoval
  }

  // ==================== 模块 2: 颤音 (Vibrato) ====================
  // 使用调制延迟线产生音高周期性变化
  // [CPU优化] LFO 延迟启停：仅在启用时创建并启动振荡器，禁用时停止并释放
  const vibrato = createModule()
  {
    const delay = ctx.createDelay(0.05)
    delay.delayTime.value = 0.005 // 5ms 基准延迟
    let lfo: OscillatorNode | null = null
    let lfoGain: GainNode | null = null

    const startLfo = () => {
      if (lfo) return
      lfo = ctx.createOscillator()
      lfo.type = 'sine'
      lfoGain = ctx.createGain()
      lfo.connect(lfoGain)
      lfoGain.connect(delay.delayTime)
      lfo.start()
    }
    const stopLfo = () => {
      if (!lfo) return
      try { lfo.stop() } catch {}
      try { lfo.disconnect() } catch {}
      try { lfoGain?.disconnect() } catch {}
      lfo = null
      lfoGain = null
    }

    const setVibrato = (enabled: boolean, rate: number, depth: number) => {
      state.vibrato = enabled
      state.vibratoRate = rate
      state.vibratoDepth = depth
      if (enabled) {
        startLfo()
        lfo?.frequency.setTargetAtTime(rate, ctx.currentTime, 0.05)
        lfoGain?.gain.setTargetAtTime(depth / 1000, ctx.currentTime, 0.05)
      } else {
        stopLfo()
      }
      toggleModule(vibrato.modInput, vibrato.modOutput, enabled, [delay])
    }
    vibrato._setVibrato = setVibrato
  }

  // ==================== 模块 3: 动态音调漂移 ====================
  // 极慢的调制延迟，模拟 "空灵版本" 的缓慢升降调
  // [CPU优化] LFO 延迟启停
  const pitchDrift = createModule()
  {
    const delay = ctx.createDelay(0.1)
    delay.delayTime.value = 0.01
    let lfo: OscillatorNode | null = null
    let lfoGain: GainNode | null = null

    const startLfo = () => {
      if (lfo) return
      lfo = ctx.createOscillator()
      lfo.type = 'sine'
      lfoGain = ctx.createGain()
      lfo.connect(lfoGain)
      lfoGain.connect(delay.delayTime)
      lfo.start()
    }
    const stopLfo = () => {
      if (!lfo) return
      try { lfo.stop() } catch {}
      try { lfo.disconnect() } catch {}
      try { lfoGain?.disconnect() } catch {}
      lfo = null
      lfoGain = null
    }

    const setPitchDrift = (enabled: boolean, speed: number, range: number) => {
      state.pitchDrift = enabled
      state.pitchDriftSpeed = speed
      state.pitchDriftRange = range
      if (enabled) {
        startLfo()
        lfo?.frequency.setTargetAtTime(speed / 10, ctx.currentTime, 0.1)
        lfoGain?.gain.setTargetAtTime(range / 1000, ctx.currentTime, 0.1)
      } else {
        stopLfo()
      }
      toggleModule(pitchDrift.modInput, pitchDrift.modOutput, enabled, [delay])
    }
    pitchDrift._setPitchDrift = setPitchDrift
  }

  // ==================== 模块 4: 抖音效果器 (Tremolo) ====================
  // 周期性音量调制
  // [CPU优化] LFO 延迟启停
  const tremolo = createModule()
  {
    const gainNode = ctx.createGain()
    gainNode.gain.value = 1
    let lfo: OscillatorNode | null = null
    let lfoGain: GainNode | null = null

    const startLfo = () => {
      if (lfo) return
      lfo = ctx.createOscillator()
      lfo.type = 'sine'
      lfoGain = ctx.createGain()
      lfo.connect(lfoGain)
      lfoGain.connect(gainNode.gain)
      lfo.start()
    }
    const stopLfo = () => {
      if (!lfo) return
      try { lfo.stop() } catch {}
      try { lfo.disconnect() } catch {}
      try { lfoGain?.disconnect() } catch {}
      lfo = null
      lfoGain = null
      gainNode.gain.setTargetAtTime(1, ctx.currentTime, 0.05)
    }

    const setTremolo = (enabled: boolean, rate: number, depth: number) => {
      state.tremolo = enabled
      state.tremoloRate = rate
      state.tremoloDepth = depth
      if (enabled) {
        startLfo()
        lfo?.frequency.setTargetAtTime(rate, ctx.currentTime, 0.05)
        lfoGain?.gain.setTargetAtTime(depth / 100, ctx.currentTime, 0.05)
      } else {
        stopLfo()
      }
      toggleModule(tremolo.modInput, tremolo.modOutput, enabled, [gainNode])
    }
    tremolo._setTremolo = setTremolo
  }

  // ==================== 模块 5: Bass 重低音增强 ====================
  const bassBoost = createModule()
  let bassBoostAnalyser: AnalyserNode | null = null
  let bassBoostIntv: ReturnType<typeof setInterval> | null = null
  {
    const lowshelf = ctx.createBiquadFilter()
    lowshelf.type = 'lowshelf'
    lowshelf.frequency.value = 120 // Hz
    lowshelf.gain.value = 0
    lowshelf.Q.value = 0.7

    // 动态低音: 分析低频并动态调整增益
    bassBoostAnalyser = ctx.createAnalyser()
    bassBoostAnalyser.fftSize = 256
    const dynamicGain = ctx.createGain()
    dynamicGain.gain.value = 1

    const setBassBoost = (enabled: boolean, gain: number, dynamic: boolean) => {
      state.bassBoost = enabled
      state.bassBoostGain = gain
      state.bassBoostDynamic = dynamic
      lowshelf.gain.setTargetAtTime(enabled ? gain : 0, ctx.currentTime, 0.05)

      // 停止旧的动态分析
      if (bassBoostIntv) {
        clearInterval(bassBoostIntv)
        bassBoostIntv = null
      }

      if (enabled && dynamic) {
        // 动态低音回弹: 分析低频能量，鼓点时增强低音
        const data = new Uint8Array(bassBoostAnalyser.frequencyBinCount)
        bassBoostIntv = setInterval(() => {
          bassBoostAnalyser!.getByteFrequencyData(data)
          // 计算低频平均能量 (前 1/8 频段约对应低频)
          let sum = 0
          const lowBins = Math.floor(data.length / 8)
          for (let i = 0; i < lowBins; i++) sum += data[i]
          const avg = sum / lowBins / 255 // 0~1
          // 低频越强，额外增益越高（跟随鼓点）
          const boost = 1 + avg * 0.5
          dynamicGain.gain.setTargetAtTime(boost, ctx.currentTime, 0.02)
        }, 50) // [CPU优化] 30ms → 50ms，降低分析频率
      } else {
        dynamicGain.gain.setTargetAtTime(1, ctx.currentTime, 0.05)
      }

      toggleModule(bassBoost.modInput, bassBoost.modOutput, enabled, [lowshelf, dynamicGain])
    }
    bassBoost._setBassBoost = setBassBoost
  }

  // ==================== 模块 6: 动态均衡 ====================
  // 自动压制刺耳高频 + 补强低音
  const dynamicEq = createModule()
  {
    // 低频增强: 低架滤波器
    const lowBoost = ctx.createBiquadFilter()
    lowBoost.type = 'lowshelf'
    lowBoost.frequency.value = 80
    lowBoost.gain.value = 3 // +3dB

    // 高频压缩: 分频段 → 压缩器 → 重组
    const lowpass = ctx.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.value = 5000
    lowpass.Q.value = 0.7

    const highpass = ctx.createBiquadFilter()
    highpass.type = 'highpass'
    highpass.frequency.value = 5000
    highpass.Q.value = 0.7

    const highCompressor = ctx.createDynamicsCompressor()
    highCompressor.threshold.value = -12 // 高于 -12dB 的尖峰被压缩
    highCompressor.knee.value = 6
    highCompressor.ratio.value = 8
    highCompressor.attack.value = 0.001
    highCompressor.release.value = 0.05

    const merger = ctx.createChannelMerger(2)

    // 输入 → lowBoost → 分频
    // 低频路径: lowBoost → lowpass → merger(L,R)
    // 高频路径: lowBoost → highpass → compressor → merger(L,R)
    const setDynamicEq = (enabled: boolean) => {
      state.dynamicEq = enabled
      // [修复电流声] 用 gain ramp 淡入淡出
      const t0 = ctx.currentTime
      dynamicEq.modInput.gain.cancelScheduledValues(t0)
      dynamicEq.modInput.gain.setValueAtTime(dynamicEq.modInput.gain.value, t0)
      dynamicEq.modInput.gain.linearRampToValueAtTime(0.0001, t0 + 0.005)

      setTimeout(() => {
        try { dynamicEq.modInput.disconnect() } catch {}
        if (enabled) {
          // lowBoost 先处理整体
          dynamicEq.modInput.connect(lowBoost)
          // 低频路径
          lowBoost.connect(lowpass)
          lowpass.connect(merger, 0, 0)
          lowpass.connect(merger, 0, 1)
          // 高频路径（压缩）
          lowBoost.connect(highpass)
          highpass.connect(highCompressor)
          highCompressor.connect(merger, 0, 0)
          highCompressor.connect(merger, 0, 1)
          // 合并输出
          merger.connect(dynamicEq.modOutput)
        } else {
          dynamicEq.modInput.connect(dynamicEq.modOutput)
        }
        const t1 = ctx.currentTime
        dynamicEq.modInput.gain.cancelScheduledValues(t1)
        dynamicEq.modInput.gain.setValueAtTime(0.0001, t1)
        dynamicEq.modInput.gain.linearRampToValueAtTime(1, t1 + 0.005)
      }, 6)
    }
    dynamicEq._setDynamicEq = setDynamicEq
  }

  // ==================== 模块 7: 失真 (Distortion) ====================
  const distortion = createModule()
  {
    const preGain = ctx.createGain()
    preGain.gain.value = 1
    const shaper = ctx.createWaveShaper()
    shaper.oversample = '2x' // [CPU优化] 4x → 2x，降低过采样开销
    shaper.curve = makeDistortionCurve(10, 'soft')
    const postGain = ctx.createGain()
    postGain.gain.value = 0.8 // 降低输出避免爆音

    const setDistortion = (enabled: boolean, amount: number, type: 'soft' | 'hard') => {
      state.distortion = enabled
      state.distortionAmount = amount
      state.distortionType = type
      preGain.gain.setTargetAtTime(1 + amount / 50, ctx.currentTime, 0.05)
      shaper.curve = makeDistortionCurve(amount, type)
      postGain.gain.setTargetAtTime(type === 'hard' ? 0.6 : 0.8, ctx.currentTime, 0.05)
      toggleModule(distortion.modInput, distortion.modOutput, enabled, [preGain, shaper, postGain])
    }
    distortion._setDistortion = setDistortion
  }

  // ==================== 模块 8: 镶边 (Flanger) ====================
  // 调制延迟 + 反馈，产生空灵飘忽的梳状滤波
  // [CPU优化] LFO 延迟启停
  const flanger = createModule()
  {
    const dry = ctx.createGain()
    const wet = ctx.createGain()
    dry.gain.value = 0.5
    wet.gain.value = 0.0
    const delay = ctx.createDelay(0.01)
    delay.delayTime.value = 0.005 // 5ms 中心
    const feedback = ctx.createGain()
    feedback.gain.value = 0.5
    let lfo: OscillatorNode | null = null
    let lfoGain: GainNode | null = null

    // 延迟反馈环
    delay.connect(feedback)
    feedback.connect(delay)

    const startLfo = () => {
      if (lfo) return
      lfo = ctx.createOscillator()
      lfo.type = 'sine'
      lfoGain = ctx.createGain()
      lfo.connect(lfoGain)
      lfoGain.connect(delay.delayTime)
      lfo.start()
    }
    const stopLfo = () => {
      if (!lfo) return
      try { lfo.stop() } catch {}
      try { lfo.disconnect() } catch {}
      try { lfoGain?.disconnect() } catch {}
      lfo = null
      lfoGain = null
    }

    const setFlanger = (enabled: boolean, rate: number, depth: number, fb: number, mix: number) => {
      state.flanger = enabled
      state.flangerRate = rate
      state.flangerDepth = depth
      state.flangerFeedback = fb
      state.flangerMix = mix
      feedback.gain.setTargetAtTime(fb / 100, ctx.currentTime, 0.05)
      if (enabled) {
        startLfo()
        lfo?.frequency.setTargetAtTime(rate, ctx.currentTime, 0.05)
        lfoGain?.gain.setTargetAtTime(depth / 1000, ctx.currentTime, 0.05)
      } else {
        stopLfo()
      }
      toggleWetDry(flanger.modInput, flanger.modOutput, enabled, dry, wet, delay, delay, mix / 100, 1 - mix / 100)
    }
    flanger._setFlanger = setFlanger
  }

  // ==================== 模块 9: 相位 (Phaser) ====================
  // 全通滤波器级联 + LFO 调制 + 反馈
  // [CPU优化] LFO 延迟启停
  const phaser = createModule()
  {
    const dry = ctx.createGain()
    const wet = ctx.createGain()
    dry.gain.value = 0.5
    wet.gain.value = 0.0
    let lfo: OscillatorNode | null = null
    let lfoGain: GainNode | null = null

    // 4 级全通滤波器
    const filters: BiquadFilterNode[] = []
    for (let i = 0; i < 4; i++) {
      const ap = ctx.createBiquadFilter()
      ap.type = 'allpass'
      ap.frequency.value = 500 + i * 800
      ap.Q.value = 1
      filters.push(ap)
    }
    // [修复] 串联连接全通滤波器: filters[0] → filters[1] → filters[2] → filters[3]
    for (let i = 0; i < filters.length - 1; i++) {
      filters[i].connect(filters[i + 1])
    }

    const feedback = ctx.createGain()
    feedback.gain.value = 0.3
    filters[3].connect(feedback)
    feedback.connect(filters[0])

    const startLfo = () => {
      if (lfo) return
      lfo = ctx.createOscillator()
      lfo.type = 'sine'
      lfoGain = ctx.createGain()
      lfo.connect(lfoGain)
      for (const ap of filters) {
        lfoGain.connect(ap.frequency)
      }
      lfo.start()
    }
    const stopLfo = () => {
      if (!lfo) return
      try { lfo.stop() } catch {}
      try { lfo.disconnect() } catch {}
      try { lfoGain?.disconnect() } catch {}
      lfo = null
      lfoGain = null
    }

    const setPhaser = (enabled: boolean, rate: number, depth: number, fb: number, mix: number) => {
      state.phaser = enabled
      state.phaserRate = rate
      state.phaserDepth = depth
      state.phaserFeedback = fb
      state.phaserMix = mix
      feedback.gain.setTargetAtTime(fb / 100, ctx.currentTime, 0.05)
      if (enabled) {
        startLfo()
        lfo?.frequency.setTargetAtTime(rate, ctx.currentTime, 0.05)
        lfoGain?.gain.setTargetAtTime(depth * 500, ctx.currentTime, 0.05)
      } else {
        stopLfo()
      }
      toggleWetDry(phaser.modInput, phaser.modOutput, enabled, dry, wet, filters[0], filters[3], mix / 100, 1 - mix / 100)
    }
    phaser._setPhaser = setPhaser
  }

  // ==================== 模块 10: 延迟回声 (Delay) ====================
  const delayMod = createModule()
  {
    // 通用节点
    const dry = ctx.createGain()
    const wet = ctx.createGain()
    dry.gain.value = 0.6
    wet.gain.value = 0.0

    // 单次回声节点
    const singleDelay = ctx.createDelay(2.0)
    singleDelay.delayTime.value = 0.3
    const singleFeedback = ctx.createGain()
    singleFeedback.gain.value = 0.4
    const singleFilter = ctx.createBiquadFilter()
    singleFilter.type = 'lowpass'
    singleFilter.frequency.value = 4000 // 模拟模拟延迟的高频衰减
    singleDelay.connect(singleFilter)
    singleFilter.connect(singleFeedback)
    singleFeedback.connect(singleDelay)

    // 乒乓回声节点
    const pSplitter = ctx.createChannelSplitter(2)
    const pDelayL = ctx.createDelay(2.0)
    const pDelayR = ctx.createDelay(2.0)
    pDelayL.delayTime.value = 0.3
    pDelayR.delayTime.value = 0.3
    const pFBLR = ctx.createGain() // L → R
    const pFBRL = ctx.createGain() // R → L
    pFBLR.gain.value = 0.4
    pFBRL.gain.value = 0.4
    const pMerger = ctx.createChannelMerger(2)

    // 乒乓路由: L→delayL→FB→delayR, R→delayR→FB→delayL
    pSplitter.connect(pDelayL, 0)
    pSplitter.connect(pDelayR, 1)
    pDelayL.connect(pFBLR)
    pFBLR.connect(pDelayR)
    pDelayR.connect(pFBRL)
    pFBRL.connect(pDelayL)
    pDelayL.connect(pMerger, 0, 0)
    pDelayR.connect(pMerger, 0, 1)

    const setDelay = (enabled: boolean, time: number, fb: number, mix: number, type: 'single' | 'pingpong') => {
      state.delay = enabled
      state.delayTime = time
      state.delayFeedback = fb
      state.delayMix = mix
      state.delayType = type

      // 更新参数
      singleDelay.delayTime.setTargetAtTime(time, ctx.currentTime, 0.05)
      singleFeedback.gain.setTargetAtTime(fb / 100, ctx.currentTime, 0.05)
      pDelayL.delayTime.setTargetAtTime(time, ctx.currentTime, 0.05)
      pDelayR.delayTime.setTargetAtTime(time, ctx.currentTime, 0.05)
      pFBLR.gain.setTargetAtTime(fb / 100, ctx.currentTime, 0.05)
      pFBRL.gain.setTargetAtTime(fb / 100, ctx.currentTime, 0.05)

      // [修复电流声] 用 gain ramp 淡入淡出，避免断开/重连产生咔哒声
      const t0 = ctx.currentTime
      delayMod.modInput.gain.cancelScheduledValues(t0)
      delayMod.modInput.gain.setValueAtTime(delayMod.modInput.gain.value, t0)
      delayMod.modInput.gain.linearRampToValueAtTime(0.0001, t0 + 0.005)

      setTimeout(() => {
        try { delayMod.modInput.disconnect() } catch {}
        try { dry.disconnect() } catch {}
        try { wet.disconnect() } catch {}
        if (enabled) {
          wet.gain.setTargetAtTime(mix / 100, ctx.currentTime, 0.01)
          dry.gain.setTargetAtTime(1 - mix / 100 * 0.5, ctx.currentTime, 0.01)

          delayMod.modInput.connect(dry)
          dry.connect(delayMod.modOutput)

          if (type === 'pingpong') {
            delayMod.modInput.connect(pSplitter)
            pMerger.connect(wet)
          } else {
            delayMod.modInput.connect(singleDelay)
            singleFilter.connect(wet)
          }
          wet.connect(delayMod.modOutput)
        } else {
          delayMod.modInput.connect(delayMod.modOutput)
        }
        const t1 = ctx.currentTime
        delayMod.modInput.gain.cancelScheduledValues(t1)
        delayMod.modInput.gain.setValueAtTime(0.0001, t1)
        delayMod.modInput.gain.linearRampToValueAtTime(1, t1 + 0.005)
      }, 6)
    }
    delayMod._setDelay = setDelay
  }

  // ==================== 模块 11: 压缩器 (Compressor) ====================
  const compressorMod = createModule()
  {
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -24
    comp.knee.value = 30
    comp.ratio.value = 12
    comp.attack.value = 0.003
    comp.release.value = 0.25

    const makeupGain = ctx.createGain()
    makeupGain.gain.value = 1.2 // 压缩后增益补偿

    const setCompressor = (enabled: boolean, threshold: number, ratio: number, attack: number, release: number) => {
      state.compressor = enabled
      state.compressorThreshold = threshold
      state.compressorRatio = ratio
      state.compressorAttack = attack
      state.compressorRelease = release
      comp.threshold.setTargetAtTime(threshold, ctx.currentTime, 0.05)
      comp.ratio.setTargetAtTime(ratio, ctx.currentTime, 0.05)
      comp.attack.setTargetAtTime(attack, ctx.currentTime, 0.05)
      comp.release.setTargetAtTime(release, ctx.currentTime, 0.05)
      toggleModule(compressorMod.modInput, compressorMod.modOutput, enabled, [comp, makeupGain])
    }
    compressorMod._setCompressor = setCompressor
  }

  // ==================== 模块 12: Crossfeed 耳机互馈 ====================
  // 模拟音箱外放听感: 少量 L 信号延迟+低通后送入 R，反之亦然
  const crossfeed = createModule()
  {
    const splitter = ctx.createChannelSplitter(2)
    const delayL = ctx.createDelay(0.005)
    const delayR = ctx.createDelay(0.005)
    delayL.delayTime.value = 0.0004 // 0.4ms (bs2b 标准)
    delayR.delayTime.value = 0.0004
    const filterL = ctx.createBiquadFilter()
    const filterR = ctx.createBiquadFilter()
    filterL.type = 'lowpass'
    filterL.frequency.value = 700 // bs2b 低交叉频率
    filterL.Q.value = 0.5
    filterR.type = 'lowpass'
    filterR.frequency.value = 700
    filterR.Q.value = 0.5
    const gainL = ctx.createGain()
    const gainR = ctx.createGain()
    gainL.gain.value = 0.3
    gainR.gain.value = 0.3
    const merger = ctx.createChannelMerger(2)

    // L → delay → filter → gain → R 输出 (互馈)
    splitter.connect(delayL, 0)
    delayL.connect(filterL)
    filterL.connect(gainL)
    gainL.connect(merger, 0, 1) // crossfeed L → R

    // R → delay → filter → gain → L 输出 (互馈)
    splitter.connect(delayR, 1)
    delayR.connect(filterR)
    filterR.connect(gainR)
    gainR.connect(merger, 0, 0) // crossfeed R → L

    // 直通信号
    splitter.connect(merger, 0, 0) // L → L
    splitter.connect(merger, 1, 1) // R → R

    const setCrossfeed = (enabled: boolean, strength: number) => {
      state.crossfeed = enabled
      state.crossfeedStrength = strength
      gainL.gain.setTargetAtTime(strength / 100, ctx.currentTime, 0.05)
      gainR.gain.setTargetAtTime(strength / 100, ctx.currentTime, 0.05)
      togglePassthrough(crossfeed.modInput, crossfeed.modOutput, enabled, splitter, merger)
    }
    crossfeed._setCrossfeed = setCrossfeed
  }

  // ==================== 模块 13: 立体声拓宽 ====================
  // M/S 处理: L' = L*(1+w)/2 + R*(1-w)/2, R' = L*(1-w)/2 + R*(1+w)/2
  const stereoWiden = createModule()
  {
    const splitter = ctx.createChannelSplitter(2)
    const ll = ctx.createGain() // L → L
    const lr = ctx.createGain() // L → R
    const rl = ctx.createGain() // R → L
    const rr = ctx.createGain() // R → R
    const merger = ctx.createChannelMerger(2)

    splitter.connect(ll, 0)
    splitter.connect(lr, 0)
    splitter.connect(rl, 1)
    splitter.connect(rr, 1)

    ll.connect(merger, 0, 0)
    rl.connect(merger, 0, 0)
    lr.connect(merger, 0, 1)
    rr.connect(merger, 0, 1)

    const setStereoWiden = (enabled: boolean, amount: number) => {
      state.stereoWiden = enabled
      state.stereoWidenAmount = amount
      // w = amount (1=正常, >1=加宽, <1=缩窄)
      const w = amount
      ll.gain.setTargetAtTime((1 + w) / 2, ctx.currentTime, 0.05)
      rr.gain.setTargetAtTime((1 + w) / 2, ctx.currentTime, 0.05)
      lr.gain.setTargetAtTime((1 - w) / 2, ctx.currentTime, 0.05)
      rl.gain.setTargetAtTime((1 - w) / 2, ctx.currentTime, 0.05)
      togglePassthrough(stereoWiden.modInput, stereoWiden.modOutput, enabled, splitter, merger)
    }
    stereoWiden._setStereoWiden = setStereoWiden
  }

  // ==================== 模块 14: 单声道合并 ====================
  const monoMerge = createModule()
  {
    const splitter = ctx.createChannelSplitter(2)
    const gainL = ctx.createGain()
    const gainR = ctx.createGain()
    gainL.gain.value = 0.5
    gainR.gain.value = 0.5
    const merger = ctx.createChannelMerger(2)

    splitter.connect(gainL, 0)
    splitter.connect(gainR, 1)
    // (L+R)/2 输出到两个声道
    gainL.connect(merger, 0, 0)
    gainL.connect(merger, 0, 1)
    gainR.connect(merger, 0, 0)
    gainR.connect(merger, 0, 1)

    const setMonoMerge = (enabled: boolean) => {
      state.monoMerge = enabled
      togglePassthrough(monoMerge.modInput, monoMerge.modOutput, enabled, splitter, merger)
    }
    monoMerge._setMonoMerge = setMonoMerge
  }

  // ==================== 模块 15: 左右声道交换 ====================
  const channelSwap = createModule()
  {
    const splitter = ctx.createChannelSplitter(2)
    const merger = ctx.createChannelMerger(2)

    splitter.connect(merger, 0, 1) // L → R
    splitter.connect(merger, 1, 0) // R → L

    const setChannelSwap = (enabled: boolean) => {
      state.channelSwap = enabled
      // 使用 togglePassthrough: splitter→merger 的交叉路由（L→R, R→L）已在创建时设置好
      // 不能用 toggleModule，否则会额外添加 splitter→merger 的默认直通（L→L, R→R），抵消声道交换
      togglePassthrough(channelSwap.modInput, channelSwap.modOutput, enabled, splitter, merger)
    }
    channelSwap._setChannelSwap = setChannelSwap
  }

  // ==================== 模块 16: 噪声门 (Noise Gate) ====================
  const noiseGate = createModule()
  let noiseGateIntv: ReturnType<typeof setInterval> | null = null
  {
    const ngAnalyser = ctx.createAnalyser()
    ngAnalyser.fftSize = 256 // [CPU优化] 512 → 256，降低 FFT 计算量
    const gateGain = ctx.createGain()
    gateGain.gain.value = 1
    const ngData = new Uint8Array(ngAnalyser.frequencyBinCount)

    const setNoiseGate = (enabled: boolean, threshold: number, attack: number, release: number) => {
      state.noiseGate = enabled
      state.noiseGateThreshold = threshold
      state.noiseGateAttack = attack
      state.noiseGateRelease = release
      const thresholdLinear = Math.pow(10, threshold / 20)
      let currentGain = 1

      if (noiseGateIntv) { clearInterval(noiseGateIntv); noiseGateIntv = null }

      if (enabled) {
        noiseGateIntv = setInterval(() => {
          ngAnalyser.getByteTimeDomainData(ngData)
          let sum = 0
          for (let i = 0; i < ngData.length; i++) {
            const v = (ngData[i] - 128) / 128
            sum += v * v
          }
          const rms = Math.sqrt(sum / ngData.length)
          const targetGain = rms > thresholdLinear ? 1 : 0.01
          const coef = targetGain > currentGain ? 0.9 : 0.95
          currentGain = currentGain * coef + targetGain * (1 - coef)
          gateGain.gain.setTargetAtTime(currentGain, ctx.currentTime, 0.005)
        }, 25) // [CPU优化] 10ms → 25ms，降低分析频率
        toggleModule(noiseGate.modInput, noiseGate.modOutput, true, [ngAnalyser, gateGain])
      } else {
        gateGain.gain.setTargetAtTime(1, ctx.currentTime, 0.05)
        toggleModule(noiseGate.modInput, noiseGate.modOutput, false, [])
      }
    }
    noiseGate._setNoiseGate = setNoiseGate
  }

  // ==================== 模块 17: 扩展器 (Expander) ====================
  const expander = createModule()
  let expanderIntv: ReturnType<typeof setInterval> | null = null
  {
    const expAnalyser = ctx.createAnalyser()
    expAnalyser.fftSize = 256 // [CPU优化] 512 → 256，降低 FFT 计算量
    const expGain = ctx.createGain()
    expGain.gain.value = 1
    const expData = new Uint8Array(expAnalyser.frequencyBinCount)

    const setExpander = (enabled: boolean, threshold: number, ratio: number) => {
      state.expander = enabled
      state.expanderThreshold = threshold
      state.expanderRatio = ratio
      const thresholdLinear = Math.pow(10, threshold / 20)

      if (expanderIntv) { clearInterval(expanderIntv); expanderIntv = null }

      if (enabled) {
        expanderIntv = setInterval(() => {
          expAnalyser.getByteTimeDomainData(expData)
          let sum = 0
          for (let i = 0; i < expData.length; i++) {
            const v = (expData[i] - 128) / 128
            sum += v * v
          }
          const rms = Math.sqrt(sum / expData.length)
          let gain = 1
          if (rms < thresholdLinear && rms > 0.0001) {
            const dbBelow = 20 * Math.log10(rms / thresholdLinear)
            gain = Math.pow(10, dbBelow * (1 - 1 / ratio) / 20)
            gain = Math.max(0.01, Math.min(1, gain))
          }
          expGain.gain.setTargetAtTime(gain, ctx.currentTime, 0.01)
        }, 25) // [CPU优化] 10ms → 25ms，降低分析频率
        toggleModule(expander.modInput, expander.modOutput, true, [expAnalyser, expGain])
      } else {
        expGain.gain.setTargetAtTime(1, ctx.currentTime, 0.05)
        toggleModule(expander.modInput, expander.modOutput, false, [])
      }
    }
    expander._setExpander = setExpander
  }

  // ==================== 模块 18: 多段压缩器 (Multi-band Compressor) ====================
  const multibandComp = createModule()
  {
    const lpLow = ctx.createBiquadFilter()
    lpLow.type = 'lowpass'; lpLow.frequency.value = 200; lpLow.Q.value = 0.707
    const hpLow = ctx.createBiquadFilter()
    hpLow.type = 'highpass'; hpLow.frequency.value = 200; hpLow.Q.value = 0.707
    const lpMid = ctx.createBiquadFilter()
    lpMid.type = 'lowpass'; lpMid.frequency.value = 2000; lpMid.Q.value = 0.707
    const hpHigh = ctx.createBiquadFilter()
    hpHigh.type = 'highpass'; hpHigh.frequency.value = 2000; hpHigh.Q.value = 0.707

    const compLow = ctx.createDynamicsCompressor()
    compLow.threshold.value = -20; compLow.ratio.value = 3; compLow.knee.value = 10
    compLow.attack.value = 0.005; compLow.release.value = 0.1
    const compMid = ctx.createDynamicsCompressor()
    compMid.threshold.value = -20; compMid.ratio.value = 3; compMid.knee.value = 10
    compMid.attack.value = 0.003; compMid.release.value = 0.08
    const compHigh = ctx.createDynamicsCompressor()
    compHigh.threshold.value = -20; compHigh.ratio.value = 3; compHigh.knee.value = 10
    compHigh.attack.value = 0.001; compHigh.release.value = 0.05

    const gainLow = ctx.createGain(); gainLow.gain.value = 1
    const gainMid = ctx.createGain(); gainMid.gain.value = 1
    const gainHigh = ctx.createGain(); gainHigh.gain.value = 1
    const mbMerger = ctx.createChannelMerger(3)

    const setMultibandCompressor = (enabled: boolean, lowFreq: number, midFreq: number, threshold: number, ratio: number) => {
      state.multibandComp = enabled
      state.mbLowFreq = lowFreq; state.mbMidFreq = midFreq
      state.mbThreshold = threshold; state.mbRatio = ratio
      lpLow.frequency.setTargetAtTime(lowFreq, ctx.currentTime, 0.05)
      hpLow.frequency.setTargetAtTime(lowFreq, ctx.currentTime, 0.05)
      lpMid.frequency.setTargetAtTime(midFreq, ctx.currentTime, 0.05)
      hpHigh.frequency.setTargetAtTime(midFreq, ctx.currentTime, 0.05)
      for (const c of [compLow, compMid, compHigh]) {
        c.threshold.setTargetAtTime(threshold, ctx.currentTime, 0.05)
        c.ratio.setTargetAtTime(ratio, ctx.currentTime, 0.05)
      }

      // [修复电流声] 用 gain ramp 淡入淡出
      const t0 = ctx.currentTime
      multibandComp.modInput.gain.cancelScheduledValues(t0)
      multibandComp.modInput.gain.setValueAtTime(multibandComp.modInput.gain.value, t0)
      multibandComp.modInput.gain.linearRampToValueAtTime(0.0001, t0 + 0.005)

      setTimeout(() => {
        try { multibandComp.modInput.disconnect() } catch {}
        if (enabled) {
          multibandComp.modInput.connect(lpLow); lpLow.connect(compLow); compLow.connect(gainLow)
          gainLow.connect(mbMerger, 0, 0); gainLow.connect(mbMerger, 0, 1)
          multibandComp.modInput.connect(hpLow); hpLow.connect(lpMid); lpMid.connect(compMid); compMid.connect(gainMid)
          gainMid.connect(mbMerger, 0, 0); gainMid.connect(mbMerger, 0, 1)
          multibandComp.modInput.connect(hpHigh); hpHigh.connect(compHigh); compHigh.connect(gainHigh)
          gainHigh.connect(mbMerger, 0, 0); gainHigh.connect(mbMerger, 0, 1)
          mbMerger.connect(multibandComp.modOutput)
        } else {
          multibandComp.modInput.connect(multibandComp.modOutput)
        }
        const t1 = ctx.currentTime
        multibandComp.modInput.gain.cancelScheduledValues(t1)
        multibandComp.modInput.gain.setValueAtTime(0.0001, t1)
        multibandComp.modInput.gain.linearRampToValueAtTime(1, t1 + 0.005)
      }, 6)
    }
    multibandComp._setMultibandCompressor = setMultibandCompressor
  }

  // ==================== 模块 19: 限制器 (Limiter) ====================
  const limiter = createModule()
  {
    const lim = ctx.createDynamicsCompressor()
    lim.threshold.value = -1; lim.knee.value = 0; lim.ratio.value = 20
    lim.attack.value = 0.001; lim.release.value = 0.05
    const limMakeup = ctx.createGain(); limMakeup.gain.value = 1

    const setLimiter = (enabled: boolean, threshold: number) => {
      state.limiter = enabled; state.limiterThreshold = threshold
      lim.threshold.setTargetAtTime(threshold, ctx.currentTime, 0.05)
      toggleModule(limiter.modInput, limiter.modOutput, enabled, [lim, limMakeup])
    }
    limiter._setLimiter = setLimiter
  }

  // ==================== 模块 20: 谐波激励器 (Harmonic Exciter) ====================
  const exciter = createModule()
  {
    const dry = ctx.createGain(); const wet = ctx.createGain()
    dry.gain.value = 0.8; wet.gain.value = 0.2
    const hpf = ctx.createBiquadFilter()
    hpf.type = 'highpass'; hpf.frequency.value = 3000; hpf.Q.value = 0.7
    const shaper = ctx.createWaveShaper(); shaper.oversample = '2x' // [CPU优化] 4x → 2x
    const exciterCurve = new Float32Array(8192)
    for (let i = 0; i < 8192; i++) {
      const x = (i * 2) / 8192 - 1
      exciterCurve[i] = Math.tanh(x * 3) * 0.5
    }
    shaper.curve = exciterCurve

    const setExciter = (enabled: boolean, amount: number, frequency: number) => {
      state.exciter = enabled; state.exciterAmount = amount; state.exciterFrequency = frequency
      hpf.frequency.setTargetAtTime(frequency, ctx.currentTime, 0.05)
      wet.gain.setTargetAtTime(amount / 100, ctx.currentTime, 0.05)
      dry.gain.setTargetAtTime(1 - amount / 200, ctx.currentTime, 0.05)
      toggleWetDry(exciter.modInput, exciter.modOutput, enabled, dry, wet, hpf, shaper, 1, 1)
    }
    exciter._setExciter = setExciter
  }

  // ==================== 模块 21: 次谐波低音增强 (Sub-harmonic Bass) ====================
  const subBass = createModule()
  {
    const dry = ctx.createGain(); const wet = ctx.createGain()
    dry.gain.value = 0.8; wet.gain.value = 0.3
    const lpf = ctx.createBiquadFilter()
    lpf.type = 'lowpass'; lpf.frequency.value = 120; lpf.Q.value = 0.7
    const shaper = ctx.createWaveShaper()
    const subCurve = new Float32Array(8192)
    for (let i = 0; i < 8192; i++) {
      const x = (i * 2) / 8192 - 1
      subCurve[i] = x > 0 ? x : 0 // 半波整流产生次谐波
    }
    shaper.curve = subCurve
    const lpf2 = ctx.createBiquadFilter()
    lpf2.type = 'lowpass'; lpf2.frequency.value = 100; lpf2.Q.value = 0.7

    const setSubBass = (enabled: boolean, amount: number, frequency: number) => {
      state.subBass = enabled; state.subBassAmount = amount; state.subBassFrequency = frequency
      lpf.frequency.setTargetAtTime(frequency, ctx.currentTime, 0.05)
      lpf2.frequency.setTargetAtTime(frequency * 0.8, ctx.currentTime, 0.05)
      wet.gain.setTargetAtTime(amount / 100, ctx.currentTime, 0.05)
      dry.gain.setTargetAtTime(1, ctx.currentTime, 0.05)
      toggleWetDry(subBass.modInput, subBass.modOutput, enabled, dry, wet, lpf, lpf2, 1, 1)
    }
    subBass._setSubBass = setSubBass
  }

  // ==================== 模块 22: 去齿音 (De-esser) ====================
  const deEsser = createModule()
  let deEsserIntv: ReturnType<typeof setInterval> | null = null
  {
    const deAnalyser = ctx.createAnalyser()
    deAnalyser.fftSize = 512 // [CPU优化] 1024 → 512，降低 FFT 计算量
    const reductionGain = ctx.createGain()
    reductionGain.gain.value = 1
    const hpf = ctx.createBiquadFilter()
    hpf.type = 'highpass'; hpf.frequency.value = 6000; hpf.Q.value = 1.0
    const deFreqData = new Uint8Array(deAnalyser.frequencyBinCount)

    const setDeEsser = (enabled: boolean, threshold: number, frequency: number) => {
      state.deEsser = enabled; state.deEsserThreshold = threshold; state.deEsserFrequency = frequency
      hpf.frequency.setTargetAtTime(frequency, ctx.currentTime, 0.05)
      const thresholdLinear = threshold / 60 + 0.1 // 映射 -60~0 → 0.1~1.1

      if (deEsserIntv) { clearInterval(deEsserIntv); deEsserIntv = null }

      if (enabled) {
        deEsserIntv = setInterval(() => {
          deAnalyser.getByteFrequencyData(deFreqData)
          const nyquist = ctx.sampleRate / 2
          const binSize = nyquist / deFreqData.length
          const startBin = Math.floor(frequency / binSize)
          const endBin = Math.min(deFreqData.length, Math.floor((frequency + 4000) / binSize))
          let sum = 0, count = 0
          for (let i = startBin; i < endBin; i++) { sum += deFreqData[i]; count++ }
          const avg = count > 0 ? (sum / count) / 255 : 0
          const targetGain = avg > thresholdLinear ? 0.3 : 1
          reductionGain.gain.setTargetAtTime(targetGain, ctx.currentTime, 0.003)
        }, 25) // [CPU优化] 10ms → 25ms，降低分析频率
        toggleModule(deEsser.modInput, deEsser.modOutput, true, [hpf, reductionGain])
      } else {
        reductionGain.gain.setTargetAtTime(1, ctx.currentTime, 0.05)
        toggleModule(deEsser.modInput, deEsser.modOutput, false, [])
      }
    }
    deEsser._setDeEsser = setDeEsser
  }

  // ==================== 模块 23: 自动增益控制 (AGC) ====================
  const agc = createModule()
  let agcIntv: ReturnType<typeof setInterval> | null = null
  {
    const agcAnalyser = ctx.createAnalyser()
    agcAnalyser.fftSize = 512 // [CPU优化] 2048 → 512，降低 FFT 计算量
    const agcGain = ctx.createGain()
    agcGain.gain.value = 1
    const agcData = new Uint8Array(agcAnalyser.frequencyBinCount)
    let smoothedLevel = 0.1

    const setAGC = (enabled: boolean, targetLevel: number) => {
      state.agc = enabled; state.agcTargetLevel = targetLevel
      const targetRms = 0.05 + (targetLevel / 100) * 0.25

      if (agcIntv) { clearInterval(agcIntv); agcIntv = null }

      if (enabled) {
        agcIntv = setInterval(() => {
          agcAnalyser.getByteTimeDomainData(agcData)
          let sum = 0
          for (let i = 0; i < agcData.length; i++) {
            const v = (agcData[i] - 128) / 128
            sum += v * v
          }
          const rms = Math.sqrt(sum / agcData.length)
          smoothedLevel = smoothedLevel * 0.95 + rms * 0.05
          if (smoothedLevel > 0.001) {
            let desiredGain = targetRms / smoothedLevel
            desiredGain = Math.max(0.1, Math.min(5, desiredGain))
            agcGain.gain.setTargetAtTime(desiredGain, ctx.currentTime, 0.1)
          }
        }, 50)
        toggleModule(agc.modInput, agc.modOutput, true, [agcAnalyser, agcGain])
      } else {
        agcGain.gain.setTargetAtTime(1, ctx.currentTime, 0.1)
        toggleModule(agc.modInput, agc.modOutput, false, [])
      }
    }
    agc._setAGC = setAGC
  }

  // ==================== 模块 24: Lo-Fi 低保真效果 ====================
  const loFi = createModule()
  {
    const dry = ctx.createGain(); const wet = ctx.createGain()
    dry.gain.value = 0.3; wet.gain.value = 0.7
    const lpf = ctx.createBiquadFilter()
    lpf.type = 'lowpass'; lpf.frequency.value = 4000; lpf.Q.value = 0.7
    const shaper = ctx.createWaveShaper()
    const makeBitcrushCurve = (bits: number) => {
      const levels = Math.pow(2, bits)
      const curve = new Float32Array(8192)
      for (let i = 0; i < 8192; i++) {
        const x = (i * 2) / 8192 - 1
        curve[i] = Math.round(x * levels) / levels
      }
      return curve
    }
    shaper.curve = makeBitcrushCurve(8)
    const satShaper = ctx.createWaveShaper(); satShaper.oversample = '2x'
    const satCurve = new Float32Array(8192)
    for (let i = 0; i < 8192; i++) {
      const x = (i * 2) / 8192 - 1
      satCurve[i] = Math.tanh(x * 2) * 0.7
    }
    satShaper.curve = satCurve
    // [CPU优化] 磁带噪声源延迟创建：仅在 Lo-Fi 启用时才创建并启动
    let noiseSrc: AudioBufferSourceNode | null = null
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const noiseData = noiseBuf.getChannelData(0)
    for (let i = 0; i < noiseData.length; i++) {
      noiseData[i] = (Math.random() * 2 - 1) * 0.02
    }
    const noiseGain = ctx.createGain(); noiseGain.gain.value = 0.02
    const wetMerge = ctx.createGain()

    const startNoise = () => {
      if (noiseSrc) return
      noiseSrc = ctx.createBufferSource()
      noiseSrc.buffer = noiseBuf; noiseSrc.loop = true
      noiseSrc.connect(noiseGain)
      noiseSrc.start()
    }
    const stopNoise = () => {
      if (!noiseSrc) return
      try { noiseSrc.stop() } catch {}
      try { noiseSrc.disconnect() } catch {}
      noiseSrc = null
    }

    const setLoFi = (enabled: boolean, sampleRate: number, bitDepth: number, noise: number) => {
      state.loFi = enabled; state.loFiSampleRate = sampleRate
      state.loFiBitDepth = bitDepth; state.loFiNoise = noise
      lpf.frequency.setTargetAtTime(sampleRate / 2, ctx.currentTime, 0.05)
      shaper.curve = makeBitcrushCurve(bitDepth)
      noiseGain.gain.setTargetAtTime(noise / 100 * 0.05, ctx.currentTime, 0.05)

      // [修复电流声] 用 gain ramp 淡入淡出
      const t0 = ctx.currentTime
      loFi.modInput.gain.cancelScheduledValues(t0)
      loFi.modInput.gain.setValueAtTime(loFi.modInput.gain.value, t0)
      loFi.modInput.gain.linearRampToValueAtTime(0.0001, t0 + 0.005)

      setTimeout(() => {
        try { loFi.modInput.disconnect() } catch {}
        try { dry.disconnect() } catch {}
        try { wet.disconnect() } catch {}
        try { wetMerge.disconnect() } catch {}
        try { noiseGain.disconnect() } catch {}
        if (enabled) {
          startNoise()
          loFi.modInput.connect(dry); dry.connect(loFi.modOutput)
          loFi.modInput.connect(lpf); lpf.connect(shaper); shaper.connect(satShaper)
          satShaper.connect(wetMerge); noiseGain.connect(wetMerge)
          wetMerge.connect(wet); wet.connect(loFi.modOutput)
        } else {
          stopNoise()
          loFi.modInput.connect(loFi.modOutput)
        }
        const t1 = ctx.currentTime
        loFi.modInput.gain.cancelScheduledValues(t1)
        loFi.modInput.gain.setValueAtTime(0.0001, t1)
        loFi.modInput.gain.linearRampToValueAtTime(1, t1 + 0.005)
      }, 6)
    }
    loFi._setLoFi = setLoFi
  }

  // ==================== 模块 25: 比特粉碎 (Bitcrush) ====================
  const bitcrush = createModule()
  {
    const dry = ctx.createGain(); const wet = ctx.createGain()
    dry.gain.value = 0.5; wet.gain.value = 0.5
    const lpf = ctx.createBiquadFilter()
    lpf.type = 'lowpass'; lpf.frequency.value = 8000; lpf.Q.value = 0.7
    const shaper = ctx.createWaveShaper()
    const makeBCurve = (bits: number) => {
      const levels = Math.max(2, Math.pow(2, bits))
      const curve = new Float32Array(8192)
      for (let i = 0; i < 8192; i++) {
        const x = (i * 2) / 8192 - 1
        curve[i] = Math.round(x * levels) / levels
      }
      return curve
    }
    shaper.curve = makeBCurve(6)

    const setBitcrush = (enabled: boolean, bits: number) => {
      state.bitcrush = enabled; state.bitcrushBits = bits
      shaper.curve = makeBCurve(bits)
      toggleWetDry(bitcrush.modInput, bitcrush.modOutput, enabled, dry, wet, lpf, shaper, 0.6, 0.5)
    }
    bitcrush._setBitcrush = setBitcrush
  }

  // ==================== 模块 26: 立体声分离度调节 (M/S) ====================
  const stereoSeparation = createModule()
  {
    const splitter = ctx.createChannelSplitter(2)
    const gainL_M = ctx.createGain(); const gainR_M = ctx.createGain()
    gainL_M.gain.value = 0.5; gainR_M.gain.value = 0.5
    const midGain = ctx.createGain(); midGain.gain.value = 1
    const gainL_S = ctx.createGain(); const gainR_S = ctx.createGain()
    gainL_S.gain.value = 0.5; gainR_S.gain.value = -0.5
    const sideGain = ctx.createGain(); sideGain.gain.value = 1
    const merger = ctx.createChannelMerger(2)

    splitter.connect(gainL_M, 0); splitter.connect(gainR_M, 1)
    gainL_M.connect(midGain); gainR_M.connect(midGain)
    splitter.connect(gainL_S, 0); splitter.connect(gainR_S, 1)
    gainL_S.connect(sideGain); gainR_S.connect(sideGain)
    midGain.connect(merger, 0, 0); midGain.connect(merger, 0, 1)
    sideGain.connect(merger, 0, 0)
    const sInvert = ctx.createGain(); sInvert.gain.value = -1
    sideGain.connect(sInvert); sInvert.connect(merger, 0, 1)

    const setStereoSeparation = (enabled: boolean, width: number, centerLevel: number) => {
      state.stereoSeparation = enabled; state.ssWidth = width; state.ssCenterLevel = centerLevel
      midGain.gain.setTargetAtTime(centerLevel / 100, ctx.currentTime, 0.05)
      sideGain.gain.setTargetAtTime(width / 100, ctx.currentTime, 0.05)
      togglePassthrough(stereoSeparation.modInput, stereoSeparation.modOutput, enabled, splitter, merger)
    }
    stereoSeparation._setStereoSeparation = setStereoSeparation
  }

  // ==================== AB 对比旁通 ====================

  // ==================== 连接所有模块 ====================
  // 顺序: 消人声 → 噪声门 → 扩展器 → 颤音 → 音调漂移 → 抖音 → 低音增强 → 次谐波低音 → 动态均衡 → 谐波激励 → 去齿音 → 失真 → 镶边 → 相位 → 延迟 → 压缩器 → 多段压缩 → 限制器 → 自动增益 → Lo-Fi → 比特粉碎 → 立体声分离 → 互馈 → 立体声拓宽 → 单声道合并 → 声道交换
  const allModules = [
    vocalRemoval, noiseGate, expander, vibrato, pitchDrift, tremolo, bassBoost, subBass, dynamicEq,
    exciter, deEsser, distortion, flanger, phaser, delayMod, compressorMod,
    multibandComp, limiter, agc, loFi, bitcrush, stereoSeparation,
    crossfeed, stereoWiden, monoMerge, channelSwap,
  ]

  // 连接: input → mod1.in → mod1.out → mod2.in → ... → output
  let prevOutput: AudioNode = input
  for (const mod of allModules) {
    prevOutput.connect(mod.modInput)
    prevOutput = mod.modOutput
  }
  prevOutput.connect(output)

  // AB 旁通实现: 保存第一个模块输入引用
  const chainFirstInput = allModules[0].modInput
  const setBypass = (b: boolean) => {
    // [修复电流声] 用 gain ramp 淡入淡出
    const t0 = ctx.currentTime
    input.gain.cancelScheduledValues(t0)
    input.gain.setValueAtTime(input.gain.value, t0)
    input.gain.linearRampToValueAtTime(0.0001, t0 + 0.005)

    setTimeout(() => {
      try { input.disconnect() } catch {}
      if (b) {
        input.connect(output)
      } else {
        input.connect(chainFirstInput)
      }
      const t1 = ctx.currentTime
      input.gain.cancelScheduledValues(t1)
      input.gain.setValueAtTime(0.0001, t1)
      input.gain.linearRampToValueAtTime(1, t1 + 0.005)
    }, 6)
  }

  // ==================== V4A 组合音效 ====================
  const setV4A = (enabled: boolean) => {
    state.v4a = enabled
    if (enabled) {
      // V4A: 同时启用多种效果（适中参数）
      ;(vocalRemoval as any)._setVocalRemoval(false) // V4A 不消人声
      ;(bassBoost as any)._setBassBoost(true, 6, true) // 动态低音增强
      ;(dynamicEq as any)._setDynamicEq(true) // 动态均衡
      ;(stereoWiden as any)._setStereoWiden(true, 1.4) // 适度立体声拓宽
      ;(compressorMod as any)._setCompressor(true, -20, 4, 0.003, 0.1) // 温和压缩
    } else {
      ;(bassBoost as any)._setBassBoost(false, 0, false)
      ;(dynamicEq as any)._setDynamicEq(false)
      ;(stereoWiden as any)._setStereoWiden(false, 1)
      ;(compressorMod as any)._setCompressor(false, -24, 12, 0.003, 0.25)
    }
  }

  // ==================== 重置所有 ====================
  const resetAll = () => {
    ;(vocalRemoval as any)._setVocalRemoval(false)
    ;(noiseGate as any)._setNoiseGate(false, -60, 5, 50)
    ;(expander as any)._setExpander(false, -40, 2)
    ;(vibrato as any)._setVibrato(false, 5, 3)
    ;(pitchDrift as any)._setPitchDrift(false, 1, 10)
    ;(tremolo as any)._setTremolo(false, 6, 30)
    ;(bassBoost as any)._setBassBoost(false, 0, false)
    ;(subBass as any)._setSubBass(false, 30, 120)
    ;(dynamicEq as any)._setDynamicEq(false)
    ;(exciter as any)._setExciter(false, 20, 3000)
    ;(deEsser as any)._setDeEsser(false, -20, 6000)
    ;(distortion as any)._setDistortion(false, 10, 'soft')
    ;(flanger as any)._setFlanger(false, 0.5, 2, 50, 50)
    ;(phaser as any)._setPhaser(false, 0.5, 1, 30, 50)
    ;(delayMod as any)._setDelay(false, 0.3, 40, 30, 'single')
    ;(compressorMod as any)._setCompressor(false, -24, 12, 0.003, 0.25)
    ;(multibandComp as any)._setMultibandCompressor(false, 200, 2000, -20, 3)
    ;(limiter as any)._setLimiter(false, -1)
    ;(agc as any)._setAGC(false, 50)
    ;(loFi as any)._setLoFi(false, 8000, 8, 20)
    ;(bitcrush as any)._setBitcrush(false, 6)
    ;(stereoSeparation as any)._setStereoSeparation(false, 100, 100)
    ;(crossfeed as any)._setCrossfeed(false, 30)
    ;(stereoWiden as any)._setStereoWiden(false, 1)
    ;(monoMerge as any)._setMonoMerge(false)
    ;(channelSwap as any)._setChannelSwap(false)
  }

  // ==================== 返回效果架接口 ====================
  return {
    input,
    output,
    setVocalRemoval: (e: boolean) => (vocalRemoval as any)._setVocalRemoval(e),
    setVibrato: (e: boolean, r: number, d: number) => (vibrato as any)._setVibrato(e, r, d),
    setPitchDrift: (e: boolean, s: number, r: number) => (pitchDrift as any)._setPitchDrift(e, s, r),
    setTremolo: (e: boolean, r: number, d: number) => (tremolo as any)._setTremolo(e, r, d),
    setBassBoost: (e: boolean, g: number, d: boolean) => (bassBoost as any)._setBassBoost(e, g, d),
    setDynamicEq: (e: boolean) => (dynamicEq as any)._setDynamicEq(e),
    setDistortion: (e: boolean, a: number, t: 'soft' | 'hard') => (distortion as any)._setDistortion(e, a, t),
    setFlanger: (e: boolean, r: number, d: number, f: number, m: number) => (flanger as any)._setFlanger(e, r, d, f, m),
    setPhaser: (e: boolean, r: number, d: number, f: number, m: number) => (phaser as any)._setPhaser(e, r, d, f, m),
    setDelay: (e: boolean, t: number, f: number, m: number, type: 'single' | 'pingpong') => (delayMod as any)._setDelay(e, t, f, m, type),
    setCompressor: (e: boolean, t: number, r: number, a: number, rel: number) => (compressorMod as any)._setCompressor(e, t, r, a, rel),
    setCrossfeed: (e: boolean, s: number) => (crossfeed as any)._setCrossfeed(e, s),
    setStereoWiden: (e: boolean, a: number) => (stereoWiden as any)._setStereoWiden(e, a),
    setMonoMerge: (e: boolean) => (monoMerge as any)._setMonoMerge(e),
    setChannelSwap: (e: boolean) => (channelSwap as any)._setChannelSwap(e),
    setMultibandCompressor: (e: boolean, lf: number, mf: number, t: number, r: number) => (multibandComp as any)._setMultibandCompressor(e, lf, mf, t, r),
    setLimiter: (e: boolean, t: number) => (limiter as any)._setLimiter(e, t),
    setNoiseGate: (e: boolean, t: number, a: number, r: number) => (noiseGate as any)._setNoiseGate(e, t, a, r),
    setExpander: (e: boolean, t: number, r: number) => (expander as any)._setExpander(e, t, r),
    setExciter: (e: boolean, a: number, f: number) => (exciter as any)._setExciter(e, a, f),
    setSubBass: (e: boolean, a: number, f: number) => (subBass as any)._setSubBass(e, a, f),
    setDeEsser: (e: boolean, t: number, f: number) => (deEsser as any)._setDeEsser(e, t, f),
    setAGC: (e: boolean, t: number) => (agc as any)._setAGC(e, t),
    setLoFi: (e: boolean, sr: number, bd: number, n: number) => (loFi as any)._setLoFi(e, sr, bd, n),
    setBitcrush: (e: boolean, b: number) => (bitcrush as any)._setBitcrush(e, b),
    setStereoSeparation: (e: boolean, w: number, c: number) => (stereoSeparation as any)._setStereoSeparation(e, w, c),
    setBypass,
    setV4A,
    resetAll,
    getState: () => state,
  }
}
