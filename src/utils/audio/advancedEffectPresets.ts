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