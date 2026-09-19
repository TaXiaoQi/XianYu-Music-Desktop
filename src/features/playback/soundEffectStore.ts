import { defineStore } from 'pinia'
import { ref, reactive, watch, watchEffect, computed } from 'vue'
import { playerStorage, playerStorageKeys } from '../../services/storage/playerStorage'
import { localStore } from '../../services/storage/localStore'
import { playbackApi } from '../../services/tauri/playbackApi'
import type {
  SoundEffectSettings,
  ReverbKind,
  SpatialMode,
} from '../../services/tauri/contracts'
import {
  freqsPreset,
  convolutions,
  advancedEqPresets,
  algorithmicReverbs,
} from '../../utils/audio/soundEffectEngine'

export const eqPresetNames = freqsPreset.map(p => p.name)
export const advancedEqPresetNames = advancedEqPresets.map(p => p.name)
export const algorithmicReverbNames = algorithmicReverbs.map(p => p.name)

export const useSoundEffectStore = defineStore('soundEffect', () => {
  const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
  // ===== 均衡器 =====
  const eqBands = reactive<Record<string, number>>({
    '31': 0, '62': 0, '125': 0, '250': 0, '500': 0,
    '1k': 0, '2k': 0, '4k': 0, '8k': 0, '16k': 0,
  })

  const applyPreset = (presetName: string) => {
    let preset = freqsPreset.find((p: { name: string }) => p.name === presetName) as any
    if (!preset) {
      preset = advancedEqPresets.find((p: { name: string }) => p.name === presetName) as any
    }
    if (!preset) return
    const keys = Object.keys(eqBands)
    const freqKeys = ['hz31', 'hz62', 'hz125', 'hz250', 'hz500', 'hz1000', 'hz2000', 'hz4000', 'hz8000', 'hz16000'] as const
    keys.forEach((label, i) => {
      eqBands[label] = preset[freqKeys[i]] as number
    })
  }

  const resetEq = () => {
    for (const key of Object.keys(eqBands)) {
      eqBands[key] = 0
    }
  }

  // ===== 卷积混响 =====
  const activeConvolution = ref<string | null>(null)
  const originalGain = ref(0)
  const envGain = ref(100)

  // ===== 自定义混响（干/湿自定义槽） =====
  const convIsCustom = ref(false)
  const algoIsCustom = ref(false)
  const convCustomDry = ref(80)
  const convCustomWet = ref(40)
  const algoCustomDry = ref(85)
  const algoCustomWet = ref(40)
  const convCustomBase = ref('hall')
  const algoCustomBase = ref('algoHall')

  watch(activeConvolution, (label) => {
    if (convIsCustom.value) return
    if (label) {
      const conv = convolutions.find((c: { label: string }) => c.label === label)
      if (conv) {
        originalGain.value = conv.dry
        envGain.value = conv.wet
      }
    } else {
      if (!activeAlgoReverb.value) {
        originalGain.value = 0
        envGain.value = 0
      }
    }
  })

  const toggleConvolution = (label: string) => {
    if (activeConvolution.value === label && !convIsCustom.value) {
      activeConvolution.value = null
      activeAlgoReverb.value = null
      convIsCustom.value = false
      algoIsCustom.value = false
      return
    }
    const conv = convolutions.find((c: { label: string }) => c.label === label)
    activeAlgoReverb.value = null
    algoIsCustom.value = false
    convIsCustom.value = false
    activeConvolution.value = label
    if (conv) {
      originalGain.value = conv.dry
      envGain.value = conv.wet
    }
  }

  // ===== 算法混响（程序生成 IR） =====
  const activeAlgoReverb = ref<string | null>(null)

  const markCustomReverbGain = () => {
    const dry = originalGain.value
    const wet = envGain.value
    if (activeConvolution.value && !convIsCustom.value) {
      convCustomBase.value = activeConvolution.value
      convIsCustom.value = true
      algoIsCustom.value = false
      activeAlgoReverb.value = null
      convCustomDry.value = dry
      convCustomWet.value = wet
    } else if (activeAlgoReverb.value && !algoIsCustom.value) {
      algoCustomBase.value = activeAlgoReverb.value
      algoIsCustom.value = true
      convIsCustom.value = false
      activeConvolution.value = null
      algoCustomDry.value = dry
      algoCustomWet.value = wet
    } else if (activeConvolution.value && convIsCustom.value) {
      convCustomDry.value = dry
      convCustomWet.value = wet
    } else if (activeAlgoReverb.value && algoIsCustom.value) {
      algoCustomDry.value = dry
      algoCustomWet.value = wet
    }
  }

  const toggleConvolutionCustom = () => {
    if (convIsCustom.value && activeConvolution.value) {
      activeConvolution.value = null
      activeAlgoReverb.value = null
      convIsCustom.value = false
      algoIsCustom.value = false
      return
    }
    const base =
      activeConvolution.value && !convIsCustom.value
        ? activeConvolution.value
        : (convCustomBase.value || 'hall')
    activeAlgoReverb.value = null
    algoIsCustom.value = false
    convCustomBase.value = base
    activeConvolution.value = base
    convIsCustom.value = true
    originalGain.value = convCustomDry.value
    envGain.value = convCustomWet.value
  }

  const toggleAlgoReverbCustom = () => {
    if (algoIsCustom.value && activeAlgoReverb.value) {
      activeAlgoReverb.value = null
      activeConvolution.value = null
      algoIsCustom.value = false
      convIsCustom.value = false
      return
    }
    const base =
      activeAlgoReverb.value && !algoIsCustom.value
        ? activeAlgoReverb.value
        : (algoCustomBase.value || 'algoHall')
    activeConvolution.value = null
    convIsCustom.value = false
    algoCustomBase.value = base
    activeAlgoReverb.value = base
    algoIsCustom.value = true
    originalGain.value = algoCustomDry.value
    envGain.value = algoCustomWet.value
  }

  watch(activeAlgoReverb, (label) => {
    if (algoIsCustom.value) return
    if (label) {
      const preset = algorithmicReverbs.find((p: { label: string }) => p.label === label)
      originalGain.value = preset?.dry ?? 85
      envGain.value = preset?.wet ?? 40
    } else {
      if (!activeConvolution.value) {
        originalGain.value = 0
        envGain.value = 0
      }
    }
  })

  const toggleAlgoReverb = (label: string) => {
    if (activeAlgoReverb.value === label && !algoIsCustom.value) {
      activeAlgoReverb.value = null
      activeConvolution.value = null
      algoIsCustom.value = false
      convIsCustom.value = false
      return
    }
    const preset = algorithmicReverbs.find((p: { label: string }) => p.label === label)
    activeConvolution.value = null
    convIsCustom.value = false
    algoIsCustom.value = false
    activeAlgoReverb.value = label
    originalGain.value = preset?.dry ?? 85
    envGain.value = preset?.wet ?? 40
  }

  // ===== 变调 =====
  const pitchShift = ref(100)

  const resetPitch = () => {
    pitchShift.value = 100
  }

  // ===== 倍速播放 =====
  const playbackRate = ref(100)

  const resetPlaybackRate = () => {
    playbackRate.value = 100
  }

  // ===== 音调补偿 =====
  const preservesPitch = ref(true)

  // ===== 3D 环绕声 =====
  const enable3DSurround = ref(false)
  const surroundIntensity = ref(9)
  const surround3DRotation = ref(6.5)
  const soundDistance = ref(9)

  watch(enable3DSurround, (val) => {
    if (val) disableOtherSpatial('3d')
  }, { flush: 'sync' })

  // ===== 8D 环绕声 =====
  const enable8D = ref(false)
  const rotationSpeed8D = ref(10)
  const virtualDistance8D = ref(5)

  watch(enable8D, (val) => {
    if (val) disableOtherSpatial('8d')
  }, { flush: 'sync' })

  // ===== 36D 环绕声 =====
  const enable36D = ref(false)
  const rotationSpeed36D = ref(10)
  const virtualDistance36D = ref(5)

  watch(enable36D, (val) => {
    if (val) disableOtherSpatial('36d')
  }, { flush: 'sync' })

  // ===== 7.1/5.1 虚拟多声道环绕 =====
  const enableVirtualSurround = ref(false)
  const virtualSurroundMode = ref<'5.1' | '7.1'>('7.1')
  const virtualSurroundSpread = ref(10)

  watch(enableVirtualSurround, (val) => {
    if (val) disableOtherSpatial('virtual')
  }, { flush: 'sync' })

  // ===== 空间音效互斥逻辑 =====
  function disableOtherSpatial(current: string) {
    if (current !== '3d' && enable3DSurround.value) enable3DSurround.value = false
    if (current !== '8d' && enable8D.value) enable8D.value = false
    if (current !== '36d' && enable36D.value) enable36D.value = false
    if (current !== 'virtual' && enableVirtualSurround.value) enableVirtualSurround.value = false
  }

  // ===== 高级音效: 消人声 =====
  const vocalRemoval = ref(false)

  // ===== 高级音效: 颤音 =====
  const vibratoEnabled = ref(false)
  const vibratoRate = ref(5)
  const vibratoDepth = ref(3)

  // ===== 高级音效: 动态音调漂移 =====
  const pitchDriftEnabled = ref(false)
  const pitchDriftSpeed = ref(1)
  const pitchDriftRange = ref(10)

  // ===== 高级音效: 抖音效果器 (Tremolo) =====
  const tremoloEnabled = ref(false)
  const tremoloRate = ref(6)
  const tremoloDepth = ref(30)

  // ===== 高级音效: Bass 重低音增强 =====
  const bassBoostEnabled = ref(false)
  const bassBoostGain = ref(6)
  const bassBoostDynamic = ref(true)

  // ===== 高级音效: 动态均衡 =====
  const dynamicEqEnabled = ref(false)

  // ===== 高级音效: 失真 =====
  const distortionEnabled = ref(false)
  const distortionAmount = ref(10)
  const distortionType = ref<'soft' | 'hard'>('soft')

  // ===== 高级音效: 镶边 (Flanger) =====
  const flangerEnabled = ref(false)
  const flangerRate = ref(0.5)
  const flangerDepth = ref(2)
  const flangerFeedback = ref(30)
  const flangerMix = ref(35)

  // ===== 高级音效: 相位 (Phaser) =====
  const phaserEnabled = ref(false)
  const phaserRate = ref(0.5)
  const phaserDepth = ref(1)
  const phaserFeedback = ref(30)
  const phaserMix = ref(50)

  // ===== 高级音效: 延迟回声 =====
  const delayEnabled = ref(false)
  const delayTime = ref(300)
  const delayFeedback = ref(40)
  const delayMix = ref(30)
  const delayType = ref<'single' | 'pingpong'>('single')

  // ===== 高级音效: 压缩器 =====
  const compressorEnabled = ref(false)
  const compressorThreshold = ref(-18)
  const compressorRatio = ref(4)
  const compressorAttack = ref(8)
  const compressorRelease = ref(400)

  // ===== 高级音效: Crossfeed 耳机互馈 =====
  const crossfeedEnabled = ref(false)
  const crossfeedStrength = ref(30)

  // ===== 高级音效: 立体声拓宽 =====
  const stereoWidenEnabled = ref(false)
  const stereoWidenAmount = ref(1.5)

  // ===== 高级音效: 单声道合并 =====
  const monoMergeEnabled = ref(false)

  // ===== 高级音效: 左右声道交换 =====
  const channelSwapEnabled = ref(false)

  // ===== 高级音效: V4A 组合音效 =====
  const v4aEnabled = ref(false)

  // ===== 新增音效: 噪声门 =====
  const noiseGateEnabled = ref(false)
  const noiseGateThreshold = ref(-60)
  const noiseGateAttack = ref(5)
  const noiseGateRelease = ref(50)

  // ===== 新增音效: 扩展器 =====
  const expanderEnabled = ref(false)
  const expanderThreshold = ref(-40)
  const expanderRatio = ref(2)

  // ===== 新增音效: 多段压缩器 =====
  const multibandCompEnabled = ref(false)
  const mbLowFreq = ref(200)
  const mbMidFreq = ref(2000)
  const mbThreshold = ref(-20)
  const mbRatio = ref(3)

  // ===== 新增音效: 限制器 =====
  const limiterEnabled = ref(false)
  const limiterThreshold = ref(-1)

  // ===== 新增音效: 谐波激励器 =====
  const exciterEnabled = ref(false)
  const exciterAmount = ref(20)
  const exciterFrequency = ref(3000)

  // ===== 新增音效: 次谐波低音增强 =====
  const subBassEnabled = ref(false)
  const subBassAmount = ref(30)
  const subBassFrequency = ref(120)

  // ===== 新增音效: 去齿音 =====
  const deEsserEnabled = ref(false)
  const deEsserThreshold = ref(-20)
  const deEsserFrequency = ref(6000)

  // ===== 新增音效: 自动增益 (AGC) =====
  const agcEnabled = ref(false)
  const agcTargetLevel = ref(50)

  // ===== 新增音效: Lo-Fi 低保真 =====
  const loFiEnabled = ref(false)
  const loFiSampleRate = ref(8000)
  const loFiBitDepth = ref(8)
  const loFiNoise = ref(20)

  // ===== 新增音效: 比特粉碎 =====
  const bitcrushEnabled = ref(false)
  const bitcrushBits = ref(6)

  // ===== 新增音效: 立体声分离度 (M/S) =====
  const stereoSeparationEnabled = ref(false)
  const ssWidth = ref(100)
  const ssCenterLevel = ref(100)

  // ===== AB 对比旁通 =====
  const bypassAll = ref(false)

  const anyEffectEnabled = computed(
    () =>
      activeConvolution.value != null || activeAlgoReverb.value != null ||
      enable3DSurround.value || enable8D.value || enable36D.value || enableVirtualSurround.value ||
      vocalRemoval.value || vibratoEnabled.value || pitchDriftEnabled.value || tremoloEnabled.value ||
      bassBoostEnabled.value || dynamicEqEnabled.value || distortionEnabled.value || flangerEnabled.value ||
      phaserEnabled.value || delayEnabled.value || compressorEnabled.value || crossfeedEnabled.value ||
      stereoWidenEnabled.value || monoMergeEnabled.value || channelSwapEnabled.value || v4aEnabled.value ||
      noiseGateEnabled.value || expanderEnabled.value || multibandCompEnabled.value || limiterEnabled.value ||
      exciterEnabled.value || subBassEnabled.value || deEsserEnabled.value || agcEnabled.value ||
      loFiEnabled.value || bitcrushEnabled.value || stereoSeparationEnabled.value
  )
  let prevAnyEffectEnabled = anyEffectEnabled.value
  watch(anyEffectEnabled, (now) => {
    if (now && !prevAnyEffectEnabled && bypassAll.value) bypassAll.value = false
    prevAnyEffectEnabled = now
  })

  // ===== 音频增强增益 =====
  const audioBoost = ref(0)

  // =========================================================================
  // =========================================================================

  const buildSoundEffectSettings = (): SoundEffectSettings => {
    const reverbKind: ReverbKind = activeConvolution.value
      ? 'convolution'
      : (activeAlgoReverb.value ? 'algorithmic' : 'none')
    const reverbPreset = activeConvolution.value ?? activeAlgoReverb.value ?? ''

    const spatialMode: SpatialMode = enable3DSurround.value
      ? 'surround3d'
      : enable8D.value
        ? 'd8'
        : enable36D.value
          ? 'd36'
          : enableVirtualSurround.value
            ? 'virtual'
            : 'none'

    const spatialSpeed = enable3DSurround.value
      ? surround3DRotation.value / 3.6
      : enable8D.value
        ? rotationSpeed8D.value
        : enable36D.value
          ? rotationSpeed36D.value
          : 10
    const spatialRadius = enable3DSurround.value
      ? soundDistance.value / 10
      : enable8D.value
        ? virtualDistance8D.value / 5
        : enable36D.value
          ? virtualDistance36D.value / 5
          : 5

    return {
      pitchShift: pitchShift.value,
      playbackRate: playbackRate.value,
      preservesPitch: preservesPitch.value,
      reverbKind,
      reverbPreset,
      reverbDry: clamp01(originalGain.value / 100),
      reverbWet: clamp01(envGain.value / 100),
      spatialMode,
      spatialSpeed,
      spatialRadius,
      spatialIntensity: surroundIntensity.value,
      virtualSurroundMode: virtualSurroundMode.value,
      virtualSurroundSpread: virtualSurroundSpread.value,
      vibrato: { enabled: vibratoEnabled.value, rate: vibratoRate.value, depth: vibratoDepth.value },
      pitchDrift: { enabled: pitchDriftEnabled.value, rate: pitchDriftSpeed.value, depth: pitchDriftRange.value },
      tremolo: { enabled: tremoloEnabled.value, rate: tremoloRate.value, depth: tremoloDepth.value },
      flanger: { enabled: flangerEnabled.value, rate: flangerRate.value, depth: flangerDepth.value, feedback: flangerFeedback.value, mix: flangerMix.value },
      phaser: { enabled: phaserEnabled.value, rate: phaserRate.value, depth: phaserDepth.value, feedback: phaserFeedback.value, mix: phaserMix.value },
      delay: { enabled: delayEnabled.value, timeMs: delayTime.value, feedback: delayFeedback.value, mix: delayMix.value, delayType: delayType.value },
      compressor: { enabled: compressorEnabled.value, threshold: compressorThreshold.value, ratio: compressorRatio.value, attack: compressorAttack.value, release: compressorRelease.value },
      multiband: { enabled: multibandCompEnabled.value, lowFreq: mbLowFreq.value, midFreq: mbMidFreq.value, threshold: mbThreshold.value, ratio: mbRatio.value },
      limiter: { enabled: limiterEnabled.value, threshold: limiterThreshold.value },
      noiseGate: { enabled: noiseGateEnabled.value, threshold: noiseGateThreshold.value, attack: noiseGateAttack.value, release: noiseGateRelease.value },
      expander: { enabled: expanderEnabled.value, threshold: expanderThreshold.value, ratio: expanderRatio.value },
      agc: { enabled: agcEnabled.value, targetLevel: agcTargetLevel.value },
      deEsser: { enabled: deEsserEnabled.value, threshold: deEsserThreshold.value, frequency: deEsserFrequency.value },
      distortion: { enabled: distortionEnabled.value, amount: distortionAmount.value, distortionType: distortionType.value },
      exciter: { enabled: exciterEnabled.value, amount: exciterAmount.value, frequency: exciterFrequency.value },
      subBass: { enabled: subBassEnabled.value, amount: subBassAmount.value, frequency: subBassFrequency.value },
      loFi: { enabled: loFiEnabled.value, sampleRate: loFiSampleRate.value, bitDepth: loFiBitDepth.value, noise: loFiNoise.value },
      bitcrush: { enabled: bitcrushEnabled.value, bits: bitcrushBits.value },
      vocalRemoval: vocalRemoval.value,
      stereoWiden: { enabled: stereoWidenEnabled.value, amount: stereoWidenAmount.value },
      monoMerge: monoMergeEnabled.value,
      channelSwap: channelSwapEnabled.value,
      stereoSeparation: { enabled: stereoSeparationEnabled.value, width: ssWidth.value, centerLevel: ssCenterLevel.value },
      crossfeed: { enabled: crossfeedEnabled.value, strength: crossfeedStrength.value },
      bassBoost: { enabled: bassBoostEnabled.value, gain: bassBoostGain.value, dynamic: bassBoostDynamic.value },
      dynamicEq: { enabled: dynamicEqEnabled.value },
      v4aEnabled: v4aEnabled.value,
      bypass: bypassAll.value,
      audioBoost: audioBoost.value,
    }
  }

  let syncTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleBackendSync = (settings: SoundEffectSettings) => {
    if (syncTimer) clearTimeout(syncTimer)
    syncTimer = setTimeout(() => {
      syncTimer = null
      playbackApi.setSoundEffectSettings(settings).catch(err => {
        console.warn('[soundEffectStore] 同步音效参数到 Rust 失败:', err)
      })
    }, 50)
  }

  watchEffect(() => {
    const settings = buildSoundEffectSettings()
    scheduleBackendSync(settings)
  })

  watch(
    [originalGain, envGain, v4aEnabled, activeConvolution, activeAlgoReverb],
    () => {
      if (syncTimer) {
        clearTimeout(syncTimer)
        syncTimer = null
      }
      playbackApi.setSoundEffectSettings(buildSoundEffectSettings()).catch(err => {
        console.warn('[soundEffectStore] 即时同步音效参数失败:', err)
      })
    },
  )

  // =========================================================================
  // =========================================================================
  const EQ_FREQ_LABELS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'] as const
  const buildEqGains = (): number[] => EQ_FREQ_LABELS.map(label => eqBands[label] ?? 0)

  let eqSyncTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleEqSync = () => {
    if (eqSyncTimer) clearTimeout(eqSyncTimer)
    eqSyncTimer = setTimeout(() => {
      eqSyncTimer = null
      const enabled = !bypassAll.value
      playbackApi.setEqualizerSettings(enabled, 0, buildEqGains()).catch(err => {
        console.warn('[soundEffectStore] 同步 10 段 EQ 到 Rust 失败:', err)
      })
    }, 50)
  }

  watch(
    [() => ({ ...eqBands }), bypassAll],
    () => scheduleEqSync(),
  )

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
    if (s.eqBands) for (const key of Object.keys(eqBands)) eqBands[key] = s.eqBands[key] || 0
    activeConvolution.value = s.activeConvolution || null
    activeAlgoReverb.value = s.activeAlgoReverb || null
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
  }

  // ===== 音频元素连接 =====
  const connectAudio = async (_audio: HTMLAudioElement) => { void _audio }
  const disconnectAudio = () => {}

  // ===== [音效持久化] 收集全部需要保存的状态 =====
  const buildEffectSnapshot = () => ({
    eqBands: { ...eqBands },
    activeConvolution: activeConvolution.value,
    originalGain: originalGain.value,
    envGain: envGain.value,
    activeAlgoReverb: activeAlgoReverb.value,
    convIsCustom: convIsCustom.value,
    algoIsCustom: algoIsCustom.value,
    convCustomDry: convCustomDry.value,
    convCustomWet: convCustomWet.value,
    algoCustomDry: algoCustomDry.value,
    algoCustomWet: algoCustomWet.value,
    convCustomBase: convCustomBase.value,
    algoCustomBase: algoCustomBase.value,
    pitchShift: pitchShift.value,
    playbackRate: playbackRate.value,
    preservesPitch: preservesPitch.value,
    enable3DSurround: enable3DSurround.value,
    surroundIntensity: surroundIntensity.value,
    surround3DRotation: surround3DRotation.value,
    soundDistance: soundDistance.value,
    enable8D: enable8D.value,
    rotationSpeed8D: rotationSpeed8D.value,
    virtualDistance8D: virtualDistance8D.value,
    enable36D: enable36D.value,
    rotationSpeed36D: rotationSpeed36D.value,
    virtualDistance36D: virtualDistance36D.value,
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
  })

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
    if (typeof s.convIsCustom === 'boolean') convIsCustom.value = s.convIsCustom
    if (typeof s.algoIsCustom === 'boolean') algoIsCustom.value = s.algoIsCustom
    if (typeof s.convCustomDry === 'number') convCustomDry.value = s.convCustomDry
    if (typeof s.convCustomWet === 'number') convCustomWet.value = s.convCustomWet
    if (typeof s.algoCustomDry === 'number') algoCustomDry.value = s.algoCustomDry
    if (typeof s.algoCustomWet === 'number') algoCustomWet.value = s.algoCustomWet
    if (typeof s.convCustomBase === 'string') convCustomBase.value = s.convCustomBase
    if (typeof s.algoCustomBase === 'string') algoCustomBase.value = s.algoCustomBase
    if (typeof s.pitchShift === 'number') pitchShift.value = s.pitchShift
    if (typeof s.playbackRate === 'number') playbackRate.value = s.playbackRate
    if (typeof s.preservesPitch === 'boolean') preservesPitch.value = s.preservesPitch
    if (typeof s.enable3DSurround === 'boolean') enable3DSurround.value = s.enable3DSurround
    if (typeof s.surroundIntensity === 'number') surroundIntensity.value = s.surroundIntensity
    if (typeof s.surround3DRotation === 'number') surround3DRotation.value = s.surround3DRotation
    if (typeof s.soundDistance === 'number') soundDistance.value = s.soundDistance
    if (typeof s.enable8D === 'boolean') enable8D.value = s.enable8D
    if (typeof s.rotationSpeed8D === 'number') rotationSpeed8D.value = s.rotationSpeed8D
    if (typeof s.virtualDistance8D === 'number') virtualDistance8D.value = s.virtualDistance8D
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
    if (typeof s.enableVirtualSurround === 'boolean') enableVirtualSurround.value = s.enableVirtualSurround
    if (s.virtualSurroundMode === '5.1' || s.virtualSurroundMode === '7.1') virtualSurroundMode.value = s.virtualSurroundMode
    if (typeof s.virtualSurroundSpread === 'number') virtualSurroundSpread.value = s.virtualSurroundSpread
    if (typeof s.vocalRemoval === 'boolean') vocalRemoval.value = s.vocalRemoval
    if (typeof s.vibratoEnabled === 'boolean') vibratoEnabled.value = s.vibratoEnabled
    if (typeof s.vibratoRate === 'number') vibratoRate.value = s.vibratoRate
    if (typeof s.vibratoDepth === 'number') vibratoDepth.value = s.vibratoDepth
    if (typeof s.pitchDriftEnabled === 'boolean') pitchDriftEnabled.value = s.pitchDriftEnabled
    if (typeof s.pitchDriftSpeed === 'number') pitchDriftSpeed.value = Math.min(5, Math.max(0.1, s.pitchDriftSpeed))
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
      convIsCustom, algoIsCustom, convCustomDry, convCustomWet, algoCustomDry, algoCustomWet, convCustomBase, algoCustomBase,
      pitchShift, playbackRate, preservesPitch,
      enable3DSurround, surroundIntensity, surround3DRotation, soundDistance,
      enable8D, rotationSpeed8D, virtualDistance8D,
      enable36D, rotationSpeed36D, virtualDistance36D,
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
    ],
    persistEffectState,
    { deep: true },
  )

  return {
    eqBands,
    applyPreset,
    resetEq,
    activeConvolution,
    originalGain,
    envGain,
    toggleConvolution,
    activeAlgoReverb,
    toggleAlgoReverb,
    convIsCustom,
    algoIsCustom,
    markCustomReverbGain,
    toggleConvolutionCustom,
    toggleAlgoReverbCustom,
    pitchShift,
    resetPitch,
    playbackRate,
    resetPlaybackRate,
    preservesPitch,
    enable3DSurround,
    surroundIntensity,
    surround3DRotation,
    soundDistance,
    enable8D,
    rotationSpeed8D,
    virtualDistance8D,
    enable36D,
    rotationSpeed36D,
    virtualDistance36D,
    enableVirtualSurround,
    virtualSurroundMode,
    virtualSurroundSpread,
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
    monoMergeEnabled,
    channelSwapEnabled,
    v4aEnabled,
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
    bypassAll,
    audioBoost,
    customEqPresets, saveCustomEqPreset, loadCustomEqPreset, deleteCustomEqPreset, exportEqPresets, importEqPresets,
    fullEffectPresets, saveFullEffectPreset, loadFullEffectPreset,
    resetAllAdvanced,
    connectAudio,
    disconnectAudio,
    buildSoundEffectSettings,
    syncEffectsToBackend: () => {
      if (syncTimer) {
        clearTimeout(syncTimer)
        syncTimer = null
      }
      playbackApi.setSoundEffectSettings(buildSoundEffectSettings()).catch(err => {
        console.warn('[soundEffectStore] 同步音效参数到 Rust 失败:', err)
      })
    },
  }
})
