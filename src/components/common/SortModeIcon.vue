<template>
  <!-- 排序方式图标：左侧三条渐短的清单线条，右侧一枚上下双向箭头；尺寸随容器等比缩放 -->
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <g stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
      <path d="M3.5 6.25h9.5" />
      <path d="M3.5 12h7" />
      <path d="M3.5 17.75h4.5" />
    </g>
    <g stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18.4 4.75v14.5" />
      <path d="m15 8.25 3.4-3.4 3.4 3.4" />
      <path d="m15 15.75 3.4 3.4 3.4-3.4" />
    </g>
  </svg><!-- 双向箭头示意当前排序方向 -->
</template>
