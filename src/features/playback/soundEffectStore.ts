import { defineStore } from 'pinia'
import { ref, reactive, watch } from 'vue'
import { playerStorage, playerStorageKeys } from '../../services/storage/playerStorage'
import { localStore } from '../../services/storage/localStore'
import {
  freqs,
  freqsPreset,
  convolutions,
  advancedEqPresets,
  algorithmicReverbs,
  setBiquadFilterGain,
  applyEqPreset,
  resetBiquadFilter,
  setConvolver,
  setConvolverMainGain,
  setConvolverSendGain,
  setAlgorithmicReverb,
  startPanner,
  stopPanner,
  setPannerSoundR,
  setPannerSpeed,
  setPitchShifter,
  setPlaybackRate,
  setPreservesPitch,
  startPanner8D,
  stopPanner8D,
  setPanner8DSpeed,
  setPanner8DRadius,
  startPanner36D,
  stopPanner36D,
  setPanner36DSpeed,
  setPanner36DRadius,
  startPanner95D,
  stopPanner95D,
  setPanner95DSpeed,
  setPanner95DRadius,
  startVirtualSurround,
  stopVirtualSurround,
  setVirtualSurroundMode,
  setVirtualSurroundSpread,
  connectAudioElement,
  disconnectAudioElement,
  setVocalRemoval,
  setVibrato,
  setPitchDrift,
  setTremolo,
  setBassBoost,
  setDynamicEq,
  setDistortion,
  setFlanger,
  setPhaser,
  setDelayEffect,
  setCompressor,
  setCrossfeed,
  setStereoWiden,
  setMonoMerge,
  setChannelSwap,
  setV4A,
  resetAllAdvancedEffects,
  setMultibandCompressor,
  setLimiter,
  setNoiseGate,
  setExpander,
  setExciter,
  setSubBass,
  setDeEsser,
  setAGC,
  setLoFi,
  setBitcrush,
  setStereoSeparation,
  setBypass,
  setAudioBoost,
} from '../../utils/audio/soundEffectEngine'
import { playbackApi } from '../../services/tauri/playbackApi'
import { useSettingsStore } from '../settings/store'
import type { EffectParams } from '../../services/tauri/contracts'

export const eqPresetNames = freqsPreset.map(p => p.name)
export const advancedEqPresetNames = advancedEqPresets.map(p => p.name)
export const algorithmicReverbNames = algorithmicReverbs.map(p => p.name)

export const useSoundEffectStore = defineStore('soundEffect', () => {
  // ===== 均衡器 =====
  const eqBands = reactive<Record<string, number>>({
    '31': 0, '62': 0, '125': 0, '250': 0, '500': 0,
    '1k': 0, '2k': 0, '4k': 0, '8k': 0, '16k': 0,
  })

  // 频段 label -> 频率值映射
  const freqLabelMap: Record<string, number> = {
    '31': 31, '62': 62, '125': 125, '250': 250, '500': 500,
    '1k': 1000, '2k': 2000, '4k': 4000, '8k': 8000, '16k': 16000,
  }

  // 监听均衡器频段变化，实时更新音频节点
  for (const label of Object.keys(eqBands)) {
    const freq = freqLabelMap[label] as (typeof freqs)[number]
    watch(() => eqBands[label], (val) => {
      setBiquadFilterGain(freq, val)
    })
  }

  /** 应用均衡器预设 */
  const applyPreset = (presetName: string) => {
    // 先查内置预设
    let preset = freqsPreset.find((p: { name: string }) => p.name === presetName) as any
    if (!preset) {
      // 再查高级预设
      preset = advancedEqPresets.find((p: { name: string }) => p.name === presetName) as any
    }
    if (!preset) return
    // 更新 UI 状态
    const keys = Object.keys(eqBands)
    const freqKeys = ['hz31', 'hz62', 'hz125', 'hz250', 'hz500', 'hz1000', 'hz2000', 'hz4000', 'hz8000', 'hz16000'] as const
    keys.forEach((label, i) => {
      eqBands[label] = preset[freqKeys[i]] as number
    })
    // 应用到音频节点
    applyEqPreset(preset as typeof freqsPreset[number])
  }

  /** 重置均衡器 */
  const resetEq = () => {
    for (const key of Object.keys(eqBands)) {
      eqBands[key] = 0
    }
    resetBiquadFilter()
  }

  // ===== 卷积混响 =====
  const activeConvolution = ref<string | null>(null)
  const originalGain = ref(0)
  const envGain = ref(300)

  // 监听混响选择变化
  watch(activeConvolution, async (label) => {
    if (label) {
      const conv = convolutions.find((c: { label: string }) => c.label === label)
      if (conv) {
        await setConvolver(conv.source, conv.mainGain, conv.sendGain)
        originalGain.value = Math.round(conv.mainGain * 10)
        envGain.value = Math.round(conv.sendGain * 10)
      }
    } else {
      await setConvolver(null, 0, 0)
      originalGain.value = 0
      envGain.value = 0
    }
  })

  // 监听增益变化
  watch(originalGain, (val) => {
    if (!activeConvolution.value) return
    setConvolverMainGain(val / 10)
  })

  watch(envGain, (val) => {
    if (!activeConvolution.value) return
    setConvolverSendGain(val / 10)
  })

  /** 选择/取消混响 */
  const toggleConvolution = (label: string) => {
    if (activeConvolution.value === label) {
      activeConvolution.value = null
    } else {
      activeConvolution.value = label
      activeAlgoReverb.value = null // 互斥: 取消算法混响
    }
  }

  // ===== 算法混响（程序生成 IR） =====
  const activeAlgoReverb = ref<string | null>(null)

  watch(activeAlgoReverb, async (label) => {
    await setAlgorithmicReverb(label)
    if (label) {
      activeConvolution.value = null // 互斥: 取消卷积混响
      originalGain.value = 10
      envGain.value = 20
    }
  })

  /** 选择/取消算法混响 */
  const toggleAlgoReverb = (label: string) => {
    if (activeAlgoReverb.value === label) {
      activeAlgoReverb.value = null
    } else {
      activeAlgoReverb.value = label
    }
  }

  // ===== 变调 =====
  const pitchShift = ref(100) // 百分比: 50~200

  watch(pitchShift, (val) => {
    setPitchShifter(val / 100)
  })

  /** 重置变调 */
  const resetPitch = () => {
    pitchShift.value = 100
  }

  // ===== 倍速播放 =====
  const playbackRate = ref(100) // 百分比: 50~200，对应 0.5x~2.0x

  watch(playbackRate, (val) => {
    const rate = val / 100
    setPlaybackRate(rate < 0.5 ? 0.5 : rate > 2 ? 2 : rate)
  })

  /** 重置倍速 */
  const resetPlaybackRate = () => {
    playbackRate.value = 100
  }

  // ===== 音调补偿 =====
  const preservesPitch = ref(true) // 倍速时保持音调，默认开启

  watch(preservesPitch, (val) => {
    setPreservesPitch(val)
  })

  // ===== 3D 环绕声 =====
  const enable3DSurround = ref(false)
  const surroundIntensity = ref(9) // 1~20
  const soundDistance = ref(9) // 1~20

  watch(enable3DSurround, (val) => {
    if (val) {
      disableOtherSpatial('3d')
      startPanner()
    } else {
      stopPanner()
    }
  }, { flush: 'sync' })

  watch(surroundIntensity, (val) => {
    setPannerSpeed(2 * (val / 10))
  })

  watch(soundDistance, (val) => {
    setPannerSoundR(val / 10)
  })

  // ===== 8D 环绕声 =====
  const enable8D = ref(false)
  const rotationSpeed8D = ref(10) // 旋转一圈秒数: 2~60
  const virtualDistance8D = ref(5) // 虚拟声源距离: 1~20

  watch(enable8D, (val) => {
    if (val) {
      disableOtherSpatial('8d')
      startPanner8D()
    } else {
      stopPanner8D()
    }
  }, { flush: 'sync' })

  watch(rotationSpeed8D, (val) => {
    setPanner8DSpeed(val)
  })

  watch(virtualDistance8D, (val) => {
    setPanner8DRadius(val / 5)
  })

  // ===== 36D 环绕声 =====
  // 在原 8D 基础上叠加垂直摆动 + 距离波动 + 空气低通，听感更具立体层次
  const enable36D = ref(false)
  const rotationSpeed36D = ref(10) // 旋转一圈秒数: 2~60
  const virtualDistance36D = ref(5) // 虚拟声源距离: 1~20

  watch(enable36D, (val) => {
    if (val) {
      disableOtherSpatial('36d')
      startPanner36D()
    } else {
      stopPanner36D()
    }
  }, { flush: 'sync' })

  watch(rotationSpeed36D, (val) => {
    setPanner36DSpeed(val)
  })

  watch(virtualDistance36D, (val) => {
    setPanner36DRadius(val / 5)
  })

  // ===== 95D 环绕声（双源同时旋转）=====
  // 基于本项目 36D 算法，改为双声源同时环绕：声源 A 从右侧开始 + 声源 B 从左侧开始，
  // 同步绕头旋转，形成"双星轨道"立体环绕（区别于 36D 的单源旋转）
  const enable95D = ref(false)
  const rotationSpeed95D = ref(10) // 旋转一圈秒数: 2~60
  const virtualDistance95D = ref(5) // 虚拟声源距离: 1~20

  watch(enable95D, (val) => {
    if (val) {
      disableOtherSpatial('95d')
      startPanner95D()
    } else {
      stopPanner95D()
    }
  }, { flush: 'sync' })

  watch(rotationSpeed95D, (val) => {
    setPanner95DSpeed(val)
  })

  watch(virtualDistance95D, (val) => {
    setPanner95DRadius(val / 5)
  })

  // ===== 7.1/5.1 虚拟多声道环绕 =====
  const enableVirtualSurround = ref(false)
  const virtualSurroundMode = ref<'5.1' | '7.1'>('7.1')
  const virtualSurroundSpread = ref(10) // 声场宽度: 1~20

  watch(enableVirtualSurround, (val) => {
    if (val) {
      disableOtherSpatial('virtual')
      startVirtualSurround()
    } else {
      stopVirtualSurround()
    }
  }, { flush: 'sync' })

  watch(virtualSurroundMode, (val) => {
    setVirtualSurroundMode(val)
  })

  watch(virtualSurroundSpread, (val) => {
    setVirtualSurroundSpread(val / 10)
  })

  // ===== 旋转示意图开关（UI 偏好，持久化）=====
  const showSpatialViz = ref(true)

  // ===== 空间音效互斥逻辑 =====
  // 启用一个空间音效时，自动关闭其他所有空间音效
  function disableOtherSpatial(current: string) {
    if (current !== '3d' && enable3DSurround.value) enable3DSurround.value = false
    if (current !== '8d' && enable8D.value) enable8D.value = false
    if (current !== '36d' && enable36D.value) enable36D.value = false
    if (current !== '95d' && enable95D.value) enable95D.value = false
    if (current !== 'virtual' && enableVirtualSurround.value) enableVirtualSurround.value = false
  }

  // ===== 高级音效: 消人声 =====
  const vocalRemoval = ref(false)
  watch(vocalRemoval, (v) => setVocalRemoval(v))

  // ===== 高级音效: 颤音 =====
  const vibratoEnabled = ref(false)
  const vibratoRate = ref(5)     // Hz: 1~20
  const vibratoDepth = ref(3)    // ms: 0~10
  watch(vibratoEnabled, (v) => setVibrato(v, vibratoRate.value, vibratoDepth.value))
  watch(vibratoRate, (v) => { if (vibratoEnabled.value) setVibrato(true, v, vibratoDepth.value) })
  watch(vibratoDepth, (v) => { if (vibratoEnabled.value) setVibrato(true, vibratoRate.value, v) })

  // ===== 高级音效: 动态音调漂移 =====
  const pitchDriftEnabled = ref(false)
  const pitchDriftSpeed = ref(1)   // 0.1~5 (映射到 0.01~0.5Hz)
  const pitchDriftRange = ref(10)  // ms: 0~30
  watch(pitchDriftEnabled, (v) => setPitchDrift(v, pitchDriftSpeed.value, pitchDriftRange.value))
  watch(pitchDriftSpeed, (v) => { if (pitchDriftEnabled.value) setPitchDrift(true, v, pitchDriftRange.value) })
  watch(pitchDriftRange, (v) => { if (pitchDriftEnabled.value) setPitchDrift(true, pitchDriftSpeed.value, v) })

  // ===== 高级音效: 抖音效果器 (Tremolo) =====
  const tremoloEnabled = ref(false)
  const tremoloRate = ref(6)    // Hz: 1~20
  const tremoloDepth = ref(30)  // %: 0~100
  watch(tremoloEnabled, (v) => setTremolo(v, tremoloRate.value, tremoloDepth.value))
  watch(tremoloRate, (v) => { if (tremoloEnabled.value) setTremolo(true, v, tremoloDepth.value) })
  watch(tremoloDepth, (v) => { if (tremoloEnabled.value) setTremolo(true, tremoloRate.value, v) })

  // ===== 高级音效: Bass 重低音增强 =====
  const bassBoostEnabled = ref(false)
  const bassBoostGain = ref(6)       // dB: 0~15
  const bassBoostDynamic = ref(true)  // 动态低音回弹
  watch(bassBoostEnabled, (v) => setBassBoost(v, bassBoostGain.value, bassBoostDynamic.value))
  watch(bassBoostGain, (v) => { if (bassBoostEnabled.value) setBassBoost(true, v, bassBoostDynamic.value) })
  watch(bassBoostDynamic, (v) => { if (bassBoostEnabled.value) setBassBoost(true, bassBoostGain.value, v) })

  // ===== 高级音效: 动态均衡 =====
  const dynamicEqEnabled = ref(false)
  watch(dynamicEqEnabled, (v) => setDynamicEq(v))

  // ===== 高级音效: 失真 =====
  const distortionEnabled = ref(false)
  const distortionAmount = ref(10)  // 1~100
  const distortionType = ref<'soft' | 'hard'>('soft')
  watch(distortionEnabled, (v) => setDistortion(v, distortionAmount.value, distortionType.value))
  watch(distortionAmount, (v) => { if (distortionEnabled.value) setDistortion(true, v, distortionType.value) })
  watch(distortionType, (v) => { if (distortionEnabled.value) setDistortion(true, distortionAmount.value, v) })

  // ===== 高级音效: 镶边 (Flanger) =====
  const flangerEnabled = ref(false)
  const flangerRate = ref(0.5)      // Hz: 0.1~5
  const flangerDepth = ref(2)       // ms: 0.5~5
  const flangerFeedback = ref(50)   // %: 0~90
  const flangerMix = ref(50)        // %: 0~100
  watch(flangerEnabled, (v) => setFlanger(v, flangerRate.value, flangerDepth.value, flangerFeedback.value, flangerMix.value))
  watch([flangerRate, flangerDepth, flangerFeedback, flangerMix], () => {
    if (flangerEnabled.value) setFlanger(true, flangerRate.value, flangerDepth.value, flangerFeedback.value, flangerMix.value)
  })

  // ===== 高级音效: 相位 (Phaser) =====
  const phaserEnabled = ref(false)
  const phaserRate = ref(0.5)       // Hz: 0.1~5
  const phaserDepth = ref(1)        // 0~3
  const phaserFeedback = ref(30)    // %: 0~90
  const phaserMix = ref(50)         // %: 0~100
  watch(phaserEnabled, (v) => setPhaser(v, phaserRate.value, phaserDepth.value, phaserFeedback.value, phaserMix.value))
  watch([phaserRate, phaserDepth, phaserFeedback, phaserMix], () => {
    if (phaserEnabled.value) setPhaser(true, phaserRate.value, phaserDepth.value, phaserFeedback.value, phaserMix.value)
  })

  // ===== 高级音效: 延迟回声 =====
  const delayEnabled = ref(false)
  const delayTime = ref(300)        // ms: 50~2000
  const delayFeedback = ref(40)     // %: 0~90
  const delayMix = ref(30)          // %: 0~100
  const delayType = ref<'single' | 'pingpong'>('single')
  watch(delayEnabled, (v) => setDelayEffect(v, delayTime.value / 1000, delayFeedback.value, delayMix.value, delayType.value))
  watch([delayTime, delayFeedback, delayMix, delayType], () => {
    if (delayEnabled.value) setDelayEffect(true, delayTime.value / 1000, delayFeedback.value, delayMix.value, delayType.value)
  })

  // ===== 高级音效: 压缩器 =====
  const compressorEnabled = ref(false)
  const compressorThreshold = ref(-24)  // dB: -60~0
  const compressorRatio = ref(12)       // 1:1~20:1
  const compressorAttack = ref(3)       // ms: 0~100
  const compressorRelease = ref(250)    // ms: 10~1000
  watch(compressorEnabled, (v) => setCompressor(v, compressorThreshold.value, compressorRatio.value, compressorAttack.value / 1000, compressorRelease.value / 1000))
  watch([compressorThreshold, compressorRatio, compressorAttack, compressorRelease], () => {
    if (compressorEnabled.value) setCompressor(true, compressorThreshold.value, compressorRatio.value, compressorAttack.value / 1000, compressorRelease.value / 1000)
  })

  // ===== 高级音效: Crossfeed 耳机互馈 =====
  const crossfeedEnabled = ref(false)
  const crossfeedStrength = ref(30)  // %: 0~100
  watch(crossfeedEnabled, (v) => setCrossfeed(v, crossfeedStrength.value))
  watch(crossfeedStrength, (v) => { if (crossfeedEnabled.value) setCrossfeed(true, v) })

  // ===== 高级音效: 立体声拓宽 =====
  const stereoWidenEnabled = ref(false)
  const stereoWidenAmount = ref(1.5)  // 0~3 (1=正常)
  watch(stereoWidenEnabled, (v) => setStereoWiden(v, stereoWidenAmount.value))
  watch(stereoWidenAmount, (v) => { if (stereoWidenEnabled.value) setStereoWiden(true, v) })

  // ===== 高级音效: 单声道合并 =====
  const monoMergeEnabled = ref(false)
  watch(monoMergeEnabled, (v) => setMonoMerge(v))

  // ===== 高级音效: 左右声道交换 =====
  const channelSwapEnabled = ref(false)
  watch(channelSwapEnabled, (v) => setChannelSwap(v))

  // ===== 高级音效: V4A 组合音效 =====
  const v4aEnabled = ref(false)
  watch(v4aEnabled, (v) => setV4A(v))

  // ===== 新增音效: 噪声门 =====
  const noiseGateEnabled = ref(false)
  const noiseGateThreshold = ref(-60) // dB: -80~0
  const noiseGateAttack = ref(5)     // ms: 0~100
  const noiseGateRelease = ref(50)   // ms: 10~1000
  watch(noiseGateEnabled, (v) => setNoiseGate(v, noiseGateThreshold.value, noiseGateAttack.value, noiseGateRelease.value))
  watch([noiseGateThreshold, noiseGateAttack, noiseGateRelease], () => {
    if (noiseGateEnabled.value) setNoiseGate(true, noiseGateThreshold.value, noiseGateAttack.value, noiseGateRelease.value)
  })

  // ===== 新增音效: 扩展器 =====
  const expanderEnabled = ref(false)
  const expanderThreshold = ref(-40) // dB: -80~0
  const expanderRatio = ref(2)       // 1:1~10:1
  watch(expanderEnabled, (v) => setExpander(v, expanderThreshold.value, expanderRatio.value))
  watch([expanderThreshold, expanderRatio], () => {
    if (expanderEnabled.value) setExpander(true, expanderThreshold.value, expanderRatio.value)
  })

  // ===== 新增音效: 多段压缩器 =====
  const multibandCompEnabled = ref(false)
  const mbLowFreq = ref(200)       // Hz
  const mbMidFreq = ref(2000)      // Hz
  const mbThreshold = ref(-20)     // dB
  const mbRatio = ref(3)           // 1:1~20:1
  watch(multibandCompEnabled, (v) => setMultibandCompressor(v, mbLowFreq.value, mbMidFreq.value, mbThreshold.value, mbRatio.value))
  watch([mbLowFreq, mbMidFreq, mbThreshold, mbRatio], () => {
    if (multibandCompEnabled.value) setMultibandCompressor(true, mbLowFreq.value, mbMidFreq.value, mbThreshold.value, mbRatio.value)
  })

  // ===== 新增音效: 限制器 =====
  const limiterEnabled = ref(false)
  const limiterThreshold = ref(-1) // dB: -10~0
  watch(limiterEnabled, (v) => setLimiter(v, limiterThreshold.value))
  watch(limiterThreshold, (v) => { if (limiterEnabled.value) setLimiter(true, v) })

  // ===== 新增音效: 谐波激励器 =====
  const exciterEnabled = ref(false)
  const exciterAmount = ref(20)    // %: 0~100
  const exciterFrequency = ref(3000) // Hz: 1000~8000
  watch(exciterEnabled, (v) => setExciter(v, exciterAmount.value, exciterFrequency.value))
  watch([exciterAmount, exciterFrequency], () => {
    if (exciterEnabled.value) setExciter(true, exciterAmount.value, exciterFrequency.value)
  })

  // ===== 新增音效: 次谐波低音增强 =====
  const subBassEnabled = ref(false)
  const subBassAmount = ref(30)    // %: 0~100
  const subBassFrequency = ref(120) // Hz: 50~250
  watch(subBassEnabled, (v) => setSubBass(v, subBassAmount.value, subBassFrequency.value))
  watch([subBassAmount, subBassFrequency], () => {
    if (subBassEnabled.value) setSubBass(true, subBassAmount.value, subBassFrequency.value)
  })

  // ===== 新增音效: 去齿音 =====
  const deEsserEnabled = ref(false)
  const deEsserThreshold = ref(-20) // dB: -60~0
  const deEsserFrequency = ref(6000) // Hz: 3000~10000
  watch(deEsserEnabled, (v) => setDeEsser(v, deEsserThreshold.value, deEsserFrequency.value))
  watch([deEsserThreshold, deEsserFrequency], () => {
    if (deEsserEnabled.value) setDeEsser(true, deEsserThreshold.value, deEsserFrequency.value)
  })

  // ===== 新增音效: 自动增益 (AGC) =====
  const agcEnabled = ref(false)
  const agcTargetLevel = ref(50)   // 0~100
  watch(agcEnabled, (v) => setAGC(v, agcTargetLevel.value))
  watch(agcTargetLevel, (v) => { if (agcEnabled.value) setAGC(true, v) })

  // ===== 新增音效: Lo-Fi 低保真 =====
  const loFiEnabled = ref(false)
  const loFiSampleRate = ref(8000) // Hz: 2000~22050
  const loFiBitDepth = ref(8)      // bits: 4~16
  const loFiNoise = ref(20)        // %: 0~100
  watch(loFiEnabled, (v) => setLoFi(v, loFiSampleRate.value, loFiBitDepth.value, loFiNoise.value))
  watch([loFiSampleRate, loFiBitDepth, loFiNoise], () => {
    if (loFiEnabled.value) setLoFi(true, loFiSampleRate.value, loFiBitDepth.value, loFiNoise.value)
  })

  // ===== 新增音效: 比特粉碎 =====
  const bitcrushEnabled = ref(false)
  const bitcrushBits = ref(6)      // bits: 2~16
  watch(bitcrushEnabled, (v) => setBitcrush(v, bitcrushBits.value))
  watch(bitcrushBits, (v) => { if (bitcrushEnabled.value) setBitcrush(true, v) })

  // ===== 新增音效: 立体声分离度 (M/S) =====
  const stereoSeparationEnabled = ref(false)
  const ssWidth = ref(100)         // %: 0~200
  const ssCenterLevel = ref(100)   // %: 0~200
  watch(stereoSeparationEnabled, (v) => setStereoSeparation(v, ssWidth.value, ssCenterLevel.value))
  watch([ssWidth, ssCenterLevel], () => {
    if (stereoSeparationEnabled.value) setStereoSeparation(true, ssWidth.value, ssCenterLevel.value)
  })

  // ===== AB 对比旁通 =====
  const bypassAll = ref(false)
  watch(bypassAll, (v) => setBypass(v))

  // ===== 音频性能增强 =====
  // 0-100 级别控制，值越高 CPU/内存占用越大，音频处理精度越高
  const audioBoost = ref(60)
  watch(audioBoost, (v) => setAudioBoost(v), { immediate: true })

  // ===== 自定义 EQ 预设保存/导入/导出 =====
  const customEqPresets = ref<Array<{ name: string; bands: Record<string, number> }>>([])
  const saveCustomEqPreset = (name: string) => {
    const preset = { name, bands: { ...eqBands } }
    const idx = customEqPresets.value.findIndex(p => p.name === name)
    if (idx >= 0) {
      customEqPresets.value[idx] = preset
    } else {
      customEqPresets.value.push(preset)
    }
  }
  const loadCustomEqPreset = (name: string) => {
    const preset = customEqPresets.value.find(p => p.name === name)
    if (!preset) return
    for (const key of Object.keys(eqBands)) {
      eqBands[key] = preset.bands[key] || 0
    }
  }
  const deleteCustomEqPreset = (name: string) => {
    customEqPresets.value = customEqPresets.value.filter(p => p.name !== name)
  }
  const exportEqPresets = () => {
    return JSON.stringify(customEqPresets.value)
  }
  const importEqPresets = (json: string) => {
    try {
      const parsed = JSON.parse(json)
      if (Array.isArray(parsed)) {
        customEqPresets.value = parsed
      }
    } catch {}
  }

  // ===== 整套音效预设保存/加载 =====
  const fullEffectPresets = ref<Array<{ name: string; state: Record<string, unknown> }>>([])
  const saveFullEffectPreset = (name: string) => {
    const snapshot = {
      eqBands: { ...eqBands },
      activeConvolution: activeConvolution.value,
      activeAlgoReverb: activeAlgoReverb.value,
      vocalRemoval: vocalRemoval.value,
      noiseGateEnabled: noiseGateEnabled.value,
      expanderEnabled: expanderEnabled.value,
      vibratoEnabled: vibratoEnabled.value,
      pitchDriftEnabled: pitchDriftEnabled.value,
      tremoloEnabled: tremoloEnabled.value,
      bassBoostEnabled: bassBoostEnabled.value,
      subBassEnabled: subBassEnabled.value,
      dynamicEqEnabled: dynamicEqEnabled.value,
      exciterEnabled: exciterEnabled.value,
      deEsserEnabled: deEsserEnabled.value,
      distortionEnabled: distortionEnabled.value,
      flangerEnabled: flangerEnabled.value,
      phaserEnabled: phaserEnabled.value,
      delayEnabled: delayEnabled.value,
      compressorEnabled: compressorEnabled.value,
      multibandCompEnabled: multibandCompEnabled.value,
      limiterEnabled: limiterEnabled.value,
      agcEnabled: agcEnabled.value,
      loFiEnabled: loFiEnabled.value,
      bitcrushEnabled: bitcrushEnabled.value,
      stereoSeparationEnabled: stereoSeparationEnabled.value,
      crossfeedEnabled: crossfeedEnabled.value,
      stereoWidenEnabled: stereoWidenEnabled.value,
      v4aEnabled: v4aEnabled.value,
    }
    const idx = fullEffectPresets.value.findIndex(p => p.name === name)
    if (idx >= 0) {
      fullEffectPresets.value[idx] = { name, state: snapshot }
    } else {
      fullEffectPresets.value.push({ name, state: snapshot })
    }
  }
  const loadFullEffectPreset = (name: string) => {
    const preset = fullEffectPresets.value.find(p => p.name === name)
    if (!preset) return
    const s = preset.state as any
    // 恢复 EQ
    if (s.eqBands) for (const key of Object.keys(eqBands)) eqBands[key] = s.eqBands[key] || 0
    // 恢复混响
    activeConvolution.value = s.activeConvolution || null
    activeAlgoReverb.value = s.activeAlgoReverb || null
    // 恢复音效开关
    vocalRemoval.value = !!s.vocalRemoval
    noiseGateEnabled.value = !!s.noiseGateEnabled
    expanderEnabled.value = !!s.expanderEnabled
    vibratoEnabled.value = !!s.vibratoEnabled
    pitchDriftEnabled.value = !!s.pitchDriftEnabled
    tremoloEnabled.value = !!s.tremoloEnabled
    bassBoostEnabled.value = !!s.bassBoostEnabled
    subBassEnabled.value = !!s.subBassEnabled
    dynamicEqEnabled.value = !!s.dynamicEqEnabled
    exciterEnabled.value = !!s.exciterEnabled
    deEsserEnabled.value = !!s.deEsserEnabled
    distortionEnabled.value = !!s.distortionEnabled
    flangerEnabled.value = !!s.flangerEnabled
    phaserEnabled.value = !!s.phaserEnabled
    delayEnabled.value = !!s.delayEnabled
    compressorEnabled.value = !!s.compressorEnabled
    multibandCompEnabled.value = !!s.multibandCompEnabled
    limiterEnabled.value = !!s.limiterEnabled
    agcEnabled.value = !!s.agcEnabled
    loFiEnabled.value = !!s.loFiEnabled
    bitcrushEnabled.value = !!s.bitcrushEnabled
    stereoSeparationEnabled.value = !!s.stereoSeparationEnabled
    crossfeedEnabled.value = !!s.crossfeedEnabled
    stereoWidenEnabled.value = !!s.stereoWidenEnabled
    v4aEnabled.value = !!s.v4aEnabled
  }

  /** 重置所有高级音效 */
  const resetAllAdvanced = () => {
    vocalRemoval.value = false
    noiseGateEnabled.value = false
    expanderEnabled.value = false
    vibratoEnabled.value = false
    pitchDriftEnabled.value = false
    tremoloEnabled.value = false
    bassBoostEnabled.value = false
    subBassEnabled.value = false
    dynamicEqEnabled.value = false
    exciterEnabled.value = false
    deEsserEnabled.value = false
    distortionEnabled.value = false
    flangerEnabled.value = false
    phaserEnabled.value = false
    delayEnabled.value = false
    compressorEnabled.value = false
    multibandCompEnabled.value = false
    limiterEnabled.value = false
    agcEnabled.value = false
    loFiEnabled.value = false
    bitcrushEnabled.value = false
    stereoSeparationEnabled.value = false
    crossfeedEnabled.value = false
    stereoWidenEnabled.value = false
    monoMergeEnabled.value = false
    channelSwapEnabled.value = false
    v4aEnabled.value = false
    activeAlgoReverb.value = null
    resetAllAdvancedEffects()
  }

  // ===== 音频元素连接 =====
  /** 将音频元素连接到音效处理链 */
  const connectAudio = async (audio: HTMLAudioElement) => {
    await connectAudioElement(audio)
  }

  /** 断开音频元素 */
  const disconnectAudio = () => {
    disconnectAudioElement()
  }

  // ===== [USB 独占模式] 同步音效参数到 Rust 后端 =====
  /** 将前端音效状态转换为 Rust EffectParams */
  const buildEffectParams = (): EffectParams => {
    const settingsStore = useSettingsStore()
    const usbEnabled = settingsStore.settings.audio.usbExclusiveEnabled === true

    // 均衡器：将 eqBands 转换为 EqBand 数组
    const freqLabelMap: Record<string, number> = {
      '31': 31, '62': 62, '125': 125, '250': 250, '500': 500,
      '1k': 1000, '2k': 2000, '4k': 4000, '8k': 8000, '16k': 16000,
    }
    const equalizer = Object.keys(eqBands).map(label => ({
      frequency: freqLabelMap[label] || 0,
      gain: eqBands[label],
      q: 1.41,
    }))

    // 混响：从卷积混响映射
    const reverbEnabled = activeConvolution.value !== null
    const reverb = {
      enabled: reverbEnabled,
      mix: Math.min(1, originalGain.value / 10),
      roomSize: 0.5,
      damping: 0.5,
    }

    // 环绕：从所有空间音效映射
    const surround = {
      enabled: enable3DSurround.value || enable8D.value || enable36D.value ||
        enable95D.value || enableVirtualSurround.value,
      width: Math.min(2, Math.max(0, surroundIntensity.value / 10)),
    }

    // 变调：从 pitchShift 百分比映射到半音数（100% = 0 半音, 200% = +12, 50% = -12）
    const pitchShiftSemitones = ((pitchShift.value - 100) / 100) * 12

    // 是否有任何音效启用
    const anyEffectActive = reverbEnabled || enable3DSurround.value || enable8D.value ||
      enable36D.value || enable95D.value || enableVirtualSurround.value ||
      pitchShift.value !== 100 ||
      Object.values(eqBands).some(g => g !== 0)

    return {
      enabled: usbEnabled && anyEffectActive,
      pitchShiftSemitones,
      equalizer,
      reverb,
      surround,
    }
  }

  /** 同步音效参数到 Rust 后端（仅 USB 独占模式启用时生效） */
  const syncEffectsToBackend = () => {
    const settingsStore = useSettingsStore()
    if (settingsStore.settings.audio.usbExclusiveEnabled !== true) return
    const params = buildEffectParams()
    void playbackApi.setAudioEffects(params).catch(() => {})
  }

  // 监听所有音效参数变化，同步到 Rust 后端
  watch([eqBands, activeConvolution, originalGain, enable3DSurround, surroundIntensity, enable8D, rotationSpeed8D, virtualDistance8D, pitchShift,
    enable36D, rotationSpeed36D, virtualDistance36D,
    enable95D, rotationSpeed95D, virtualDistance95D,
    enableVirtualSurround, virtualSurroundMode, virtualSurroundSpread,
  ], () => {
    syncEffectsToBackend()
  }, { deep: true })

  // ===== [音效持久化] 收集全部需要保存的状态 =====
  // 用户关闭软件后所有音效设置都应保留，只有设置里点「清除所有数据」才会清空。
  // 恢复时直接赋值到 ref，由上方已有的 watch 把值应用到 audio engine（幂等）。
  const buildEffectSnapshot = () => ({
    eqBands: { ...eqBands },
    activeConvolution: activeConvolution.value,
    originalGain: originalGain.value,
    envGain: envGain.value,
    activeAlgoReverb: activeAlgoReverb.value,
    pitchShift: pitchShift.value,
    playbackRate: playbackRate.value,
    preservesPitch: preservesPitch.value,
    enable3DSurround: enable3DSurround.value,
    surroundIntensity: surroundIntensity.value,
    soundDistance: soundDistance.value,
    enable8D: enable8D.value,
    rotationSpeed8D: rotationSpeed8D.value,
    virtualDistance8D: virtualDistance8D.value,
    enable36D: enable36D.value,
    rotationSpeed36D: rotationSpeed36D.value,
    virtualDistance36D: virtualDistance36D.value,
    enable95D: enable95D.value,
    rotationSpeed95D: rotationSpeed95D.value,
    virtualDistance95D: virtualDistance95D.value,
    enableVirtualSurround: enableVirtualSurround.value,
    virtualSurroundMode: virtualSurroundMode.value,
    virtualSurroundSpread: virtualSurroundSpread.value,
    vocalRemoval: vocalRemoval.value,
    vibratoEnabled: vibratoEnabled.value,
    vibratoRate: vibratoRate.value,
    vibratoDepth: vibratoDepth.value,
    pitchDriftEnabled: pitchDriftEnabled.value,
    pitchDriftSpeed: pitchDriftSpeed.value,
    pitchDriftRange: pitchDriftRange.value,
    tremoloEnabled: tremoloEnabled.value,
    tremoloRate: tremoloRate.value,
    tremoloDepth: tremoloDepth.value,
    bassBoostEnabled: bassBoostEnabled.value,
    bassBoostGain: bassBoostGain.value,
    bassBoostDynamic: bassBoostDynamic.value,
    dynamicEqEnabled: dynamicEqEnabled.value,
    distortionEnabled: distortionEnabled.value,
    distortionAmount: distortionAmount.value,
    distortionType: distortionType.value,
    flangerEnabled: flangerEnabled.value,
    flangerRate: flangerRate.value,
    flangerDepth: flangerDepth.value,
    flangerFeedback: flangerFeedback.value,
    flangerMix: flangerMix.value,
    phaserEnabled: phaserEnabled.value,
    phaserRate: phaserRate.value,
    phaserDepth: phaserDepth.value,
    phaserFeedback: phaserFeedback.value,
    phaserMix: phaserMix.value,
    delayEnabled: delayEnabled.value,
    delayTime: delayTime.value,
    delayFeedback: delayFeedback.value,
    delayMix: delayMix.value,
    delayType: delayType.value,
    compressorEnabled: compressorEnabled.value,
    compressorThreshold: compressorThreshold.value,
    compressorRatio: compressorRatio.value,
    compressorAttack: compressorAttack.value,
    compressorRelease: compressorRelease.value,
    crossfeedEnabled: crossfeedEnabled.value,
    crossfeedStrength: crossfeedStrength.value,
    stereoWidenEnabled: stereoWidenEnabled.value,
    stereoWidenAmount: stereoWidenAmount.value,
    monoMergeEnabled: monoMergeEnabled.value,
    channelSwapEnabled: channelSwapEnabled.value,
    v4aEnabled: v4aEnabled.value,
    noiseGateEnabled: noiseGateEnabled.value,
    noiseGateThreshold: noiseGateThreshold.value,
    noiseGateAttack: noiseGateAttack.value,
    noiseGateRelease: noiseGateRelease.value,
    expanderEnabled: expanderEnabled.value,
    expanderThreshold: expanderThreshold.value,
    expanderRatio: expanderRatio.value,
    multibandCompEnabled: multibandCompEnabled.value,
    mbLowFreq: mbLowFreq.value,
    mbMidFreq: mbMidFreq.value,
    mbThreshold: mbThreshold.value,
    mbRatio: mbRatio.value,
    limiterEnabled: limiterEnabled.value,
    limiterThreshold: limiterThreshold.value,
    exciterEnabled: exciterEnabled.value,
    exciterAmount: exciterAmount.value,
    exciterFrequency: exciterFrequency.value,
    subBassEnabled: subBassEnabled.value,
    subBassAmount: subBassAmount.value,
    subBassFrequency: subBassFrequency.value,
    deEsserEnabled: deEsserEnabled.value,
    deEsserThreshold: deEsserThreshold.value,
    deEsserFrequency: deEsserFrequency.value,
    agcEnabled: agcEnabled.value,
    agcTargetLevel: agcTargetLevel.value,
    loFiEnabled: loFiEnabled.value,
    loFiSampleRate: loFiSampleRate.value,
    loFiBitDepth: loFiBitDepth.value,
    loFiNoise: loFiNoise.value,
    bitcrushEnabled: bitcrushEnabled.value,
    bitcrushBits: bitcrushBits.value,
    stereoSeparationEnabled: stereoSeparationEnabled.value,
    ssWidth: ssWidth.value,
    ssCenterLevel: ssCenterLevel.value,
    bypassAll: bypassAll.value,
    audioBoost: audioBoost.value,
    customEqPresets: customEqPresets.value,
    fullEffectPresets: fullEffectPresets.value,
    showSpatialViz: showSpatialViz.value,
  })

  // 从快照恢复到各 ref。直接赋值即可，上方 watch 会把变更应用到音频引擎。
  const applyEffectSnapshot = (s: ReturnType<typeof buildEffectSnapshot>) => {
    if (s.eqBands && typeof s.eqBands === 'object') {
      for (const key of Object.keys(eqBands)) {
        const v = (s.eqBands as Record<string, number>)[key]
        if (typeof v === 'number') eqBands[key] = v
      }
    }
    if (typeof s.activeConvolution === 'string' || s.activeConvolution === null) activeConvolution.value = s.activeConvolution as string | null
    if (typeof s.originalGain === 'number') originalGain.value = s.originalGain
    if (typeof s.envGain === 'number') envGain.value = s.envGain
    if (typeof s.activeAlgoReverb === 'string' || s.activeAlgoReverb === null) activeAlgoReverb.value = s.activeAlgoReverb as string | null
    if (typeof s.pitchShift === 'number') pitchShift.value = s.pitchShift
    if (typeof s.playbackRate === 'number') playbackRate.value = s.playbackRate
    if (typeof s.preservesPitch === 'boolean') preservesPitch.value = s.preservesPitch
    if (typeof s.enable3DSurround === 'boolean') enable3DSurround.value = s.enable3DSurround
    if (typeof s.surroundIntensity === 'number') surroundIntensity.value = s.surroundIntensity
    if (typeof s.soundDistance === 'number') soundDistance.value = s.soundDistance
    if (typeof s.enable8D === 'boolean') enable8D.value = s.enable8D
    if (typeof s.rotationSpeed8D === 'number') rotationSpeed8D.value = s.rotationSpeed8D
    if (typeof s.virtualDistance8D === 'number') virtualDistance8D.value = s.virtualDistance8D
    // [修复防御: 持久化兼容] 36D 音效经历过两次重命名(4D → 8DReset → 36D)，需兼容全部历史字段:
    //  - 旧 enable4D=true / enable8DReset=true → 启用 36D（避免老用户启用状态丢失）
    //  - 旧 rotationSpeed4D / rotationSpeed8DReset → 迁移为 rotationSpeed36D（参数语义一致：秒/圈）
    //  - 旧 depthIntensity4D → 丢弃（36D 无此参数，由虚拟距离替代）
    if (typeof s.enable36D === 'boolean') {
      enable36D.value = s.enable36D
    } else if ((s as any).enable8DReset === true || (s as any).enable4D === true) {
      enable36D.value = true
    }
    if (typeof s.rotationSpeed36D === 'number') {
      rotationSpeed36D.value = s.rotationSpeed36D
    } else if (typeof (s as any).rotationSpeed8DReset === 'number') {
      rotationSpeed36D.value = (s as any).rotationSpeed8DReset
    } else if (typeof (s as any).rotationSpeed4D === 'number') {
      rotationSpeed36D.value = (s as any).rotationSpeed4D
    }
    if (typeof s.virtualDistance36D === 'number') {
      virtualDistance36D.value = s.virtualDistance36D
    } else if (typeof (s as any).virtualDistance8DReset === 'number') {
      virtualDistance36D.value = (s as any).virtualDistance8DReset
    }
    if (typeof s.enable95D === 'boolean') enable95D.value = s.enable95D
    if (typeof s.rotationSpeed95D === 'number') rotationSpeed95D.value = s.rotationSpeed95D
    if (typeof s.virtualDistance95D === 'number') virtualDistance95D.value = s.virtualDistance95D
    if (typeof s.enableVirtualSurround === 'boolean') enableVirtualSurround.value = s.enableVirtualSurround
    if (s.virtualSurroundMode === '5.1' || s.virtualSurroundMode === '7.1') virtualSurroundMode.value = s.virtualSurroundMode
    if (typeof s.virtualSurroundSpread === 'number') virtualSurroundSpread.value = s.virtualSurroundSpread
    if (typeof s.vocalRemoval === 'boolean') vocalRemoval.value = s.vocalRemoval
    if (typeof s.vibratoEnabled === 'boolean') vibratoEnabled.value = s.vibratoEnabled
    if (typeof s.vibratoRate === 'number') vibratoRate.value = s.vibratoRate
    if (typeof s.vibratoDepth === 'number') vibratoDepth.value = s.vibratoDepth
    if (typeof s.pitchDriftEnabled === 'boolean') pitchDriftEnabled.value = s.pitchDriftEnabled
    if (typeof s.pitchDriftSpeed === 'number') pitchDriftSpeed.value = s.pitchDriftSpeed
    if (typeof s.pitchDriftRange === 'number') pitchDriftRange.value = s.pitchDriftRange
    if (typeof s.tremoloEnabled === 'boolean') tremoloEnabled.value = s.tremoloEnabled
    if (typeof s.tremoloRate === 'number') tremoloRate.value = s.tremoloRate
    if (typeof s.tremoloDepth === 'number') tremoloDepth.value = s.tremoloDepth
    if (typeof s.bassBoostEnabled === 'boolean') bassBoostEnabled.value = s.bassBoostEnabled
    if (typeof s.bassBoostGain === 'number') bassBoostGain.value = s.bassBoostGain
    if (typeof s.bassBoostDynamic === 'boolean') bassBoostDynamic.value = s.bassBoostDynamic
    if (typeof s.dynamicEqEnabled === 'boolean') dynamicEqEnabled.value = s.dynamicEqEnabled
    if (typeof s.distortionEnabled === 'boolean') distortionEnabled.value = s.distortionEnabled
    if (typeof s.distortionAmount === 'number') distortionAmount.value = s.distortionAmount
    if (s.distortionType === 'soft' || s.distortionType === 'hard') distortionType.value = s.distortionType
    if (typeof s.flangerEnabled === 'boolean') flangerEnabled.value = s.flangerEnabled
    if (typeof s.flangerRate === 'number') flangerRate.value = s.flangerRate
    if (typeof s.flangerDepth === 'number') flangerDepth.value = s.flangerDepth
    if (typeof s.flangerFeedback === 'number') flangerFeedback.value = s.flangerFeedback
    if (typeof s.flangerMix === 'number') flangerMix.value = s.flangerMix
    if (typeof s.phaserEnabled === 'boolean') phaserEnabled.value = s.phaserEnabled
    if (typeof s.phaserRate === 'number') phaserRate.value = s.phaserRate
    if (typeof s.phaserDepth === 'number') phaserDepth.value = s.phaserDepth
    if (typeof s.phaserFeedback === 'number') phaserFeedback.value = s.phaserFeedback
    if (typeof s.phaserMix === 'number') phaserMix.value = s.phaserMix
    if (typeof s.delayEnabled === 'boolean') delayEnabled.value = s.delayEnabled
    if (typeof s.delayTime === 'number') delayTime.value = s.delayTime
    if (typeof s.delayFeedback === 'number') delayFeedback.value = s.delayFeedback
    if (typeof s.delayMix === 'number') delayMix.value = s.delayMix
    if (s.delayType === 'single' || s.delayType === 'pingpong') delayType.value = s.delayType
    if (typeof s.compressorEnabled === 'boolean') compressorEnabled.value = s.compressorEnabled
    if (typeof s.compressorThreshold === 'number') compressorThreshold.value = s.compressorThreshold
    if (typeof s.compressorRatio === 'number') compressorRatio.value = s.compressorRatio
    if (typeof s.compressorAttack === 'number') compressorAttack.value = s.compressorAttack
    if (typeof s.compressorRelease === 'number') compressorRelease.value = s.compressorRelease
    if (typeof s.crossfeedEnabled === 'boolean') crossfeedEnabled.value = s.crossfeedEnabled
    if (typeof s.crossfeedStrength === 'number') crossfeedStrength.value = s.crossfeedStrength
    if (typeof s.stereoWidenEnabled === 'boolean') stereoWidenEnabled.value = s.stereoWidenEnabled
    if (typeof s.stereoWidenAmount === 'number') stereoWidenAmount.value = s.stereoWidenAmount
    if (typeof s.monoMergeEnabled === 'boolean') monoMergeEnabled.value = s.monoMergeEnabled
    if (typeof s.channelSwapEnabled === 'boolean') channelSwapEnabled.value = s.channelSwapEnabled
    if (typeof s.v4aEnabled === 'boolean') v4aEnabled.value = s.v4aEnabled
    if (typeof s.noiseGateEnabled === 'boolean') noiseGateEnabled.value = s.noiseGateEnabled
    if (typeof s.noiseGateThreshold === 'number') noiseGateThreshold.value = s.noiseGateThreshold
    if (typeof s.noiseGateAttack === 'number') noiseGateAttack.value = s.noiseGateAttack
    if (typeof s.noiseGateRelease === 'number') noiseGateRelease.value = s.noiseGateRelease
    if (typeof s.expanderEnabled === 'boolean') expanderEnabled.value = s.expanderEnabled
    if (typeof s.expanderThreshold === 'number') expanderThreshold.value = s.expanderThreshold
    if (typeof s.expanderRatio === 'number') expanderRatio.value = s.expanderRatio
    if (typeof s.multibandCompEnabled === 'boolean') multibandCompEnabled.value = s.multibandCompEnabled
    if (typeof s.mbLowFreq === 'number') mbLowFreq.value = s.mbLowFreq
    if (typeof s.mbMidFreq === 'number') mbMidFreq.value = s.mbMidFreq
    if (typeof s.mbThreshold === 'number') mbThreshold.value = s.mbThreshold
    if (typeof s.mbRatio === 'number') mbRatio.value = s.mbRatio
    if (typeof s.limiterEnabled === 'boolean') limiterEnabled.value = s.limiterEnabled
    if (typeof s.limiterThreshold === 'number') limiterThreshold.value = s.limiterThreshold
    if (typeof s.exciterEnabled === 'boolean') exciterEnabled.value = s.exciterEnabled
    if (typeof s.exciterAmount === 'number') exciterAmount.value = s.exciterAmount
    if (typeof s.exciterFrequency === 'number') exciterFrequency.value = s.exciterFrequency
    if (typeof s.subBassEnabled === 'boolean') subBassEnabled.value = s.subBassEnabled
    if (typeof s.subBassAmount === 'number') subBassAmount.value = s.subBassAmount
    if (typeof s.subBassFrequency === 'number') subBassFrequency.value = s.subBassFrequency
    if (typeof s.deEsserEnabled === 'boolean') deEsserEnabled.value = s.deEsserEnabled
    if (typeof s.deEsserThreshold === 'number') deEsserThreshold.value = s.deEsserThreshold
    if (typeof s.deEsserFrequency === 'number') deEsserFrequency.value = s.deEsserFrequency
    if (typeof s.agcEnabled === 'boolean') agcEnabled.value = s.agcEnabled
    if (typeof s.agcTargetLevel === 'number') agcTargetLevel.value = s.agcTargetLevel
    if (typeof s.loFiEnabled === 'boolean') loFiEnabled.value = s.loFiEnabled
    if (typeof s.loFiSampleRate === 'number') loFiSampleRate.value = s.loFiSampleRate
    if (typeof s.loFiBitDepth === 'number') loFiBitDepth.value = s.loFiBitDepth
    if (typeof s.loFiNoise === 'number') loFiNoise.value = s.loFiNoise
    if (typeof s.bitcrushEnabled === 'boolean') bitcrushEnabled.value = s.bitcrushEnabled
    if (typeof s.bitcrushBits === 'number') bitcrushBits.value = s.bitcrushBits
    if (typeof s.stereoSeparationEnabled === 'boolean') stereoSeparationEnabled.value = s.stereoSeparationEnabled
    if (typeof s.ssWidth === 'number') ssWidth.value = s.ssWidth
    if (typeof s.ssCenterLevel === 'number') ssCenterLevel.value = s.ssCenterLevel
    if (typeof s.bypassAll === 'boolean') bypassAll.value = s.bypassAll
    if (typeof s.audioBoost === 'number') audioBoost.value = s.audioBoost
    if (Array.isArray(s.customEqPresets)) customEqPresets.value = s.customEqPresets
    if (Array.isArray(s.fullEffectPresets)) fullEffectPresets.value = s.fullEffectPresets
    if (typeof s.showSpatialViz === 'boolean') showSpatialViz.value = s.showSpatialViz
  }

  // ===== [音效持久化] 启动恢复 =====
  try {
    const savedEffect = playerStorage.readObject<ReturnType<typeof buildEffectSnapshot>>(
      playerStorageKeys.soundEffectState,
    )
    if (savedEffect && typeof savedEffect === 'object') {
      applyEffectSnapshot(savedEffect)
    }
  } catch (err) {
    console.warn('[soundEffectStore] 恢复音效状态失败（使用默认值）:', err)
  }

  // ===== [音效持久化] 变更时保存（防抖，避免拖动滑块时频繁写入）=====
  let effectPersistTimer: ReturnType<typeof setTimeout> | null = null
  const persistEffectState = () => {
    if (effectPersistTimer) clearTimeout(effectPersistTimer)
    effectPersistTimer = setTimeout(() => {
      try {
        localStore.setJson(playerStorageKeys.soundEffectState, buildEffectSnapshot())
      } catch (err) {
        console.warn('[soundEffectStore] 保存音效状态失败:', err)
      }
    }, 150)
  }

  watch(
    [
      eqBands, activeConvolution, originalGain, envGain, activeAlgoReverb,
      pitchShift, playbackRate, preservesPitch,
      enable3DSurround, surroundIntensity, soundDistance,
      enable8D, rotationSpeed8D, virtualDistance8D,
      enable36D, rotationSpeed36D, virtualDistance36D,
      enable95D, rotationSpeed95D, virtualDistance95D,
      enableVirtualSurround, virtualSurroundMode, virtualSurroundSpread,
      vocalRemoval,
      vibratoEnabled, vibratoRate, vibratoDepth,
      pitchDriftEnabled, pitchDriftSpeed, pitchDriftRange,
      tremoloEnabled, tremoloRate, tremoloDepth,
      bassBoostEnabled, bassBoostGain, bassBoostDynamic,
      dynamicEqEnabled,
      distortionEnabled, distortionAmount, distortionType,
      flangerEnabled, flangerRate, flangerDepth, flangerFeedback, flangerMix,
      phaserEnabled, phaserRate, phaserDepth, phaserFeedback, phaserMix,
      delayEnabled, delayTime, delayFeedback, delayMix, delayType,
      compressorEnabled, compressorThreshold, compressorRatio, compressorAttack, compressorRelease,
      crossfeedEnabled, crossfeedStrength,
      stereoWidenEnabled, stereoWidenAmount,
      monoMergeEnabled, channelSwapEnabled, v4aEnabled,
      noiseGateEnabled, noiseGateThreshold, noiseGateAttack, noiseGateRelease,
      expanderEnabled, expanderThreshold, expanderRatio,
      multibandCompEnabled, mbLowFreq, mbMidFreq, mbThreshold, mbRatio,
      limiterEnabled, limiterThreshold,
      exciterEnabled, exciterAmount, exciterFrequency,
      subBassEnabled, subBassAmount, subBassFrequency,
      deEsserEnabled, deEsserThreshold, deEsserFrequency,
      agcEnabled, agcTargetLevel,
      loFiEnabled, loFiSampleRate, loFiBitDepth, loFiNoise,
      bitcrushEnabled, bitcrushBits,
      stereoSeparationEnabled, ssWidth, ssCenterLevel,
      bypassAll, audioBoost,
      customEqPresets, fullEffectPresets,
      showSpatialViz,
    ],
    persistEffectState,
    { deep: true },
  )

  return {
    // 均衡器
    eqBands,
    applyPreset,
    resetEq,
    // 卷积混响
    activeConvolution,
    originalGain,
    envGain,
    toggleConvolution,
    // 算法混响
    activeAlgoReverb,
    toggleAlgoReverb,
    // 变调
    pitchShift,
    resetPitch,
    // 倍速播放
    playbackRate,
    resetPlaybackRate,
    // 音调补偿
    preservesPitch,
    // 3D 环绕
    enable3DSurround,
    surroundIntensity,
    soundDistance,
    // 8D 环绕
    enable8D,
    rotationSpeed8D,
    virtualDistance8D,
    // 36D 环绕
    enable36D,
    rotationSpeed36D,
    virtualDistance36D,
    // 95D 环绕
    enable95D,
    rotationSpeed95D,
    virtualDistance95D,
    // 7.1/5.1 虚拟多声道环绕
    enableVirtualSurround,
    virtualSurroundMode,
    virtualSurroundSpread,
    // 旋转示意图开关
    showSpatialViz,
    // 高级音效: 消人声
    vocalRemoval,
    // 高级音效: 颤音
    vibratoEnabled, vibratoRate, vibratoDepth,
    // 高级音效: 动态音调漂移
    pitchDriftEnabled, pitchDriftSpeed, pitchDriftRange,
    // 高级音效: 抖音效果器
    tremoloEnabled, tremoloRate, tremoloDepth,
    // 高级音效: Bass 重低音增强
    bassBoostEnabled, bassBoostGain, bassBoostDynamic,
    // 高级音效: 动态均衡
    dynamicEqEnabled,
    // 高级音效: 失真
    distortionEnabled, distortionAmount, distortionType,
    // 高级音效: 镶边
    flangerEnabled, flangerRate, flangerDepth, flangerFeedback, flangerMix,
    // 高级音效: 相位
    phaserEnabled, phaserRate, phaserDepth, phaserFeedback, phaserMix,
    // 高级音效: 延迟回声
    delayEnabled, delayTime, delayFeedback, delayMix, delayType,
    // 高级音效: 压缩器
    compressorEnabled, compressorThreshold, compressorRatio, compressorAttack, compressorRelease,
    // 高级音效: Crossfeed
    crossfeedEnabled, crossfeedStrength,
    // 高级音效: 立体声拓宽
    stereoWidenEnabled, stereoWidenAmount,
    // 高级音效: 单声道合并
    monoMergeEnabled,
    // 高级音效: 声道交换
    channelSwapEnabled,
    // 高级音效: V4A 组合
    v4aEnabled,
    // 新增: 噪声门
    noiseGateEnabled, noiseGateThreshold, noiseGateAttack, noiseGateRelease,
    // 新增: 扩展器
    expanderEnabled, expanderThreshold, expanderRatio,
    // 新增: 多段压缩器
    multibandCompEnabled, mbLowFreq, mbMidFreq, mbThreshold, mbRatio,
    // 新增: 限制器
    limiterEnabled, limiterThreshold,
    // 新增: 谐波激励器
    exciterEnabled, exciterAmount, exciterFrequency,
    // 新增: 次谐波低音增强
    subBassEnabled, subBassAmount, subBassFrequency,
    // 新增: 去齿音
    deEsserEnabled, deEsserThreshold, deEsserFrequency,
    // 新增: 自动增益
    agcEnabled, agcTargetLevel,
    // 新增: Lo-Fi
    loFiEnabled, loFiSampleRate, loFiBitDepth, loFiNoise,
    // 新增: 比特粉碎
    bitcrushEnabled, bitcrushBits,
    // 新增: 立体声分离度
    stereoSeparationEnabled, ssWidth, ssCenterLevel,
    // AB 对比旁通
    bypassAll,
    // 音频性能增强
    audioBoost,
    // 自定义 EQ 预设
    customEqPresets, saveCustomEqPreset, loadCustomEqPreset, deleteCustomEqPreset, exportEqPresets, importEqPresets,
    // 整套音效预设
    fullEffectPresets, saveFullEffectPreset, loadFullEffectPreset,
    // 重置所有高级音效
    resetAllAdvanced,
    // 音频连接
    connectAudio,
    disconnectAudio,
    // [USB 独占模式] 同步音效参数到 Rust 后端
    syncEffectsToBackend,
    buildEffectParams,
  }
})
