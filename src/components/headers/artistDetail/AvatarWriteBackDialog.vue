<script setup lang="ts">
defineEmits(['writeBack', 'saveLocal', 'close']);
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 backdrop-blur-[2px] select-none" @click.self="$emit('close')">
      <div class="bg-white dark:bg-zinc-900 rounded-lg shadow-xl w-[360px] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div class="px-6 pt-6 pb-2 text-center">
          <h3 class="text-lg font-bold text-gray-800 dark:text-zinc-100">更新歌手头像</h3>
        </div>
        <div class="px-6 pb-6 text-center">
          <p class="text-xs text-gray-500 dark:text-zinc-400 leading-relaxed">
            您已开启了“同步写回标签”设置。<br />
            您可以选择将新头像同步写入本地单歌手歌曲的标签中。<br />
            <span class="text-amber-500 dark:text-amber-400 block mt-1">注意：多歌手合作、分轨 CUE、远程歌曲及只读文件将被自动跳过。</span>
          </p>
        </div>
        <div class="flex flex-col border-t border-gray-100 dark:border-zinc-800">
          <button
            @click="$emit('writeBack')"
            class="w-full py-3 text-sm text-[#EC4141] font-semibold hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors focus:outline-none border-b border-gray-100 dark:border-zinc-800"
          >
            保存并同步写回音频标签
          </button>
          <button
            @click="$emit('saveLocal')"
            class="w-full py-3 text-sm text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors focus:outline-none border-b border-gray-100 dark:border-zinc-800"
          >
            仅保存至软件（不修改文件）
          </button>
          <button
            @click="$emit('close')"
            class="w-full py-3 text-sm text-gray-400 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors focus:outline-none"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
