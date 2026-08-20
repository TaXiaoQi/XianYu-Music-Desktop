/**
 * 音效预设数据源（仅供前端 UI 读取）
 *
 * 均衡器预设 / 卷积混响预设 / 算法混响预设 / 高级 EQ 预设清单。
 * 实际 DSP 全部由 Rust 侧 SoundEffectSource 实现，前端不再调用任何 WebAudio 节点函数
 * （BiquadFilter/Convolver/Panner/PitchShifter/...），参数通过 set_sound_effect_settings
 * 同步到 Rust。此前的 WebAudio 引擎实现已移除。
 */

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

// 高级 EQ 预设（均衡衍生预设）
export { advancedEqPresets } from './advancedEffectPresets'

// 卷积混响预设（环境类精简集，参考主流专业音频软件的空间命名）。
// dry/wet 即干声/湿声百分比（0~100），与音效面板滑杆单位一致：wet 作为混响尾音的
// 混合占比，dry 保持节目清晰度。wet 按"空间越大越湿"拉开梯度，使每个预设的效果
// 与名称空间感对应：教堂最大最湿，小房间最干，电话为带通特性（干声压到最低以突出
// 电话音色）。数值过大（>100）会放大信号导致破音，均在安全范围，Rust 侧另有 [0,1]
// 夹取兜底。注意：source 仅作说明；实际 IR 由 Rust 按 label 编译期 include_bytes 加载。
export const convolutions = [
  { name: '教堂', label: 'church', dry: 55, wet: 65, source: 's3_r1_bd.wav' },
  { name: '大厅', label: 'hall', dry: 62, wet: 60, source: 'bright-hall.wav' },
  { name: '电影院', label: 'cinema', dry: 68, wet: 52, source: 'cinema-diningroom.wav' },
  { name: '餐厅', label: 'restaurant', dry: 74, wet: 44, source: 'dining-living-true-stereo.wav' },
  { name: '弹簧混响', label: 'feedbackSuppressor', dry: 78, wet: 38, source: 'feedback-spring.wav' },
  { name: '起居室', label: 'bathroom', dry: 82, wet: 32, source: 'living-bedroom-leveled.wav' },
  { name: '房间', label: 'room', dry: 86, wet: 25, source: 'medium-room1.wav' },
  { name: '电话', label: 'phone', dry: 20, wet: 60, source: 'filter-telephone.wav' },
] as const

// 算法混响预设（程序生成 IR，无需音频文件）
export { algorithmicReverbs } from './advancedEffectPresets'
export type { AlgorithmicReverbPreset } from './advancedEffectPresets'