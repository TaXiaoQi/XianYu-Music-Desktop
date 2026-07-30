<template>
  <div class="flex flex-col h-full">
    <!-- 搜索结果头部 -->
    <div class="px-6 shrink-0 select-none">
      <!-- 第一层：内容类型切换（音乐/作者/专辑/歌单） -->
      <div class="flex items-center gap-1 border-b border-black/5 dark:border-white/5">
        <button
          v-for="tab in searchTabs"
          :key="tab.type"
          type="button"
          class="relative px-5 py-3 text-[clamp(0.875rem,1.1vw,1rem)] font-medium tracking-wide transition-colors cursor-pointer"
          :class="activeSearchType === tab.type
            ? 'text-[#EC4141]'
            : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'"
          @click="handleSearchTypeChange(tab.type)"
        >
          {{ tab.label }}
          <span
            class="absolute left-1/2 -translate-x-1/2 -bottom-px h-[2px] w-8 bg-[#EC4141] rounded-full origin-center transition-all duration-300 ease-out"
            :class="activeSearchType === tab.type ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-0'"
          ></span>
        </button>
      </div>

      <!-- 第二层：来源横向选择 + 搜索关键词提示 -->
      <div class="flex items-center justify-between gap-4 py-3">
        <!-- 来源横向平铺选择 -->
        <div class="flex items-center gap-1 flex-wrap">
          <span class="text-[clamp(0.75rem,0.9vw,0.875rem)] text-black/50 dark:text-white/50 mr-1">来源</span>
          <button
            v-for="source in allSourceList"
            :key="source.id"
            type="button"
            class="px-3 py-1.5 rounded-md text-[clamp(0.8rem,1vw,0.9rem)] font-medium transition-colors cursor-pointer whitespace-nowrap"
            :class="selectedSourceId === source.id
              ? 'text-[#EC4141] bg-red-50 dark:bg-red-500/10'
              : 'text-black/60 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/5'"
            @click="handleSelectSource(source)"
          >
            {{ source.name }}
          </button>
        </div>

        <!-- 搜索关键词 + 结果数 -->
        <div class="flex items-center gap-2 min-w-0">
          <span v-if="searchQuery.trim()" class="text-[clamp(0.75rem,0.9vw,0.875rem)] text-black/50 dark:text-white/50 truncate">
            "{{ searchQuery }}" · {{ resultCount }} 个结果
          </span>
        </div>
      </div>
    </div>

    <!-- 搜索结果列表 -->
    <div class="flex-1 flex overflow-hidden relative">
      <section class="flex-1 flex overflow-hidden">
        <!-- 非音乐类型 + LX 插件：开发中提示（本地与 MusicFree 已支持） -->
        <div v-if="activeSearchType !== 'track' && !isLocalSource && selectedSourceItem?.type === 'lx'" class="flex-1 flex flex-col items-center justify-center text-black/30 dark:text-white/30">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mb-4 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
          <p class="text-base font-medium">{{ searchTabs.find(t => t.type === activeSearchType)?.label }}搜索</p>
          <p class="text-sm mt-1">该类型搜索功能开发中</p>
        </div>

        <!-- 加载中 -->
        <div v-else-if="searching" class="flex-1 flex items-center justify-center">
          <div class="flex flex-col items-center gap-3 text-black/40 dark:text-white/40">
            <svg class="animate-spin h-8 w-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p class="text-sm">正在从 {{ selectedSourceName }} 搜索…</p>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-else-if="!hasQuery" class="flex-1 flex flex-col items-center justify-center text-black/30 dark:text-white/30">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mb-4 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p class="text-base font-medium">在上方搜索框输入关键词</p>
          <p class="text-sm mt-1">结果来自 {{ selectedSourceName }}</p>
        </div>

        <!-- 无结果 -->
        <div v-else-if="hasNoResults" class="flex-1 flex flex-col items-center justify-center text-black/40 dark:text-white/40">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mb-4 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p class="text-base font-medium">没有找到与"{{ searchQuery }}"相关的内容</p>
          <p class="text-sm mt-1">试试更换音源或调整关键词</p>
        </div>

        <!-- 音乐搜索结果列表 -->
        <div
          v-else-if="activeSearchType === 'track'"
          ref="resultsScrollRef"
          class="flex-1 overflow-y-auto custom-scrollbar"
          @scroll="handleScroll"
        >
          <table class="w-full text-left">
            <thead class="sticky top-0 z-10 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-md">
              <tr class="border-b border-black/5 dark:border-white/5 text-xs text-black/40 dark:text-white/40">
                <th class="w-10 py-2 px-4 text-center font-normal">#</th>
                <th class="w-14 py-2 px-2 font-normal"></th>
                <th class="py-2 px-2 font-normal">歌曲</th>
                <th class="py-2 px-2 font-normal">歌手</th>
                <th class="py-2 px-2 font-normal">专辑</th>
                <th class="w-16 py-2 px-4 text-right font-normal">时长</th>
              </tr>
            </thead>
            <tbody>
              <!-- 落雪 LX 搜索结果 -->
              <tr
                v-for="(item, index) in lxSearchResults"
                :key="`lx-${item.source}-${item.songmid}-${index}`"
                class="group border-b border-black/5 dark:border-white/5 cursor-default select-none transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                @dblclick="handlePlaySong(item)"
                @contextmenu="handleContextMenu($event, item)"
              >
                <td class="py-2 px-4 text-center text-xs text-black/40 dark:text-white/40">
                  {{ index + 1 }}
                </td>
                <td class="py-2 px-2">
                  <div class="w-11 h-11 rounded-lg bg-black/10 dark:bg-white/10 overflow-hidden flex items-center justify-center text-[#EC4141] text-lg font-black shrink-0">
                    <img
                      v-if="item.img"
                      :src="item.img"
                      class="w-full h-full object-cover"
                      alt=""
                      loading="lazy"
                      @error="handleImgError(item)"
                    />
                    <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                    </svg>
                  </div>
                </td>
                <td class="py-2 px-2 text-sm text-black dark:text-white font-medium truncate max-w-[200px]">
                  {{ item.name }}
                </td>
                <td class="py-2 px-2 text-sm text-black/60 dark:text-white/60 truncate max-w-[150px]">
                  {{ item.singer }}
                </td>
                <td class="py-2 px-2 text-sm text-black/40 dark:text-white/40 truncate max-w-[150px]">
                  {{ item.albumName }}
                </td>
                <td class="py-2 px-4 text-xs text-black/40 dark:text-white/40 text-right whitespace-nowrap">
                  {{ item.interval }}
                </td>
              </tr>
              <!-- MusicFree 插件搜索结果 -->
              <tr
                v-for="(item, index) in pluginSearchResults"
                :key="`mf-${item.platform}-${item.id}-${index}`"
                class="group border-b border-black/5 dark:border-white/5 cursor-default select-none transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                @dblclick="handlePlayMfSong(item)"
                @contextmenu="handleMfContextMenu($event, item)"
              >
                <td class="py-2 px-4 text-center text-xs text-black/40 dark:text-white/40">
                  {{ lxSearchResults.length + index + 1 }}
                </td>
                <td class="py-2 px-2">
                  <div class="w-11 h-11 rounded-lg bg-black/10 dark:bg-white/10 overflow-hidden flex items-center justify-center text-[#EC4141] text-lg font-black shrink-0">
                    <img
                      v-if="item.coverUrl"
                      :src="getMfCoverUrl(item)"
                      class="w-full h-full object-cover"
                      alt=""
                      loading="lazy"
                      @error="handleMfImgError($event)"
                    />
                    <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                    </svg>
                  </div>
                </td>
                <td class="py-2 px-2 text-sm text-black dark:text-white font-medium truncate max-w-[200px]">
                  {{ item.title }}
                </td>
                <td class="py-2 px-2 text-sm text-black/60 dark:text-white/60 truncate max-w-[150px]">
                  {{ item.artist }}
                </td>
                <td class="py-2 px-2 text-sm text-black/40 dark:text-white/40 truncate max-w-[150px]">
                  {{ item.album }}
                </td>
                <td class="py-2 px-4 text-xs text-black/40 dark:text-white/40 text-right whitespace-nowrap">
                  {{ item.duration ? formatMfDuration(Math.floor(item.duration / 1000)) : '--:--' }}
                </td>
              </tr>
              <!-- 本地搜索结果 -->
              <tr
                v-for="(item, index) in localSearchResults"
                :key="`local-${item.path}-${index}`"
                class="group border-b border-black/5 dark:border-white/5 cursor-default select-none transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                @dblclick="handlePlayLocalSong(item)"
                @contextmenu="handleLocalContextMenu($event, item)"
              >
                <td class="py-2 px-4 text-center text-xs text-black/40 dark:text-white/40">
                  {{ lxSearchResults.length + pluginSearchResults.length + index + 1 }}
                </td>
                <td class="py-2 px-2">
                  <div class="w-11 h-11 rounded-lg bg-black/10 dark:bg-white/10 overflow-hidden flex items-center justify-center text-[#EC4141] text-lg font-black shrink-0">
                    <img
                      v-if="item.cover_thumb_path"
                      :src="getLocalCoverUrl(item)"
                      class="w-full h-full object-cover"
                      alt=""
                      loading="lazy"
                    />
                    <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                    </svg>
                  </div>
                </td>
                <td class="py-2 px-2 text-sm text-black dark:text-white font-medium truncate max-w-[200px]">
                  {{ item.title || item.name }}
                </td>
                <td class="py-2 px-2 text-sm text-black/60 dark:text-white/60 truncate max-w-[150px]">
                  {{ item.artist }}
                </td>
                <td class="py-2 px-2 text-sm text-black/40 dark:text-white/40 truncate max-w-[150px]">
                  {{ item.album }}
                </td>
                <td class="py-2 px-4 text-xs text-black/40 dark:text-white/40 text-right whitespace-nowrap">
                  {{ formatLocalDuration(item.duration) }}
                </td>
              </tr>
            </tbody>
          </table>
          <!-- 加载更多指示器 -->
          <div v-if="loadingMore" class="flex items-center justify-center py-4 text-black/40 dark:text-white/40">
            <svg class="animate-spin h-5 w-5 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span class="text-sm">加载更多…</span>
          </div>
          <div v-else-if="!hasMore && (lxSearchResults.length > 0 || pluginSearchResults.length > 0 || localSearchResults.length > 0)" class="flex items-center justify-center py-4 text-xs text-black/30 dark:text-white/30">
            没有更多了
          </div>
        </div>

        <!-- 歌手搜索结果（本地 + 插件） -->
        <div v-else-if="activeSearchType === 'artist'" class="flex-1 overflow-y-auto custom-scrollbar p-4">
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            <!-- 本地歌手 -->
            <button
              v-for="artist in localArtistResults"
              :key="artist.id"
              type="button"
              class="flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer group"
              @click="handleArtistClick(artist)"
            >
              <div class="w-20 h-20 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden flex items-center justify-center text-[#EC4141] text-2xl font-black shrink-0 ring-1 ring-black/5 dark:ring-white/10 group-hover:ring-[#EC4141]/30 transition">
                <img
                  v-if="getLocalArtistCover(artist)"
                  :src="getLocalArtistCover(artist)"
                  class="w-full h-full object-cover"
                  alt=""
                  loading="lazy"
                />
                <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 19l7 3v-11l-7-3-7 3v11l7-3zM12 19V8M5 12l7-3 7 3" />
                </svg>
              </div>
              <p class="text-sm font-medium text-black dark:text-white truncate w-full text-center">{{ artist.name }}</p>
              <p class="text-xs text-black/50 dark:text-white/50">{{ artist.count }} 首</p>
            </button>
            <!-- 插件歌手 -->
            <button
              v-for="artist in pluginArtistResults"
              :key="`p-artist-${artist.id}`"
              type="button"
              class="flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer group"
              @click="handlePluginArtistClick(artist)"
            >
              <div class="w-20 h-20 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden flex items-center justify-center text-[#EC4141] text-2xl font-black shrink-0 ring-1 ring-black/5 dark:ring-white/10 group-hover:ring-[#EC4141]/30 transition">
                <img v-if="artist.avatarUrl" :src="artist.avatarUrl" class="w-full h-full object-cover" alt="" loading="lazy" @error="handlePluginImgError($event)" />
                <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 19l7 3v-11l-7-3-7 3v11l7-3zM12 19V8M5 12l7-3 7 3" />
                </svg>
              </div>
              <p class="text-sm font-medium text-black dark:text-white truncate w-full text-center">{{ artist.name }}</p>
              <p class="text-xs text-black/50 dark:text-white/50">{{ artist.songCount ? `${artist.songCount} 首` : '查看' }}</p>
            </button>
          </div>
        </div>

        <!-- 专辑搜索结果（本地 + 插件） -->
        <div v-else-if="activeSearchType === 'album'" class="flex-1 overflow-y-auto custom-scrollbar p-4">
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            <!-- 本地专辑 -->
            <button
              v-for="album in localAlbumResults"
              :key="album.key"
              type="button"
              class="flex flex-col gap-2 p-3 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer group"
              @click="handleAlbumClick(album)"
            >
              <div class="aspect-square rounded-lg bg-black/10 dark:bg-white/10 overflow-hidden flex items-center justify-center text-[#EC4141] text-2xl font-black shrink-0 ring-1 ring-black/5 dark:ring-white/10 group-hover:ring-[#EC4141]/30 transition">
                <img
                  v-if="getLocalAlbumCover(album)"
                  :src="getLocalAlbumCover(album)"
                  class="w-full h-full object-cover"
                  alt=""
                  loading="lazy"
                />
                <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
              </div>
              <p class="text-sm font-medium text-black dark:text-white truncate w-full">{{ album.name }}</p>
              <p class="text-xs text-black/50 dark:text-white/50 truncate">{{ album.artist }}</p>
            </button>
            <!-- 插件专辑 -->
            <button
              v-for="album in pluginAlbumResults"
              :key="`p-album-${album.id}`"
              type="button"
              class="flex flex-col gap-2 p-3 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer group"
              @click="handlePluginAlbumClick(album)"
            >
              <div class="aspect-square rounded-lg bg-black/10 dark:bg-white/10 overflow-hidden flex items-center justify-center text-[#EC4141] text-2xl font-black shrink-0 ring-1 ring-black/5 dark:ring-white/10 group-hover:ring-[#EC4141]/30 transition">
                <img v-if="album.coverUrl" :src="album.coverUrl" class="w-full h-full object-cover" alt="" loading="lazy" @error="handlePluginImgError($event)" />
                <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
              </div>
              <p class="text-sm font-medium text-black dark:text-white truncate w-full">{{ album.name }}</p>
              <p class="text-xs text-black/50 dark:text-white/50 truncate">{{ album.artist }}</p>
            </button>
          </div>
        </div>

        <!-- 歌单搜索结果（本地 + 插件） -->
        <div v-else-if="activeSearchType === 'playlist'" class="flex-1 overflow-y-auto custom-scrollbar p-4">
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            <!-- 本地歌单 -->
            <button
              v-for="playlist in localPlaylistResults"
              :key="playlist.id"
              type="button"
              class="flex flex-col gap-2 p-3 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer group"
              @click="handlePlaylistClick(playlist)"
            >
              <div class="aspect-square rounded-lg bg-black/10 dark:bg-white/10 overflow-hidden flex items-center justify-center text-[#EC4141] text-2xl font-black shrink-0 ring-1 ring-black/5 dark:ring-white/10 group-hover:ring-[#EC4141]/30 transition">
                <img
                  v-if="getPlaylistCover(playlist)"
                  :src="getPlaylistCover(playlist)"
                  class="w-full h-full object-cover"
                  alt=""
                  loading="lazy"
                />
                <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
              </div>
              <p class="text-sm font-medium text-black dark:text-white truncate w-full">{{ playlist.name }}</p>
              <p class="text-xs text-black/50 dark:text-white/50">{{ playlist.songPaths.length }} 首</p>
            </button>
            <!-- 插件歌单 -->
            <button
              v-for="playlist in pluginPlaylistResults"
              :key="`p-playlist-${playlist.id}`"
              type="button"
              class="flex flex-col gap-2 p-3 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer group"
              @click="handlePluginPlaylistClick(playlist)"
            >
              <div class="aspect-square rounded-lg bg-black/10 dark:bg-white/10 overflow-hidden flex items-center justify-center text-[#EC4141] text-2xl font-black shrink-0 ring-1 ring-black/5 dark:ring-white/10 group-hover:ring-[#EC4141]/30 transition">
                <img v-if="playlist.coverUrl" :src="playlist.coverUrl" class="w-full h-full object-cover" alt="" loading="lazy" @error="handlePluginImgError($event)" />
                <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
              </div>
              <p class="text-sm font-medium text-black dark:text-white truncate w-full">{{ playlist.title }}</p>
              <p class="text-xs text-black/50 dark:text-white/50">{{ playlist.trackCount ? `${playlist.trackCount} 首` : '查看' }}</p>
            </button>
          </div>
        </div>
      </section>
    </div>

    <DragGhost />

    <SongContextMenu
      :visible="showContextMenu"
      :x="contextMenuX"
      :y="contextMenuY"
      :song="contextMenuTargetSong"
      :is-playlist-view="false"
      :is-online-search="true"
      @close="showContextMenu = false"
      @add-to-playlist="openAddToPlaylistSelection"
      @view-online-artist="handleOnlineViewArtist"
      @view-online-album="handleOnlineViewAlbum"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onMounted, ref, shallowRef, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useRouter } from 'vue-router';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { Song, ArtistCatalogItem, AlbumCatalogItem, Playlist } from '../types';
import { usePlaybackController } from '../features/playback/usePlaybackController';
import { useUiStore } from '../shared/stores/ui';
import { useNavigationStore } from '../shared/stores/navigation';
import { useLibraryStore } from '../features/library/store';
import { useLibraryBrowse } from '../features/library/useLibraryBrowse';
import { useCollectionsStore } from '../features/collections/store';
import { useAddToPlaylistDialog } from '../features/collections/addToPlaylistDialog';
import { useToast } from '../composables/toast';
import {
  lxSearch,
  lxGetPic,
  LX_SOURCE_NAMES,
  type LxSearchResultItem,
  type LxSourceId,
} from '../services/lxMusicSdk';
import { parseIntervalToSeconds } from '../utils/remoteSong';
import { cacheLxSong } from '../services/lxSongCache';
import {
  getStoredPlugins,
  pluginSearch,
  pluginGetMusicInfo,
  pluginGetLyric,
  pluginGetCover,
  pluginArtistSearch,
  pluginAlbumSearch,
  pluginPlaylistSearch,
  pluginSupportsSearchType,
} from '../services/pluginEngine';
import type { PluginArtistResult, PluginAlbumResult } from '../services/pluginEngine';
import type { PluginSource, PluginSearchResult, PluginPlaylistSearchResult } from '../types';
import { useOnlineDetailStore, type SourceSearchType } from '../features/onlineDetail/store';
import { cacheLxSongInfo } from '../services/lxLyricFetcher';

import DragGhost from '../components/common/DragGhost.vue';
import SongContextMenu from '../components/overlays/SongContextMenu.vue';

const router = useRouter();
const { playSong } = usePlaybackController();
const uiStore = useUiStore();
const navigationStore = useNavigationStore();
const libraryStore = useLibraryStore();
const collectionsStore = useCollectionsStore();
const { openAddToPlaylistDialog } = useAddToPlaylistDialog();
const { showToast } = useToast();
const { searchQuery } = storeToRefs(navigationStore);
const { canonicalSongs } = storeToRefs(libraryStore);
const { artistList, albumList } = useLibraryBrowse();
const { playlists } = storeToRefs(collectionsStore);

// ==================== 内容类型切换 ====================
type SearchTypeKey = 'track' | 'artist' | 'album' | 'playlist';
const activeSearchType = ref<SearchTypeKey>('track');
const searchTabs: { type: SearchTypeKey; label: string }[] = [
  { type: 'track', label: '音乐' },
  { type: 'artist', label: '作者' },
  { type: 'album', label: '专辑' },
  { type: 'playlist', label: '歌单' },
];

const handleSearchTypeChange = (type: SearchTypeKey) => {
  activeSearchType.value = type;
};

// ==================== 来源列表（从插件加载，无插件则索引本地）====================
type SourceItem = {
  id: string;
  name: string;
  type: 'musicfree' | 'lx' | 'local';
  source?: PluginSource;
  lxSourceId?: LxSourceId;
};

const pluginSourceList = ref<SourceItem[]>([]);

/** LX 支持的源 ID 集合 */
const VALID_LX_SOURCES: ReadonlySet<string> = new Set(['kw', 'kg', 'tx', 'wy', 'mg']);

function refreshPluginSourceList() {
  const plugins = getStoredPlugins().filter(p => p.enabled);
  const items: SourceItem[] = [];
  for (const p of plugins) {
    if (p.format === 'musicfree') {
      // MusicFree 插件：单个平台 = 单个来源条目
      items.push({ id: p.id, name: p.name, type: 'musicfree', source: p });
    } else if (p.format === 'lx' && p.sources.length > 0) {
      // LX 插件：解析出所有受支持的音源平台
      const lxSources = p.sources.filter(s => VALID_LX_SOURCES.has(s)) as LxSourceId[];
      if (lxSources.length === 0) continue;

      if (lxSources.length === 1) {
        // 单平台：直接以插件名显示
        items.push({ id: p.id, name: p.name, type: 'lx', source: p, lxSourceId: lxSources[0] });
      } else {
        // 多平台：每个平台拆分为独立来源条目，以平台名显示
        for (const sourceId of lxSources) {
          items.push({
            id: `${p.id}__${sourceId}`,
            name: LX_SOURCE_NAMES[sourceId],
            type: 'lx',
            source: p,
            lxSourceId: sourceId,
          });
        }
      }
    }
  }
  pluginSourceList.value = items;
}

// 统一来源列表 = 插件音源；无插件时显示"本地"
const allSourceList = computed<SourceItem[]>(() => {
  if (pluginSourceList.value.length === 0) {
    return [{ id: 'local', name: '本地', type: 'local' }];
  }
  return pluginSourceList.value;
});

// 当前选中的来源 ID
const selectedSourceId = ref<string>('');

const selectedSourceItem = computed(() =>
  allSourceList.value.find(s => s.id === selectedSourceId.value),
);

const selectedSourceName = computed(() =>
  selectedSourceItem.value?.name ?? '未知音源',
);

const isLocalSource = computed(() => selectedSourceItem.value?.type === 'local');

// ==================== 搜索状态 ====================
const searching = ref(false);
const loadingMore = ref(false);
const hasMore = ref(false);
const currentPage = ref(1);
const lxSearchResults = shallowRef<LxSearchResultItem[]>([]);
const pluginSearchResults = shallowRef<PluginSearchResult[]>([]);
const localSearchResults = shallowRef<Song[]>([]);
const localArtistResults = shallowRef<ArtistCatalogItem[]>([]);
const localAlbumResults = shallowRef<AlbumCatalogItem[]>([]);
const localPlaylistResults = shallowRef<Playlist[]>([]);
// 插件来源的歌手/专辑/歌单搜索结果
const pluginArtistResults = shallowRef<PluginArtistResult[]>([]);
const pluginAlbumResults = shallowRef<PluginAlbumResult[]>([]);
const pluginPlaylistResults = shallowRef<PluginPlaylistSearchResult[]>([]);
const resultsScrollRef = ref<HTMLElement | null>(null);

// 封面加载任务版本号，用于在新搜索时取消旧任务
let coverLoadVersion = 0;

// 右键菜单
const showContextMenu = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuTargetSong = ref<Song | null>(null);

// 是否有搜索关键词
const hasQuery = computed(() => searchQuery.value.trim().length > 0);

// 当前类型的结果数量
const resultCount = computed(() => {
  if (activeSearchType.value === 'track') {
    return lxSearchResults.value.length + pluginSearchResults.value.length + localSearchResults.value.length;
  }
  if (isLocalSource.value) {
    if (activeSearchType.value === 'artist') return localArtistResults.value.length;
    if (activeSearchType.value === 'album') return localAlbumResults.value.length;
    if (activeSearchType.value === 'playlist') return localPlaylistResults.value.length;
  }
  // 插件来源
  if (activeSearchType.value === 'artist') return pluginArtistResults.value.length;
  if (activeSearchType.value === 'album') return pluginAlbumResults.value.length;
  if (activeSearchType.value === 'playlist') return pluginPlaylistResults.value.length;
  return 0;
});

// 当前类型是否无结果
const hasNoResults = computed(() => {
  if (activeSearchType.value === 'track') {
    return lxSearchResults.value.length === 0 && pluginSearchResults.value.length === 0 && localSearchResults.value.length === 0;
  }
  if (isLocalSource.value) {
    if (activeSearchType.value === 'artist') return localArtistResults.value.length === 0;
    if (activeSearchType.value === 'album') return localAlbumResults.value.length === 0;
    if (activeSearchType.value === 'playlist') return localPlaylistResults.value.length === 0;
  }
  // 插件来源
  if (activeSearchType.value === 'artist') return pluginArtistResults.value.length === 0;
  if (activeSearchType.value === 'album') return pluginAlbumResults.value.length === 0;
  if (activeSearchType.value === 'playlist') return pluginPlaylistResults.value.length === 0;
  return true;
});

// ==================== 搜索逻辑 ====================
let searchAbortController: AbortController | null = null;

const performSearch = async () => {
  const query = searchQuery.value.trim();
  if (!query) {
    lxSearchResults.value = [];
    pluginSearchResults.value = [];
    localSearchResults.value = [];
    localArtistResults.value = [];
    localAlbumResults.value = [];
    localPlaylistResults.value = [];
    pluginArtistResults.value = [];
    pluginAlbumResults.value = [];
    pluginPlaylistResults.value = [];
    hasMore.value = false;
    return;
  }

  // 非音乐类型搜索：本地来源与 MusicFree 插件支持；LX 插件不支持（仅音乐）
  if (activeSearchType.value !== 'track' && selectedSourceItem.value?.type === 'lx') {
    return;
  }

  // 取消上一次搜索
  if (searchAbortController) {
    searchAbortController.abort();
  }
  searchAbortController = new AbortController();

  // 重置分页
  currentPage.value = 1;
  hasMore.value = false;
  searching.value = true;
  try {
    const source = selectedSourceItem.value;
    if (!source) return;

    if (source.type === 'local') {
      // 本地搜索：根据搜索类型分别索引
      pluginSearchResults.value = [];
      lxSearchResults.value = [];
      pluginArtistResults.value = [];
      pluginAlbumResults.value = [];
      pluginPlaylistResults.value = [];
      // 清空所有类型结果，仅填充当前类型
      localSearchResults.value = [];
      localArtistResults.value = [];
      localAlbumResults.value = [];
      localPlaylistResults.value = [];
      const lowerQuery = query.toLowerCase();

      if (activeSearchType.value === 'track') {
        // 音乐：从本地音乐库过滤
        localSearchResults.value = canonicalSongs.value.filter(song =>
          song.name.toLowerCase().includes(lowerQuery) ||
          song.artist.toLowerCase().includes(lowerQuery) ||
          song.album.toLowerCase().includes(lowerQuery),
        ).slice(0, 200);
      } else if (activeSearchType.value === 'artist') {
        // 作者：从本地歌手索引过滤
        localArtistResults.value = artistList.value.filter(artist =>
          (artist.name || '').toLowerCase().includes(lowerQuery),
        ).slice(0, 200);
      } else if (activeSearchType.value === 'album') {
        // 专辑：从本地专辑索引过滤
        localAlbumResults.value = albumList.value.filter(album =>
          (album.name || '').toLowerCase().includes(lowerQuery) ||
          (album.artist || '').toLowerCase().includes(lowerQuery),
        ).slice(0, 200);
      } else if (activeSearchType.value === 'playlist') {
        // 歌单：从本地歌单过滤
        localPlaylistResults.value = playlists.value.filter(playlist =>
          (playlist.name || '').toLowerCase().includes(lowerQuery),
        ).slice(0, 200);
      }
      hasMore.value = false;
    } else if (source.type === 'lx' && source.lxSourceId) {
      // 落雪 LX 插件搜索
      pluginSearchResults.value = [];
      pluginArtistResults.value = [];
      pluginAlbumResults.value = [];
      pluginPlaylistResults.value = [];
      localSearchResults.value = [];
      const result = await lxSearch(source.lxSourceId, query, 1);
      if (searchAbortController.signal.aborted) return;
      lxSearchResults.value = result.list;
      hasMore.value = result.list.length >= result.limit;
      triggerCoverLoading();
    } else if (source.type === 'musicfree' && source.source) {
      // MusicFree 插件搜索
      lxSearchResults.value = [];
      localSearchResults.value = [];
      localArtistResults.value = [];
      localAlbumResults.value = [];
      localPlaylistResults.value = [];

      if (activeSearchType.value === 'track') {
        // 音乐搜索
        pluginArtistResults.value = [];
        pluginAlbumResults.value = [];
        pluginPlaylistResults.value = [];
        const results = await pluginSearch(source.source, query, 1, 30);
        if (searchAbortController.signal.aborted) return;
        pluginSearchResults.value = results;
        hasMore.value = results.length >= 30;
      } else if (activeSearchType.value === 'artist') {
        // 歌手搜索
        pluginSearchResults.value = [];
        if (pluginSupportsSearchType(source.source, 'artist')) {
          const results = await pluginArtistSearch(source.source, query, 1);
          if (searchAbortController.signal.aborted) return;
          pluginArtistResults.value = results;
        } else {
          pluginArtistResults.value = [];
        }
        hasMore.value = false;
      } else if (activeSearchType.value === 'album') {
        // 专辑搜索
        pluginSearchResults.value = [];
        if (pluginSupportsSearchType(source.source, 'album')) {
          const results = await pluginAlbumSearch(source.source, query, 1);
          if (searchAbortController.signal.aborted) return;
          pluginAlbumResults.value = results;
        } else {
          pluginAlbumResults.value = [];
        }
        hasMore.value = false;
      } else if (activeSearchType.value === 'playlist') {
        // 歌单搜索
        pluginSearchResults.value = [];
        if (pluginSupportsSearchType(source.source, 'sheet')) {
          const results = await pluginPlaylistSearch(source.source, query, 1);
          if (searchAbortController.signal.aborted) return;
          pluginPlaylistResults.value = results;
        } else {
          pluginPlaylistResults.value = [];
        }
        hasMore.value = false;
      }
    }
  } catch (err) {
    if (!searchAbortController.signal.aborted) {
      console.warn('[Search] failed:', err);
      lxSearchResults.value = [];
      pluginSearchResults.value = [];
      localSearchResults.value = [];
      localArtistResults.value = [];
      localAlbumResults.value = [];
      localPlaylistResults.value = [];
      pluginArtistResults.value = [];
      pluginAlbumResults.value = [];
      pluginPlaylistResults.value = [];
    }
  } finally {
    if (!searchAbortController.signal.aborted) {
      searching.value = false;
    }
  }
};

/** 加载下一页 */
const loadMore = async () => {
  if (loadingMore.value || !hasMore.value || searching.value) return;
  const query = searchQuery.value.trim();
  if (!query) return;

  // 本地搜索不分页
  if (isLocalSource.value) {
    hasMore.value = false;
    return;
  }

  loadingMore.value = true;
  const nextPage = currentPage.value + 1;
  try {
    const source = selectedSourceItem.value;
    if (!source) return;

    if (source.type === 'lx' && source.lxSourceId) {
      // 落雪 LX 插件分页
      const result = await lxSearch(source.lxSourceId, query, nextPage);
      if (result.list.length > 0) {
        currentPage.value = nextPage;
        lxSearchResults.value = [...lxSearchResults.value, ...result.list];
        hasMore.value = result.list.length >= result.limit;
        triggerCoverLoading();
      } else {
        hasMore.value = false;
      }
    } else if (source.type === 'musicfree' && source.source) {
      // MusicFree 插件分页
      const results = await pluginSearch(source.source, query, nextPage, 30);
      if (results.length > 0) {
        currentPage.value = nextPage;
        pluginSearchResults.value = [...pluginSearchResults.value, ...results];
        hasMore.value = results.length >= 30;
      } else {
        hasMore.value = false;
      }
    }
  } catch (err) {
    console.warn('[Search] loadMore failed:', err);
    hasMore.value = false;
  } finally {
    loadingMore.value = false;
  }
};

/** 滚动事件：接近底部时自动加载更多 */
const handleScroll = () => {
  const el = resultsScrollRef.value;
  if (!el || loadingMore.value || !hasMore.value) return;
  const { scrollTop, scrollHeight, clientHeight } = el;
  // 距离底部 200px 时触发加载
  if (scrollHeight - scrollTop - clientHeight < 200) {
    loadMore();
  }
};

/** 触发封面加载（滑动窗口并发版） */
function triggerCoverLoading() {
  const version = ++coverLoadVersion;
  // 只处理还没有封面（img 为 null）的项目，已失败的（''）不再重试
  const items = lxSearchResults.value.filter(item => item.img === null);
  if (items.length === 0) return;

  // 滑动窗口并发：始终保持 N 个请求在飞行中，一个完成立刻取下一个
  const CONCURRENCY = 8;
  let nextIdx = 0;
  let hasUpdate = false;

  const worker = async () => {
    while (nextIdx < items.length) {
      if (version !== coverLoadVersion) return; // 新搜索来了，停止旧任务
      const item = items[nextIdx++];
      try {
        // 每个请求最多等 8 秒，超时直接跳过
        const picUrl = await Promise.race([
          lxGetPic(item),
          new Promise<null>(resolve => setTimeout(() => resolve(null), 8000)),
        ]);
        if (version !== coverLoadVersion) return;
        if (picUrl) {
          item.img = picUrl;
          hasUpdate = true;
        } else {
          item.img = ''; // 标记为已尝试，避免重复请求
        }
      } catch {
        item.img = '';
      }
    }
  };

  // 启动 N 个 worker 并发消费队列
  const workers = Array.from({ length: CONCURRENCY }, () => worker());

  // 定时把已更新的封面刷到视图（500ms 一次，减少不必要的渲染）
  const uiTimer = setInterval(() => {
    if (version !== coverLoadVersion) {
      clearInterval(uiTimer);
      return;
    }
    if (hasUpdate) {
      hasUpdate = false;
      lxSearchResults.value = [...lxSearchResults.value];
    }
  }, 500);

  // 全部完成后做最后一次刷新并清理定时器
  Promise.all(workers).then(() => {
    clearInterval(uiTimer);
    if (version === coverLoadVersion && hasUpdate) {
      lxSearchResults.value = [...lxSearchResults.value];
    }
  });
}

/** 封面加载失败时，清除 img 以显示占位符 */
const handleImgError = (item: LxSearchResultItem) => {
  item.img = '';
  lxSearchResults.value = [...lxSearchResults.value];
};

// 切换来源
const handleSelectSource = (source: SourceItem) => {
  selectedSourceId.value = source.id;
};

// 监听关键词变化（防抖）
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
watch(searchQuery, () => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    performSearch();
  }, 400);
});

// 监听来源变化，立即重新搜索
watch(selectedSourceId, () => {
  performSearch();
});

// 监听搜索类型变化，重新搜索
watch(activeSearchType, () => {
  performSearch();
});

// 播放搜索到的歌曲
const handlePlaySong = (item: LxSearchResultItem) => {
  // 缓存完整歌曲元信息（hash/_types/copyrightId 等），供 playerPlayback 解析 URL 时使用
  cacheLxSong(item);
  // 同时缓存到 lxLyricFetcher（供歌词获取使用）
  cacheLxSongInfo(item.source, item.songmid, {
    songmid: item.songmid,
    hash: item.hash,
    name: item.name,
    singer: item.singer,
    albumName: item.albumName,
    interval: item.interval,
    songId: item.songId,
    strMediaMid: item.strMediaMid,
    albumMid: item.albumMid,
    albumId: item.albumId,
    copyrightId: item.copyrightId,
    source: item.source,
  });
  // 构造 Song 对象，使用 lx:// 协议
  const artistNames = item.singer ? item.singer.split('、').filter(Boolean) : ['未知歌手'];
  const song: Song = {
    name: item.name,
    title: item.name,
    path: `lx://${item.source}/${item.songmid}`,
    artist: item.singer || '未知歌手',
    artist_names: artistNames,
    effective_artist_names: artistNames,
    album: item.albumName || '未知专辑',
    album_artist: item.singer || '未知歌手',
    album_key: `${item.albumName || '未知专辑'}-${item.singer || '未知歌手'}`,
    is_various_artists_album: false,
    collapse_artist_credits: false,
    duration: parseIntervalToSeconds(item.interval),
    cover_thumb_path: item.img || '',
    source_type: 'remote',
    remote_source_id: `lx://${item.source}/${item.songmid}`,
  } as any;
  // 传递 LX 解析所需的元信息
  (song as any)._hash = item.hash;
  (song as any)._types = item._types;
  (song as any)._copyrightId = item.copyrightId;
  (song as any)._songmid = item.songmid;
  (song as any)._source = item.source;
  void playSong(song, { insertAfterCurrent: true });
};

// ==================== MusicFree 插件歌曲播放 ====================

const formatMfDuration = (seconds: number): string => {
  if (!seconds || Number.isNaN(seconds)) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

// B站图片代理：hdslb.com/bilivideo.com 需要 Referer 头
const mfCoverProxyCache = new Map<string, string>();
const getMfCoverUrl = (item: PluginSearchResult) => {
  if (!item.coverUrl) return '';
  // 非 B站 URL 直接返回
  if (!item.coverUrl.includes('hdslb.com') && !item.coverUrl.includes('bilivideo.com')) {
    return item.coverUrl;
  }
  // 已缓存 data URL
  const cached = mfCoverProxyCache.get(item.id);
  if (cached) return cached;
  // 异步代理并刷新
  (async () => {
    try {
      const { pluginApi } = await import('../services/tauri/pluginApi');
      const dataUrl = await pluginApi.proxyImage(item.coverUrl);
      mfCoverProxyCache.set(item.id, dataUrl);
      // 触发响应式更新
      pluginSearchResults.value = [...pluginSearchResults.value];
    } catch { /* ignore */ }
  })();
  return item.coverUrl; // 先显示原图（可能 403），代理完成后刷新
};

const handleMfImgError = (e: Event) => {
  (e.target as HTMLImageElement).style.display = 'none';
};

const handlePlayMfSong = async (item: PluginSearchResult) => {
  const mfSource = pluginSourceList.value.find(s => s.id === item.pluginId && s.type === 'musicfree');
  if (!mfSource || !mfSource.source) {
    console.warn('[MusicFree] 插件未找到:', item.pluginId);
    return;
  }
  const pluginSrc = mfSource.source;

  try {
    // 1. 通过插件获取播放 URL（与 MusicFree PluginMethods.getMediaSource 完全一致）
    const musicInfo = await pluginGetMusicInfo(pluginSrc, item, 'standard');
    if (!musicInfo?.url) {
      console.warn('[MusicFree] 无法获取播放URL:', item.title);
      return;
    }

    const artistNames = item.artist ? item.artist.split(/[、,/&]/).filter(Boolean).map(s => s.trim()) : ['未知歌手'];
    const song: Song = {
      name: item.title,
      title: item.title,
      path: musicInfo.url,
      artist: item.artist || '未知歌手',
      artist_names: artistNames,
      effective_artist_names: artistNames,
      album: item.album || '未知专辑',
      album_artist: item.artist || '未知歌手',
      album_key: `${item.album || '未知专辑'}-${item.artist || '未知歌手'}`,
      is_various_artists_album: false,
      collapse_artist_credits: false,
      duration: Math.floor((item.duration || 0) / 1000),
      cover_thumb_path: item.coverUrl || musicInfo.coverUrl || '',
      source_type: 'remote',
      remote_source_id: musicInfo.url,
    } as any;

    // 2. 从 getMediaSource 返回值中提取歌词
    if (musicInfo.lyric) {
      (song as any).lyrics_raw = musicInfo.lyric;
      if (musicInfo.tlyric) {
        (song as any).lyrics_raw += '\n[offset:0]\n' + musicInfo.tlyric;
      }
    }

    // 3. 如果没有歌词，通过插件获取
    if (!(song as any).lyrics_raw) {
      try {
        const lyricData = await pluginGetLyric(pluginSrc, item);
        if (lyricData?.lyric) {
          (song as any).lyrics_raw = lyricData.lyric;
          if (lyricData.tlyric) {
            (song as any).lyrics_raw += '\n[offset:0]\n' + lyricData.tlyric;
          }
        }
      } catch { /* ignore */ }
    }

    // 4. 如果没有封面，通过插件获取
    if (!song.cover_thumb_path) {
      try {
        const coverUrl = await pluginGetCover(pluginSrc, item);
        if (coverUrl) {
          song.cover_thumb_path = coverUrl;
        }
      } catch { /* ignore */ }
    }

    // 5. 设置播放队列（与 YinDongMusic 完全一致）
    const allSongs = pluginSearchResults.value.map((mfItem) => {
      const aNames = mfItem.artist ? mfItem.artist.split(/[、,/&]/).filter(Boolean).map(s => s.trim()) : ['未知歌手'];
      return {
        name: mfItem.title,
        title: mfItem.title,
        path: '',
        artist: mfItem.artist || '未知歌手',
        artist_names: aNames,
        effective_artist_names: aNames,
        album: mfItem.album || '未知专辑',
        album_artist: mfItem.artist || '未知歌手',
        album_key: `${mfItem.album || '未知专辑'}-${mfItem.artist || '未知歌手'}`,
        is_various_artists_album: false,
        collapse_artist_credits: false,
        duration: Math.floor((mfItem.duration || 0) / 1000),
        cover_thumb_path: mfItem.coverUrl || '',
        source_type: 'remote' as const,
      } as Song;
    });
    const songIndex = allSongs.findIndex(s => s.name === song.name && s.artist === song.artist);
    if (songIndex >= 0) {
      allSongs[songIndex] = song;
    }

    void playSong(song, { insertAfterCurrent: true });
  } catch (e: any) {
    console.warn('[MusicFree] 播放失败:', e?.message);
  }
};

const handleMfContextMenu = (e: MouseEvent, item: PluginSearchResult) => {
  e.preventDefault();
  const artistNames = item.artist ? item.artist.split(/[、,/&]/).filter(Boolean).map(s => s.trim()) : ['未知歌手'];
  contextMenuTargetSong.value = {
    name: item.title,
    title: item.title,
    path: `plugin://${item.platform}/${item.id}`,
    artist: item.artist || '未知歌手',
    artist_names: artistNames,
    effective_artist_names: artistNames,
    album: item.album || '未知专辑',
    album_artist: item.artist || '未知歌手',
    album_key: `${item.album || '未知专辑'}-${item.artist || '未知歌手'}`,
    is_various_artists_album: false,
    collapse_artist_credits: false,
    duration: item.duration || 0,
    cover_thumb_path: item.coverUrl || '',
    source_type: 'remote',
    remote_source_id: `plugin://${item.platform}/${item.id}`,
    rawData: item,
  } as any;
  contextMenuX.value = e.clientX;
  contextMenuY.value = e.clientY;
  showContextMenu.value = true;
};

// 右键菜单
const handleContextMenu = (e: MouseEvent, item: LxSearchResultItem) => {
  e.preventDefault();
  // 缓存完整歌曲元信息（hash/_types/copyrightId 等），供 playerPlayback 解析 URL 时使用
  // 下一首播放/添加到队尾等操作会延迟调用 playSong，必须提前缓存否则解析失败
  cacheLxSong(item);
  cacheLxSongInfo(item.source, item.songmid, {
    songmid: item.songmid,
    hash: item.hash,
    name: item.name,
    singer: item.singer,
    albumName: item.albumName,
    interval: item.interval,
    songId: item.songId,
    strMediaMid: item.strMediaMid,
    albumMid: item.albumMid,
    albumId: item.albumId,
    copyrightId: item.copyrightId,
    source: item.source,
  });
  const artistNames = item.singer ? item.singer.split('、').filter(Boolean) : ['未知歌手'];
  contextMenuTargetSong.value = {
    name: item.name,
    title: item.name,
    path: `lx://${item.source}/${item.songmid}`,
    artist: item.singer || '未知歌手',
    artist_names: artistNames,
    effective_artist_names: artistNames,
    album: item.albumName || '未知专辑',
    album_artist: item.singer || '未知歌手',
    album_key: `${item.albumName || '未知专辑'}-${item.singer || '未知歌手'}`,
    is_various_artists_album: false,
    collapse_artist_credits: false,
    duration: parseIntervalToSeconds(item.interval),
    cover_thumb_path: item.img || '',
    source_type: 'remote',
    remote_source_id: `lx://${item.source}/${item.songmid}`,
    _hash: item.hash,
    _types: item._types,
    _copyrightId: item.copyrightId,
    _songmid: item.songmid,
    _source: item.source,
  } as any;
  contextMenuX.value = e.clientX;
  contextMenuY.value = e.clientY;
  showContextMenu.value = true;
};

const openAddToPlaylistSelection = () => {
  const song = contextMenuTargetSong.value;
  if (!song) return;

  // 缓存在线歌曲元信息到 extraSongPool，确保歌单中能正确显示
  libraryStore.setExtraSong(song);

  // 触发原生收藏到歌单弹窗，同时传入完整 Song 对象用于持久化
  openAddToPlaylistDialog([song.path], { songs: [song] });
};

// ==================== 在线搜索右键：歌手/专辑导航 ====================

const handleOnlineViewArtist = async (song: Song) => {
  const artistName = song.effective_artist_names?.[0] || song.artist_names?.[0] || song.artist || '';
  if (!artistName || artistName === '未知歌手') {
    showToast('当前歌曲缺少歌手信息', 'info');
    return;
  }

  const pluginSource = selectedSourceItem.value?.source;
  if (!pluginSource) {
    showToast('当前音源不支持查看歌手', 'info');
    return;
  }

  // MusicFree 插件：搜索歌手后跳转到歌手详情页
  if (selectedSourceItem.value?.type === 'musicfree') {
    try {
      const results = await pluginArtistSearch(pluginSource, artistName, 1);
      if (results.length === 0) {
        showToast('未找到该歌手', 'info');
        return;
      }
      const artist = results[0];
      onlineDetailStore.setContext({
        type: 'artist',
        title: artist.name,
        subtitle: artist.description || (artist.songCount ? `${artist.songCount} 首歌曲` : ''),
        coverUrl: artist.avatarUrl,
        pluginSource,
        rawData: artist.rawData,
        sourceSearchType: activeSearchType.value as SourceSearchType,
      });
      void router.push({ path: '/online-detail', query: { type: 'artist' } });
    } catch (e: any) {
      showToast(`查看歌手失败: ${e?.message || e}`, 'error');
    }
    return;
  }

  // LX 落雪源暂不支持歌手详情页
  showToast('当前音源暂不支持查看歌手', 'info');
};

const handleOnlineViewAlbum = async (song: Song) => {
  const albumName = song.album || '';
  if (!albumName || albumName === '未知专辑') {
    showToast('当前歌曲缺少专辑信息', 'info');
    return;
  }

  const pluginSource = selectedSourceItem.value?.source;
  if (!pluginSource) {
    showToast('当前音源不支持查看专辑', 'info');
    return;
  }

  // MusicFree 插件：搜索专辑后跳转到专辑详情页
  if (selectedSourceItem.value?.type === 'musicfree') {
    try {
      const results = await pluginAlbumSearch(pluginSource, albumName, 1);
      if (results.length === 0) {
        showToast('未找到该专辑', 'info');
        return;
      }
      const album = results[0];
      onlineDetailStore.setContext({
        type: 'album',
        title: album.name,
        subtitle: album.artist,
        coverUrl: album.coverUrl,
        pluginSource,
        rawData: album.rawData,
        sourceSearchType: activeSearchType.value as SourceSearchType,
      });
      void router.push({ path: '/online-detail', query: { type: 'album' } });
    } catch (e: any) {
      showToast(`查看专辑失败: ${e?.message || e}`, 'error');
    }
    return;
  }

  // LX 落雪源暂不支持专辑详情页
  showToast('当前音源暂不支持查看专辑', 'info');
};

// ==================== 本地歌曲播放与右键菜单 ====================

const formatLocalDuration = (seconds: number): string => {
  if (!seconds || Number.isNaN(seconds)) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const getLocalCoverUrl = (song: Song): string => {
  if (!song.cover_thumb_path) return '';
  // 本地文件路径通过 convertFileSrc 转为可访问的 URL
  if (song.cover_thumb_path.startsWith('http') || song.cover_thumb_path.startsWith('asset:') || song.cover_thumb_path.startsWith('data:')) {
    return song.cover_thumb_path;
  }
  try {
    return convertFileSrc(song.cover_thumb_path);
  } catch {
    return '';
  }
};

const handlePlayLocalSong = (song: Song) => {
  void playSong(song, { insertAfterCurrent: true });
};

const handleLocalContextMenu = (e: MouseEvent, song: Song) => {
  e.preventDefault();
  contextMenuTargetSong.value = song;
  contextMenuX.value = e.clientX;
  contextMenuY.value = e.clientY;
  showContextMenu.value = true;
};

// ==================== 本地歌手/专辑/歌单导航 ====================

const handleArtistClick = (artist: ArtistCatalogItem) => {
  void router.push({ path: '/', query: { view: 'artist', filter: artist.name } });
};

const handleAlbumClick = (album: AlbumCatalogItem) => {
  void router.push({ path: '/', query: { view: 'album', filter: album.key } });
};

const handlePlaylistClick = (playlist: Playlist) => {
  void router.push({ path: '/', query: { view: 'playlist', filter: playlist.id } });
};

// ==================== 插件歌手/专辑/歌单导航 ====================

const onlineDetailStore = useOnlineDetailStore();

/** 根据 pluginId 查找对应的 PluginSource */
function findPluginSource(pluginId: string): PluginSource | undefined {
  const item = pluginSourceList.value.find(s => s.id === pluginId && s.type === 'musicfree');
  return item?.source;
}

const handlePluginArtistClick = (artist: PluginArtistResult) => {
  const pluginSource = findPluginSource(artist.pluginId);
  if (!pluginSource) {
    void router.push({ path: '/search', query: { q: artist.name } });
    return;
  }
  onlineDetailStore.setContext({
    type: 'artist',
    title: artist.name,
    subtitle: artist.description || (artist.songCount ? `${artist.songCount} 首歌曲` : ''),
    coverUrl: artist.avatarUrl,
    pluginSource,
    rawData: artist.rawData,
    sourceSearchType: 'artist' as SourceSearchType,
  });
  void router.push({ path: '/online-detail', query: { type: 'artist' } });
};

const handlePluginAlbumClick = (album: PluginAlbumResult) => {
  const pluginSource = findPluginSource(album.pluginId);
  if (!pluginSource) {
    void router.push({ path: '/search', query: { q: album.name } });
    return;
  }
  onlineDetailStore.setContext({
    type: 'album',
    title: album.name,
    subtitle: album.artist,
    coverUrl: album.coverUrl,
    pluginSource,
    rawData: album.rawData,
    sourceSearchType: 'album' as SourceSearchType,
  });
  void router.push({ path: '/online-detail', query: { type: 'album' } });
};

const handlePluginPlaylistClick = (playlist: PluginPlaylistSearchResult) => {
  const pluginSource = findPluginSource(playlist.pluginId);
  if (!pluginSource) {
    void router.push({ path: '/search', query: { q: playlist.title } });
    return;
  }
  onlineDetailStore.setContext({
    type: 'playlist',
    title: playlist.title,
    subtitle: playlist.trackCount ? `${playlist.trackCount} 首` : (playlist.artist || ''),
    coverUrl: playlist.coverUrl,
    pluginSource,
    rawData: playlist.rawData,
    sourceSearchType: 'playlist' as SourceSearchType,
  });
  void router.push({ path: '/online-detail', query: { type: 'playlist' } });
};

const handlePluginImgError = (e: Event) => {
  (e.target as HTMLImageElement).style.display = 'none';
};

const getLocalArtistCover = (artist: ArtistCatalogItem): string => {
  if (!artist.avatarPath) return '';
  if (artist.avatarPath.startsWith('http') || artist.avatarPath.startsWith('asset:') || artist.avatarPath.startsWith('data:')) {
    return artist.avatarPath;
  }
  try {
    return convertFileSrc(artist.avatarPath);
  } catch {
    return '';
  }
};

const getLocalAlbumCover = (album: AlbumCatalogItem): string => {
  if (!album.firstSongPath) return '';
  // 通过 firstSongPath 查找对应歌曲的封面
  const song = canonicalSongs.value.find(s => s.path === album.firstSongPath);
  if (song?.cover_thumb_path) {
    if (song.cover_thumb_path.startsWith('http') || song.cover_thumb_path.startsWith('asset:') || song.cover_thumb_path.startsWith('data:')) {
      return song.cover_thumb_path;
    }
    try {
      return convertFileSrc(song.cover_thumb_path);
    } catch {
      return '';
    }
  }
  return '';
};

const getPlaylistCover = (playlist: Playlist): string => {
  if (playlist.coverPath) {
    if (playlist.coverPath.startsWith('http') || playlist.coverPath.startsWith('asset:') || playlist.coverPath.startsWith('data:')) {
      return playlist.coverPath;
    }
    try {
      return convertFileSrc(playlist.coverPath);
    } catch {
      return '';
    }
  }
  // 尝试用歌单内第一首歌的封面
  if (playlist.songPaths.length > 0) {
    const song = canonicalSongs.value.find(s => s.path === playlist.songPaths[0]);
    if (song?.cover_thumb_path) {
      if (song.cover_thumb_path.startsWith('http') || song.cover_thumb_path.startsWith('asset:') || song.cover_thumb_path.startsWith('data:')) {
        return song.cover_thumb_path;
      }
      try {
        return convertFileSrc(song.cover_thumb_path);
      } catch {
        return '';
      }
    }
  }
  return '';
};

// 初始化
onMounted(() => {
  uiStore.showPlayerDetail = false;
  refreshPluginSourceList();
  // 初始化来源选择：优先选第一个插件，无插件则选本地
  if (allSourceList.value.length > 0) {
    selectedSourceId.value = allSourceList.value[0].id;
  }
  // 从在线详情返回时，恢复对应的搜索 tab（"从哪儿来回哪儿去"）
  const pendingType = onlineDetailStore.consumePendingSearchType();
  if (pendingType) {
    activeSearchType.value = pendingType;
  }
  if (!hasQuery.value) return;
  performSearch();
});

// keep-alive 激活时：保持原有状态（滚动位置、选中 tab、搜索结果等）
// 仅消费 pendingSearchType 避免残留，不强制改变当前 tab
onActivated(() => {
  uiStore.showPlayerDetail = false;
  onlineDetailStore.consumePendingSearchType();
});
</script>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.1);
  border-radius: 10px;
}
.dark .custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
}
</style>
