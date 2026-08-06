<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { getSpatialVizState } from '../../../utils/audio/soundEffectEngine'

// 旋转示意图：俯视画布，实时绘制当前激活的空间音效声源运动轨迹。
// 同一时刻只有一个空间音效激活（store 互斥），故画布只反映那一个。
// - 8D/36D：单源绕头旋转；36D 点大小随高度(y)呼吸
// - 95D：双源反向旋转，A(红) 右起逆时针、B(蓝) 左起顺时针
// - 3D：单源旋转
// - 虚拟多声道：固定扬声器布局（不旋转）
const props = defineProps<{ visible: boolean }>()

const SIZE = 184 // 逻辑像素
const canvasRef = ref<HTMLCanvasElement | null>(null)
let rafId = 0
let dpr = 1

const COLORS = ['#EC4141', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6']

const isDark = () => document.documentElement.classList.contains('dark')

const draw = () => {
  if (!props.visible) { rafId = 0; return }
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (canvas && ctx) {
    const W = SIZE, H = SIZE
    const cx = W / 2, cy = H / 2
    ctx.clearRect(0, 0, W, H)

    const dark = isDark()
    const lineColor = dark ? 'rgba(200,200,200,0.30)' : 'rgba(120,120,120,0.35)'
    const axisColor = dark ? 'rgba(200,200,200,0.12)' : 'rgba(120,120,120,0.15)'
    const labelColor = dark ? 'rgba(200,200,200,0.55)' : 'rgba(120,120,120,0.60)'
    const headColor = dark ? '#e5e7eb' : '#353A3E'
    const R = Math.min(W, H) / 2 - 16

    // 轨道圆
    ctx.strokeStyle = lineColor
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(cx, cy, R, 0, Math.PI * 2)
    ctx.stroke()
    // 十字轴
    ctx.strokeStyle = axisColor
    ctx.beginPath()
    ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy)
    ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R)
    ctx.stroke()
    // 方向标（前=上，z 负方向）
    ctx.fillStyle = labelColor
    ctx.font = '10px system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.fillText('前', cx, cy - R - 8)
    ctx.fillText('后', cx, cy + R + 8)
    ctx.textAlign = 'left'
    ctx.fillText('左', cx - R - 2, cy)
    ctx.textAlign = 'right'
    ctx.fillText('右', cx + R + 2, cy)
    ctx.textAlign = 'left'

    // 听众（头部）
    ctx.fillStyle = headColor
    ctx.beginPath()
    ctx.arc(cx, cy, 5, 0, Math.PI * 2)
    ctx.fill()

    const state = getSpatialVizState()
    const baseR = state.baseRadius || 1
    // 归一化：距离波动峰值约 baseR*1.6，留余量到 1.7
    const scale = R / (baseR * 1.7)

    if (state.sources.length === 0) {
      ctx.fillStyle = labelColor
      ctx.font = '11px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('未启用环绕音效', cx, cy + R + 22)
    } else {
      // 虚拟多声道：先画连线网格再画扬声器
      const isVirtual = state.effect === 'virtual'
      state.sources.forEach((s, i) => {
        const color = COLORS[i % COLORS.length]
        // 俯视：x→左右，z→前后（前=上，z 负方向朝上）
        const px = cx + s.x * scale
        const py = cy + s.z * scale
        // 高度 y 影响点大小（36D/95D 上下摆动可视化）
        const yNorm = baseR > 0 ? s.y / baseR : 0
        const r = Math.max(3.5, (isVirtual ? 5 : 6) + yNorm * 2.2)
        // 中心到声源的连线
        ctx.strokeStyle = color + (isVirtual ? '44' : '66')
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(cx, cy); ctx.lineTo(px, py)
        ctx.stroke()
        // 声源点
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(px, py, r, 0, Math.PI * 2)
        ctx.fill()
        // 标签（A/B 或 FL/FR...）
        if (s.label) {
          ctx.fillStyle = '#ffffff'
          ctx.font = 'bold 9px system-ui, sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(s.label, px, py + 0.5)
        }
      })
    }
  }
  rafId = requestAnimationFrame(draw)
}

const start = () => { if (!rafId) rafId = requestAnimationFrame(draw) }
const stop = () => { if (rafId) { cancelAnimationFrame(rafId); rafId = 0 } }

onMounted(() => {
  const canvas = canvasRef.value
  if (canvas) {
    dpr = window.devicePixelRatio || 1
    canvas.width = SIZE * dpr
    canvas.height = SIZE * dpr
    canvas.style.width = SIZE + 'px'
    canvas.style.height = SIZE + 'px'
    const ctx = canvas.getContext('2d')
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  if (props.visible) start()
})
onBeforeUnmount(stop)
watch(() => props.visible, (v) => { v ? start() : stop() })
</script>

<template>
  <canvas ref="canvasRef" class="block"></canvas>
</template>
