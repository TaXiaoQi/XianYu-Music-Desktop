import tailwindcss from '@tailwindcss/postcss'
import autoprefixer from 'autoprefixer'

const replaceLegacyThemeColor = (value) => value
  .replace(
    /#ec4141([0-9a-f]{2})\b/gi,
    (_match, alphaHex) => `rgb(var(--theme-color-rgb) / ${(Number.parseInt(alphaHex, 16) / 255).toFixed(4)})`,
  )
  .replace(/#ec4141\b/gi, 'var(--theme-color)')
  .replace(
    /rgba?\(\s*236\s*,\s*65\s*,\s*65\s*(?:,\s*([^)]+))?\)/gi,
    (_match, alpha) => alpha
      ? `rgb(var(--theme-color-rgb) / ${alpha.trim()})`
      : 'rgb(var(--theme-color-rgb))',
  )
  .replace(
    /rgb\(\s*236\s+65\s+65\s*(?:\/\s*([^)]+))?\)/gi,
    (_match, alpha) => alpha
      ? `rgb(var(--theme-color-rgb) / ${alpha.trim()})`
      : 'rgb(var(--theme-color-rgb))',
  )
  .replace(
    /color-mix\(in (?:oklab|srgb),\s*var\(--theme-color\)\s*([\d.]+)%,\s*transparent\)/gi,
    (_match, percentage) => `rgb(var(--theme-color-rgb) / ${Number(percentage) / 100})`,
  )

const runtimeThemeColor = {
  postcssPlugin: 'xianyu-runtime-theme-color',
  OnceExit(root) {
    root.walkDecls((declaration) => {
      declaration.value = replaceLegacyThemeColor(declaration.value)
    })
  },
}

export default {
  plugins: [
    tailwindcss(),
    runtimeThemeColor,
    autoprefixer(),
  ],
}
