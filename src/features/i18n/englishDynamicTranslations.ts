export const dynamicEnglishTranslations: Array<{
  pattern: RegExp;
  replace: (...matches: string[]) => string;
}> = [
  {
    pattern: /^已添加\s*(\d+)\s*首歌曲到播放队列$/,
    replace: (_match, count) => `Added ${count} songs to the queue`,
  },
  {
    pattern: /^已添加到播放队列$/,
    replace: () => 'Added to the play queue',
  },
  {
    pattern: /^已添加至下一首播放$/,
    replace: () => 'Added to play next',
  },
  {
    pattern: /^成功导入\s*(\d+)\s*首歌曲$/,
    replace: (_match, count) => `Imported ${count} songs`,
  },
  {
    pattern: /^成功读取\s*(\d+)\s*首歌曲$/,
    replace: (_match, count) => `Read ${count} songs`,
  },
  {
    pattern: /^已同步\s*(\d+)\s*首远程歌曲$/,
    replace: (_match, count) => `Synced ${count} remote tracks`,
  },
  {
    pattern: /^已自动更新\s*(\d+)\s*个插件$/,
    replace: (_match, count) => `Automatically updated ${count} plugins`,
  },
  {
    pattern: /^发现\s*(\d+)\s*个插件可更新$/,
    replace: (_match, count) => `${count} plugin updates available`,
  },
  {
    pattern: /^重新发送\s*\((\d+)s\)$/,
    replace: (_match, seconds) => `Resend (${seconds}s)`,
  },
  {
    pattern: /^创建于\s*(.+)$/,
    replace: (_match, date) => `Created ${date}`,
  },
  {
    pattern: /^弦予号[：:]\s*(.+)$/,
    replace: (_match, id) => `XianYu ID: ${id}`,
  },
  {
    pattern: /^导入失败[：:]\s*(.+)$/,
    replace: (_match, error) => `Import failed: ${error}`,
  },
  {
    pattern: /^保存歌曲信息失败[：:]\s*(.+)$/,
    replace: (_match, error) => `Could not save song info: ${error}`,
  },
  {
    pattern: /^日志导出失败[：:]\s*(.+)$/,
    replace: (_match, error) => `Could not export logs: ${error}`,
  },
  {
    pattern: new RegExp("^(.+) 首歌曲$"),
    replace: (_m, g0) => `${g0} songs`,
  },
  {
    pattern: new RegExp("^(.+)（拖拽调整位置）$"),
    replace: (_m, g0) => `${g0} (drag to reposition)`,
  },
  {
    pattern: new RegExp("^查看歌手失败: (.+)$"),
    replace: (_m, g0) => `Failed to view artist: ${g0}`,
  },
  {
    pattern: new RegExp("^查看专辑失败: (.+)$"),
    replace: (_m, g0) => `Failed to view album: ${g0}`,
  },
  {
    pattern: new RegExp("^(.+) 个错误$"),
    replace: (_m, g0) => `${g0} errors`,
  },
  {
    pattern: new RegExp("^(.+) 个文件夹已在音乐库中，已跳过$"),
    replace: (_m, g0) => `${g0} folders already in the library, skipped`,
  },
  {
    pattern: new RegExp("^安装失败: (.+)$"),
    replace: (_m, g0) => `Install failed: ${g0}`,
  },
  {
    pattern: new RegExp("^刷新失败: (.+)$"),
    replace: (_m, g0) => `Refresh failed: ${g0}`,
  },
  {
    pattern: new RegExp("^刷新成功，检测到少了 (.+) 首歌曲$"),
    replace: (_m, g0) => `Refresh succeeded, ${g0} songs are missing`,
  },
  {
    pattern: new RegExp("^下载失败: (.+)$"),
    replace: (_m, g0) => `Download failed: ${g0}`,
  },
  {
    pattern: new RegExp("^已忽略 (.+) 个不支持的文件$"),
    replace: (_m, g0) => `Ignored ${g0} unsupported files`,
  },
  {
    pattern: new RegExp("^\\[getMediaSource\\] 命中短时缓存: (.+), id=(.+), quality=(.+)$"),
    replace: (_m, g0, _g1, _g2) => `[getMediaSource] Short-term cache hit: ${g0}`,
  },
  {
    pattern: new RegExp("^(.+) · 探测中$"),
    replace: (_m, g0) => `${g0} · probing`,
  },
  {
    pattern: new RegExp("^已创建歌单「(.+)」，共 (.+) 首歌曲$"),
    replace: (_m, g0, g1) => `Created playlist "${g0}" with ${g1} songs`,
  },
  {
    pattern: new RegExp("^(.+) 已使用 (.+)$"),
    replace: (_m, g0, g1) => `${g0} is already bound to ${g1}`,
  },
  {
    pattern: new RegExp("^(.+)分钟前$"),
    replace: (_m, g0) => `${g0} minutes ago`,
  },
  {
    pattern: new RegExp("^(.+)小时前$"),
    replace: (_m, g0) => `${g0} hours ago`,
  },
  {
    pattern: new RegExp("^(.+)天前$"),
    replace: (_m, g0) => `${g0} days ago`,
  },
  {
    pattern: new RegExp("^读取文件夹失败: (.+)$"),
    replace: (_m, g0) => `Failed to read folder: ${g0}`,
  },
  {
    pattern: new RegExp("^更新失败: (.+)$"),
    replace: (_m, g0) => `Update failed: ${g0}`,
  },
  {
    pattern: new RegExp("^成功安装 (.+) 个插件$"),
    replace: (_m, g0) => `Installed ${g0} plugins`,
  },
  {
    pattern: new RegExp("^同步失败: (.+)$"),
    replace: (_m, g0) => `Sync failed: ${g0}`,
  },
  {
    pattern: new RegExp("^扫描失败: (.+)$"),
    replace: (_m, g0) => `Scan failed: ${g0}`,
  },
  {
    pattern: new RegExp("^应用修改失败: (.+)$"),
    replace: (_m, g0) => `Failed to apply changes: ${g0}`,
  },
  {
    pattern: new RegExp("^(.+)小时 (.+)分钟$"),
    replace: (_m, g0, g1) => `${g0}h ${g1}m`,
  },
  {
    pattern: new RegExp("^(.+)分钟$"),
    replace: (_m, g0) => `${g0} minutes`,
  },
  {
    pattern: new RegExp("^下载失败：(.+)$"),
    replace: (_m, g0) => `Download failed: ${g0}`,
  },
  {
    pattern: new RegExp("^已跳过 (.+) 首本地歌曲$"),
    replace: (_m, g0) => `Skipped ${g0} local songs`,
  },
  {
    pattern: new RegExp("^开始批量下载 (.+) 首歌曲（同时 (.+) 首）$"),
    replace: (_m, g0, g1) => `Start batch download of ${g0} songs (${g1} at a time)`,
  },
  {
    pattern: new RegExp("^批量下载完成：成功 (.+) 首，失败 (.+) 首$"),
    replace: (_m, g0, g1) => `Batch download done: ${g0} succeeded, ${g1} failed`,
  },
  {
    pattern: new RegExp("^批量下载完成：成功 (.+) 首$"),
    replace: (_m, g0) => `Batch download done: ${g0} succeeded`,
  },
  {
    pattern: new RegExp("^刷新失败: (.+)$"),
    replace: (_m, g0) => `Refresh failed: ${g0}`,
  },
  {
    pattern: new RegExp("^上传失败: (.+)$"),
    replace: (_m, g0) => `Upload failed: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[(.+)\\] 无 getMediaSource 函数$"),
    replace: (_m, g0) => `[${g0}] has no getMediaSource function`,
  },
  {
    pattern: new RegExp("^\\[getMediaSource\\] quality=(.+) 未返回有效URL，尝试下一档$"),
    replace: (_m, g0) => `[getMediaSource] quality=${g0} returned no valid URL, trying next tier`,
  },
  {
    pattern: new RegExp("^非对象\\((.+)\\)$"),
    replace: (_m, g0) => `Not an object (${g0})`,
  },
  {
    pattern: new RegExp("^\\[getMediaSource\\] (.+) 失败: (.+)$"),
    replace: (_m, g0, g1) => `[getMediaSource] ${g0} failed: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[getMediaSource\\] (.+) 返回空URL, result=(.+)$"),
    replace: (_m, g0, g1) => `[getMediaSource] ${g0} returned empty URL, result=${g1}`,
  },
  {
    pattern: new RegExp("^\\[(.+)\\] 返回空URL$"),
    replace: (_m, g0) => `[${g0}] returned empty URL`,
  },
  {
    pattern: new RegExp("^\\[getMediaSource\\] 已清洗异常URL: (.+) -> (.+)$"),
    replace: (_m, g0, _g1) => `[getMediaSource] Sanitized abnormal URL: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[getLyric\\] (.+) 插件未实现 getLyric 方法$"),
    replace: (_m, g0) => `[getLyric] ${g0} plugin does not implement getLyric`,
  },
  {
    pattern: new RegExp("^\\[getLyric\\] (.+) 调用异常: (.+)$"),
    replace: (_m, g0, g1) => `[getLyric] ${g0} threw: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[getLyric\\] (.+) 返回空结果$"),
    replace: (_m, g0) => `[getLyric] ${g0} returned empty result`,
  },
  {
    pattern: new RegExp("^获取歌词失败: (.+) (.+)$"),
    replace: (_m, g0, _g1) => `Failed to fetch lyrics: ${g0}`,
  },
  {
    pattern: new RegExp("^(.+) 第(.+)次为空，(.+)ms后重试\\(共(.+)次\\)$"),
    replace: (_m, g0, g1, g2, g3) => `${g0} empty on attempt ${g1}, retrying after ${g2}ms (${g3} attempts)`,
  },
  {
    pattern: new RegExp("^(.+) 第(.+)次异常: (.+)$"),
    replace: (_m, g0, g1, g2) => `${g0} threw on attempt ${g1}: ${g2}`,
  },
  {
    pattern: new RegExp("^(.+) 异常后 (.+)ms重试\\(共(.+)次\\)$"),
    replace: (_m, g0, g1, g2) => `${g0} retrying after ${g1}ms (${g2} attempts)`,
  },
  {
    pattern: new RegExp("^(.+) 多次尝试后仍为空$"),
    replace: (_m, g0) => `${g0} still empty after multiple attempts`,
  },
  {
    pattern: new RegExp("^请求超时\\((.+)s\\)$"),
    replace: (_m, g0) => `Request timed out (${g0}s)`,
  },
  {
    pattern: new RegExp("^未命名歌单 (.+)$"),
    replace: (_m, g0) => `Untitled playlist ${g0}`,
  },
  {
    pattern: new RegExp("^(.+) 的演唱者 (.+)$"),
    replace: (_m, g0, g1) => `${g0} performer ${g1}`,
  },
  {
    pattern: new RegExp("^(.+) 首$"),
    replace: (_m, g0) => `${g0} songs`,
  },
  {
    pattern: new RegExp("^申诉内容不能超过 (.+) 字$"),
    replace: (_m, g0) => `Appeal content cannot exceed ${g0} characters`,
  },
  {
    pattern: new RegExp("^申请理由不能超过 (.+) 字$"),
    replace: (_m, g0) => `Application reason cannot exceed ${g0} characters`,
  },
  {
    pattern: new RegExp("^等 (.+) 首歌曲$"),
    replace: (_m, g0) => `Waiting for ${g0} songs`,
  },
  {
    pattern: new RegExp("^(.+) 个文件夹$"),
    replace: (_m, g0) => `${g0} folders`,
  },
  {
    pattern: new RegExp("^(.+) 首$"),
    replace: (_m, g0) => `${g0} songs`,
  },
  {
    pattern: new RegExp("^(.+)已被封禁$"),
    replace: (_m, g0) => `${g0} has been banned`,
  },
  {
    pattern: new RegExp("^你的(.+)已被管理员封禁，如有疑问请联系管理员。$"),
    replace: (_m, g0) => `Your ${g0} has been banned by the admin. Contact the admin if you have questions.`,
  },
  {
    pattern: new RegExp("^(.+)暂不能修改$"),
    replace: (_m, g0) => `${g0} cannot be changed for now`,
  },
  {
    pattern: new RegExp("^(.+)今日已修改过啦，请明天再试。$"),
    replace: (_m, g0) => `${g0} was already changed today, please try again tomorrow.`,
  },
  {
    pattern: new RegExp("^已(.+)$"),
    replace: (_m, g0) => `${g0}`,
  },
  {
    pattern: new RegExp("^多歌手: (.+)$"),
    replace: (_m, g0) => `Multi-artist: ${g0}`,
  },
  {
    pattern: new RegExp("^远程: (.+)$"),
    replace: (_m, g0) => `Remote: ${g0}`,
  },
  {
    pattern: new RegExp("^只读: (.+)$"),
    replace: (_m, g0) => `Read-only: ${g0}`,
  },
  {
    pattern: new RegExp("^缺失: (.+)$"),
    replace: (_m, g0) => `Missing: ${g0}`,
  },
  {
    pattern: new RegExp("^写回标签出错: (.+)$"),
    replace: (_m, g0) => `Error writing back tags: ${g0}`,
  },
  {
    pattern: new RegExp("^头像已保存，但没有可写入的本地单人歌曲(.+)。$"),
    replace: (_m, g0) => `Avatar saved, but no local single-artist songs to write to${g0}.`,
  },
  {
    pattern: new RegExp("^歌手头像保存并写回标签完成！成功: (.+) 首，跳过: (.+) 首(.+)，失败: (.+) 首$"),
    replace: (_m, g0, g1, g2, g3) => `Artist avatar saved and tags written back! Succeeded: ${g0}, skipped: ${g1}${g2}, failed: ${g3}`,
  },
  {
    pattern: new RegExp("^(.+) 首歌曲$"),
    replace: (_m, g0) => `${g0} songs`,
  },
  {
    pattern: new RegExp("^MV 已下载：(.+)$"),
    replace: (_m, g0) => `MV downloaded: ${g0}`,
  },
  {
    pattern: new RegExp("^已下载：(.+)（点击重新下载）$"),
    replace: (_m, g0) => `Downloaded: ${g0} (click to re-download)`,
  },
  {
    pattern: new RegExp("^此歌曲已下载过了（(.+)），是否要重新下载？$"),
    replace: (_m, g0) => `This song was already downloaded (${g0}). Re-download?`,
  },
  {
    pattern: new RegExp("^\\[PlayerFooter\\] (.+) 体积探测失败:$"),
    replace: (_m, g0) => `[PlayerFooter] Size probe failed for ${g0}:`,
  },
  {
    pattern: new RegExp("^正在加载远程歌曲 (.+)%$"),
    replace: (_m, g0) => `Loading remote song ${g0}%`,
  },
  {
    pattern: new RegExp("^已创建 (.+) 个歌单，匹配 (.+) 首，(.+) 首未匹配本地文件$"),
    replace: (_m, g0, g1, g2) => `Created ${g0} playlists, matched ${g1} songs, ${g2} not matched to local files`,
  },
  {
    pattern: new RegExp("^已创建 (.+) 个歌单，共 (.+) 首歌曲$"),
    replace: (_m, g0, g1) => `Created ${g0} playlists with ${g1} songs`,
  },
  {
    pattern: new RegExp("^已创建 (.+) 个歌单，导入 (.+) 首，(.+) 首未导入$"),
    replace: (_m, g0, g1, g2) => `Created ${g0} playlists, imported ${g1} songs, ${g2} not imported`,
  },
  {
    pattern: new RegExp("^已创建 (.+) 个歌单，共 (.+) 首歌曲$"),
    replace: (_m, g0, g1) => `Created ${g0} playlists with ${g1} songs`,
  },
  {
    pattern: new RegExp("^(.+)万$"),
    replace: (_m, g0) => `${g0}0K`,
  },
  {
    pattern: new RegExp("^\\[DownloadDialog\\] (.+) 体积探测失败:$"),
    replace: (_m, g0) => `[DownloadDialog] Size probe failed for ${g0}:`,
  },
  {
    pattern: new RegExp("^已应用“(.+)”的歌词$"),
    replace: (_m, g0) => `Applied lyrics from "${g0}"`,
  },
  {
    pattern: new RegExp("^已选中 (.+) 个歌单$"),
    replace: (_m, g0) => `${g0} playlists selected`,
  },
  {
    pattern: new RegExp("^删除选中的 (.+) 个歌单$"),
    replace: (_m, g0) => `Delete ${g0} selected playlists`,
  },
  {
    pattern: new RegExp("^选择文件夹失败: (.+)$"),
    replace: (_m, g0) => `Failed to choose folder: ${g0}`,
  },
  {
    pattern: new RegExp("^选择文件失败: (.+)$"),
    replace: (_m, g0) => `Failed to choose file: ${g0}`,
  },
  {
    pattern: new RegExp("^· 缺失 (.+) 个插件$"),
    replace: (_m, g0) => `· ${g0} plugins missing`,
  },
  {
    pattern: new RegExp("^(.+) · (.+)/(.+) 首可导入(.+)$"),
    replace: (_m, g0, g1, g2, g3) => `${g0} · ${g1}/${g2} songs importable${g3}`,
  },
  {
    pattern: new RegExp("^(.+) 个歌单 · (.+) 首歌曲$"),
    replace: (_m, g0, g1) => `${g0} playlists · ${g1} songs`,
  },
  {
    pattern: new RegExp("^解析失败: (.+)$"),
    replace: (_m, g0) => `Parse failed: ${g0}`,
  },
  {
    pattern: new RegExp("^已导入 (.+) 首歌曲，(.+) 首未导入$"),
    replace: (_m, g0, g1) => `Imported ${g0} songs, ${g1} not imported`,
  },
  {
    pattern: new RegExp("^成功导入 (.+) 个歌单，共 (.+) 首歌曲$"),
    replace: (_m, g0, g1) => `Imported ${g0} playlists with ${g1} songs`,
  },
  {
    pattern: new RegExp("^正在聆听… (.+)/(.+)s$"),
    replace: (_m, g0, g1) => `Listening… ${g0}/${g1}s`,
  },
  {
    pattern: new RegExp("^识别到 (.+) 首匹配$"),
    replace: (_m, g0) => `Recognized ${g0} matches`,
  },
  {
    pattern: new RegExp("^写入失败: (.+)$"),
    replace: (_m, g0) => `Write failed: ${g0}`,
  },
  {
    pattern: new RegExp("^清除失败: (.+)$"),
    replace: (_m, g0) => `Clear failed: ${g0}`,
  },
  {
    pattern: new RegExp("^导出日志（(.+)）$"),
    replace: (_m, g0) => `Export logs (${g0})`,
  },
  {
    pattern: new RegExp("^上传 (.+) 个歌单$"),
    replace: (_m, g0) => `Uploaded ${g0} playlists`,
  },
  {
    pattern: new RegExp("^下载 (.+) 个歌单$"),
    replace: (_m, g0) => `Downloaded ${g0} playlists`,
  },
  {
    pattern: new RegExp("^(.+) 首歌曲$"),
    replace: (_m, g0) => `${g0} songs`,
  },
  {
    pattern: new RegExp("^(.+) 首歌曲$"),
    replace: (_m, g0) => `${g0} songs`,
  },
  {
    pattern: new RegExp("^上传 (.+) 个插件$"),
    replace: (_m, g0) => `Uploaded ${g0} plugins`,
  },
  {
    pattern: new RegExp("^恢复 (.+) 个插件$"),
    replace: (_m, g0) => `Restored ${g0} plugins`,
  },
  {
    pattern: new RegExp("^上传 (.+) 首$"),
    replace: (_m, g0) => `Uploaded ${g0} songs`,
  },
  {
    pattern: new RegExp("^下载 (.+) 首$"),
    replace: (_m, g0) => `Downloaded ${g0} songs`,
  },
  {
    pattern: new RegExp("^登录、注册、找回密码等接口的根地址和签名密钥。自建后端时，请在服务端后台仪表盘复制服务器 API 与 API 签名密钥后填入。默认地址：(.+)$"),
    replace: (_m, g0) => `Root URL and signing key for sign-in, registration, password recovery, etc. When self-hosting, copy the server API and API signing key from the backend dashboard. Default: ${g0}`,
  },
  {
    pattern: new RegExp("^最多上传 (.+) 张图片$"),
    replace: (_m, g0) => `Up to ${g0} images`,
  },
  {
    pattern: new RegExp("^图片 (.+) 超过 8MB，已跳过$"),
    replace: (_m, g0) => `Image ${g0} exceeds 8MB, skipped`,
  },
  {
    pattern: new RegExp("^图片处理失败：(.+)$"),
    replace: (_m, g0) => `Image processing failed: ${g0}`,
  },
  {
    pattern: new RegExp("^提交失败：(.+)$"),
    replace: (_m, g0) => `Submit failed: ${g0}`,
  },
  {
    pattern: new RegExp("^获取反馈失败：(.+)$"),
    replace: (_m, g0) => `Failed to fetch feedback: ${g0}`,
  },
  {
    pattern: new RegExp("^(.+) 个歌单$"),
    replace: (_m, g0) => `${g0} playlists`,
  },
  {
    pattern: new RegExp("^收藏 (.+) 首$"),
    replace: (_m, g0) => `${g0} favorites`,
  },
  {
    pattern: new RegExp("^从 (.+) 安装 (.+) 个插件，(.+) 个失败$"),
    replace: (_m, g0, g1, g2) => `Installed ${g1} plugins from ${g0}, ${g2} failed`,
  },
  {
    pattern: new RegExp("^从 (.+) 安装 (.+) 个插件$"),
    replace: (_m, g0, g1) => `Installed ${g1} plugins from ${g0}`,
  },
  {
    pattern: new RegExp("^从 (.+) 安装 (.+) 个插件\\$\\{result\\.failCount \\?$"),
    replace: (_m, g0, g1) => `Installed ${g1} plugins from ${g0}`,
  },
  {
    pattern: new RegExp("^同步完成: 共安装 (.+) 个插件，(.+) 个订阅失败$"),
    replace: (_m, g0, g1) => `Sync complete: installed ${g0} plugins, ${g1} subscriptions failed`,
  },
  {
    pattern: new RegExp("^同步完成: 共安装 (.+) 个插件$"),
    replace: (_m, g0) => `Sync complete: installed ${g0} plugins`,
  },
  {
    pattern: new RegExp("^同步完成: 共安装 (.+) 个插件\\$\\{res\\.failedSubs \\?$"),
    replace: (_m, g0) => `Sync complete: installed ${g0} plugins`,
  },
  {
    pattern: new RegExp("^(.+) 个插件$"),
    replace: (_m, g0) => `${g0} plugins`,
  },
  {
    pattern: new RegExp("^导出备份失败：(.+)$"),
    replace: (_m, g0) => `Failed to export backup: ${g0}`,
  },
  {
    pattern: new RegExp("^(.+) 个歌单$"),
    replace: (_m, g0) => `${g0} playlists`,
  },
  {
    pattern: new RegExp("^收藏 (.+) 首$"),
    replace: (_m, g0) => `${g0} favorites`,
  },
  {
    pattern: new RegExp("^(.+) 个插件$"),
    replace: (_m, g0) => `${g0} plugins`,
  },
  {
    pattern: new RegExp("^(.+)｜已导入 (.+) 首歌曲，(.+) 首未导入$"),
    replace: (_m, g0, g1, g2) => `${g0}｜Imported ${g1} songs, ${g2} not imported`,
  },
  {
    pattern: new RegExp("^(.+)｜没有歌曲可以导入，请查看缺失插件说明$"),
    replace: (_m, g0) => `${g0}｜No songs to import, please check the missing plugin notes`,
  },
  {
    pattern: new RegExp("^导入备份失败：(.+)$"),
    replace: (_m, g0) => `Failed to import backup: ${g0}`,
  },
  {
    pattern: new RegExp("^当前歌曲不支持 (.+)，新设置将在下一首生效$"),
    replace: (_m, g0) => `This song does not support ${g0}; the new setting applies from the next song`,
  },
  {
    pattern: new RegExp("^探测请求失败\\(HTTP (.+)\\)$"),
    replace: (_m, g0) => `Probe request failed (HTTP ${g0})`,
  },
  {
    pattern: new RegExp("^探测请求被拦截\\((.+)\\)$"),
    replace: (_m, g0) => `Probe request blocked (${g0})`,
  },
  {
    pattern: new RegExp("^当前歌曲不是在线歌曲：(.+)$"),
    replace: (_m, g0) => `The current song is not an online track: ${g0}`,
  },
  {
    pattern: new RegExp("^歌曲: (.+)$"),
    replace: (_m, g0) => `Song: ${g0}`,
  },
  {
    pattern: new RegExp("^请求档位: (.+)$"),
    replace: (_m, g0) => `Requested tier: ${g0}`,
  },
  {
    pattern: new RegExp("^回退行为: (.+)$"),
    replace: (_m, g0) => `Fallback behavior: ${g0}`,
  },
  {
    pattern: new RegExp("^解析命中档位: (.+)$"),
    replace: (_m, g0) => `Resolved tier: ${g0}`,
  },
  {
    pattern: new RegExp("^直链: (.+)$"),
    replace: (_m, g0) => `Direct link: ${g0}`,
  },
  {
    pattern: new RegExp("^实际编码探测: (.+)$"),
    replace: (_m, g0) => `Actual codec probe: ${g0}`,
  },
  {
    pattern: new RegExp("^（档位=(.+)，期望与实测编码一致，无降级）$"),
    replace: (_m, g0) => `(Tier=${g0}, expected and actual codecs match, no downgrade)`,
  },
  {
    pattern: new RegExp("^探测出错：(.+)$"),
    replace: (_m, g0) => `Probe error: ${g0}`,
  },
  {
    pattern: new RegExp("^更多工具（固定）：已收纳 (.+) 个控件$"),
    replace: (_m, g0) => `More tools (fixed): ${g0} controls stowed`,
  },
  {
    pattern: new RegExp("^添加局域网共享失败: (.+)$"),
    replace: (_m, g0) => `Failed to add LAN share: ${g0}`,
  },
  {
    pattern: new RegExp("^共 (.+) 个插件，已启用 (.+) 个$"),
    replace: (_m, g0, g1) => `${g0} plugins total, ${g1} enabled`,
  },
  {
    pattern: new RegExp("^，(.+) 个失败$"),
    replace: (_m, g0) => `, ${g0} failed`,
  },
  {
    pattern: new RegExp("^所有插件导入失败 \\((.+) 个\\)$"),
    replace: (_m, g0) => `All plugin imports failed (${g0})`,
  },
  {
    pattern: new RegExp("^已存在同名插件 v(.+)，新版本 v(.+) 未高于已安装版本，已跳过$"),
    replace: (_m, g0, g1) => `A plugin with the same name v${g0} already exists; the new v${g1} is not newer, skipped`,
  },
  {
    pattern: new RegExp("^成功安装插件: (.+) \\((.+)\\)$"),
    replace: (_m, g0, g1) => `Plugin installed: ${g0} (${g1})`,
  },
  {
    pattern: new RegExp("^已卸载 (.+)$"),
    replace: (_m, g0) => `Uninstalled ${g0}`,
  },
  {
    pattern: new RegExp("^(.+) 已更新到 v(.+)$"),
    replace: (_m, g0, g1) => `${g0} updated to v${g1}`,
  },
  {
    pattern: new RegExp("^(.+) 无可用更新源$"),
    replace: (_m, g0) => `${g0} has no update source`,
  },
  {
    pattern: new RegExp("^(.+) 发现新版本 v(.+)，再次点击更新$"),
    replace: (_m, g0, g1) => `${g0} found a new version v${g1}, click again to update`,
  },
  {
    pattern: new RegExp("^(.+) 已是最新版本$"),
    replace: (_m, g0) => `${g0} is up to date`,
  },
  {
    pattern: new RegExp("^检查更新失败: (.+)$"),
    replace: (_m, g0) => `Failed to check for updates: ${g0}`,
  },
  {
    pattern: new RegExp("^批量检查失败: (.+)$"),
    replace: (_m, g0) => `Batch check failed: ${g0}`,
  },
  {
    pattern: new RegExp("^已添加订阅: (.+)$"),
    replace: (_m, g0) => `Subscription added: ${g0}`,
  },
  {
    pattern: new RegExp("^(.+) 分钟前$"),
    replace: (_m, g0) => `${g0} minutes ago`,
  },
  {
    pattern: new RegExp("^(.+) 小时前$"),
    replace: (_m, g0) => `${g0} hours ago`,
  },
  {
    pattern: new RegExp("^已移除订阅 (.+)$"),
    replace: (_m, g0) => `Subscription removed: ${g0}`,
  },
  {
    pattern: new RegExp("^点击编辑「(.+)」名称$"),
    replace: (_m, g0) => `Click to edit the name of "${g0}"`,
  },
  {
    pattern: new RegExp("^(.+) 可更新到 v(.+)，点击执行更新$"),
    replace: (_m, g0, g1) => `${g0} can update to v${g1}, click to update`,
  },
  {
    pattern: new RegExp("^检查 (.+) 的更新$"),
    replace: (_m, g0) => `Check for updates to ${g0}`,
  },
  {
    pattern: new RegExp("^加载歌曲失败: (.+)$"),
    replace: (_m, g0) => `Failed to load songs: ${g0}`,
  },
  {
    pattern: new RegExp("^选择路径失败: (.+)$"),
    replace: (_m, g0) => `Failed to choose path: ${g0}`,
  },
  {
    pattern: new RegExp("^选择文件夹失败: (.+)$"),
    replace: (_m, g0) => `Failed to choose folder: ${g0}`,
  },
  {
    pattern: new RegExp("^成功处理 (.+) 个文件名$"),
    replace: (_m, g0) => `Processed ${g0} file names`,
  },
  {
    pattern: new RegExp("^应用预处理并继续 \\((.+)\\)$"),
    replace: (_m, g0) => `Apply preprocessing and continue (${g0})`,
  },
  {
    pattern: new RegExp("^启动失败: (.+)$"),
    replace: (_m, g0) => `Failed to start: ${g0}`,
  },
  {
    pattern: new RegExp("^成功重命名 (.+) 个文件$"),
    replace: (_m, g0) => `Renamed ${g0} files`,
  },
  {
    pattern: new RegExp("^应用重命名 \\((.+)\\)$"),
    replace: (_m, g0) => `Apply rename (${g0})`,
  },
  {
    pattern: new RegExp("^下载中 (.+)%$"),
    replace: (_m, g0) => `Downloading ${g0}%`,
  },
  {
    pattern: new RegExp("^已下载：(.+)$"),
    replace: (_m, g0) => `Downloaded: ${g0}`,
  },
  {
    pattern: new RegExp("^下载：(.+)$"),
    replace: (_m, g0) => `Download: ${g0}`,
  },
  {
    pattern: new RegExp("^(\\d+)小时(\\d+)分$"),
    replace: (_m, g0, g1) => `${g0}h ${g1}m`,
  },
  {
    pattern: new RegExp("^(\\d+)小时$"),
    replace: (_m, g0) => `${g0}h`,
  },
  {
    pattern: new RegExp("^(.+)小时\\$\\{m > 0 \\?$"),
    replace: (_m, g0) => `${g0}h`,
  },
  {
    pattern: new RegExp("^(.+)分钟$"),
    replace: (_m, g0) => `${g0} minutes`,
  },
  {
    pattern: new RegExp("^文件夹 (.+)/(.+)$"),
    replace: (_m, g0, g1) => `Folder ${g0}/${g1}`,
  },
  {
    pattern: new RegExp("^(.+)返回了无效数据$"),
    replace: (_m, g0) => `${g0} returned invalid data`,
  },
  {
    pattern: new RegExp("^Bilibili 视频信息解析失败：(.+)$"),
    replace: (_m, g0) => `Bilibili video info parsing failed: ${g0}`,
  },
  {
    pattern: new RegExp("^Bilibili 视频信息解析失败$"),
    replace: () => `Bilibili video info parsing failed`,
  },
  {
    pattern: new RegExp("^Bilibili 视频流解析失败：(.+)$"),
    replace: (_m, g0) => `Bilibili video stream parsing failed: ${g0}`,
  },
  {
    pattern: new RegExp("^Bilibili 视频流解析失败$"),
    replace: () => `Bilibili video stream parsing failed`,
  },
  {
    pattern: new RegExp("^(.+)失败\\$\\{payload\\.message \\?$"),
    replace: (_m, g0) => `${g0} failed`,
  },
  {
    pattern: new RegExp("^\\[MV自动对齐\\] (.+): 偏移 (.+)s（置信度 (.+)）$"),
    replace: (_m, g0, g1, g2) => `[MV auto-align] ${g0}: offset ${g1}s (confidence ${g2})`,
  },
  {
    pattern: new RegExp("^MV 加载失败：(.+)$"),
    replace: (_m, g0) => `MV load failed: ${g0}`,
  },
  {
    pattern: new RegExp("^开始下载：(.+)$"),
    replace: (_m, g0) => `Start download: ${g0}`,
  },
  {
    pattern: new RegExp("^（实际下载音质：(.+)）$"),
    replace: (_m, g0) => `(Actual download quality: ${g0})`,
  },
  {
    pattern: new RegExp("^下载完成(.+)(.+)$"),
    replace: (_m, g0, g1) => `Download complete${g0}${g1}`,
  },
  {
    pattern: new RegExp("^下载完成(.+)$"),
    replace: (_m, g0) => `Download complete${g0}`,
  },
  {
    pattern: new RegExp("^已删除 (.+) 首本地歌曲$"),
    replace: (_m, g0) => `Deleted ${g0} local songs`,
  },
  {
    pattern: new RegExp("^(.+) 首歌曲删除失败$"),
    replace: (_m, g0) => `Failed to delete ${g0} songs`,
  },
  {
    pattern: new RegExp("^确定要移除选中的 (.+) 首歌曲吗？$"),
    replace: (_m, g0) => `Remove the ${g0} selected songs?`,
  },
  {
    pattern: new RegExp("^确定要删除选中的 (.+) 首本地歌曲吗？此操作会删除磁盘上的真实文件，且不可恢复。$"),
    replace: (_m, g0) => `Delete the ${g0} selected local songs? This permanently deletes the actual files on disk and cannot be undone.`,
  },
  {
    pattern: new RegExp("^(.+) 首歌曲信息缺失，已跳过$"),
    replace: (_m, g0) => `Skipped ${g0} songs with missing info`,
  },
  {
    pattern: new RegExp("^移动失败: (.+)$"),
    replace: (_m, g0) => `Move failed: ${g0}`,
  },
  {
    pattern: new RegExp("^已创建文件夹: (.+)$"),
    replace: (_m, g0) => `Folder created: ${g0}`,
  },
  {
    pattern: new RegExp("^新建文件夹失败: (.+)$"),
    replace: (_m, g0) => `Failed to create folder: ${g0}`,
  },
  {
    pattern: new RegExp("^删除文件夹失败: (.+)$"),
    replace: (_m, g0) => `Failed to delete folder: ${g0}`,
  },
  {
    pattern: new RegExp("^确定要移除“(.+)”吗？这不会删除本地文件。$"),
    replace: (_m, g0) => `Remove "${g0}"? This will not delete local files.`,
  },
  {
    pattern: new RegExp("^已添加 (.+) 首歌曲到我喜欢$"),
    replace: (_m, g0) => `Added ${g0} songs to Favorites`,
  },
  {
    pattern: new RegExp("^全局快捷键注册失败：(.+)$"),
    replace: (_m, g0) => `Failed to register global shortcut: ${g0}`,
  },
  {
    pattern: new RegExp("^uploadPlaylists: 共 (.+) 个本地歌单待上传$"),
    replace: (_m, g0) => `uploadPlaylists: ${g0} local playlists to upload`,
  },
  {
    pattern: new RegExp("^uploadPlaylists: 收集完成, 歌单=(.+), 总歌曲=(.+)$"),
    replace: (_m, g0, g1) => `uploadPlaylists: collected, playlists=${g0}, songs=${g1}`,
  },
  {
    pattern: new RegExp("^uploadPlaylists 完成: uploadedPlaylists=(.+), uploadedSongs=(.+)$"),
    replace: (_m, g0, g1) => `uploadPlaylists done: uploadedPlaylists=${g0}, uploadedSongs=${g1}`,
  },
  {
    pattern: new RegExp("^uploadPlaylists 异常: (.+)$"),
    replace: (_m, g0) => `uploadPlaylists error: ${g0}`,
  },
  {
    pattern: new RegExp("^downloadPlaylists: 云端共 (.+) 个歌单, (.+) 首歌曲$"),
    replace: (_m, g0, g1) => `downloadPlaylists: ${g0} playlists, ${g1} songs in the cloud`,
  },
  {
    pattern: new RegExp("^正在下载歌单 \\((.+)/(.+)\\)：(.+)$"),
    replace: (_m, g0, g1, g2) => `Downloading playlist (${g0}/${g1}): ${g2}`,
  },
  {
    pattern: new RegExp("^downloadPlaylists 完成: downloadedPlaylists=(.+), downloadedSongs=(.+)$"),
    replace: (_m, g0, g1) => `downloadPlaylists done: downloadedPlaylists=${g0}, downloadedSongs=${g1}`,
  },
  {
    pattern: new RegExp("^downloadPlaylists 异常: (.+)$"),
    replace: (_m, g0) => `downloadPlaylists error: ${g0}`,
  },
  {
    pattern: new RegExp("^syncPlaylists 完成: uploaded=(.+)歌单/(.+)歌, downloaded=(.+)歌单/(.+)歌, errors=(.+)$"),
    replace: (_m, g0, g1, g2, g3, g4) => `syncPlaylists done: uploaded=${g0} playlists/${g1} songs, downloaded=${g2} playlists/${g3} songs, errors=${g4}`,
  },
  {
    pattern: new RegExp("^歌单同步完成（(.+) 个错误）$"),
    replace: (_m, g0) => `Playlist sync complete (${g0} errors)`,
  },
  {
    pattern: new RegExp("^上传 (.+) 个歌单$"),
    replace: (_m, g0) => `Uploaded ${g0} playlists`,
  },
  {
    pattern: new RegExp("^下载 (.+) 个歌单$"),
    replace: (_m, g0) => `Downloaded ${g0} playlists`,
  },
  {
    pattern: new RegExp("^syncPlaylists 异常: (.+)$"),
    replace: (_m, g0) => `syncPlaylists error: ${g0}`,
  },
  {
    pattern: new RegExp("^歌单同步失败：(.+)$"),
    replace: (_m, g0) => `Playlist sync failed: ${g0}`,
  },
  {
    pattern: new RegExp("^syncPlugins 完成: uploaded=(.+), downloaded=(.+), errors=(.+)$"),
    replace: (_m, g0, g1, g2) => `syncPlugins done: uploaded=${g0}, downloaded=${g1}, errors=${g2}`,
  },
  {
    pattern: new RegExp("^插件同步完成（(.+) 个错误）$"),
    replace: (_m, g0) => `Plugin sync complete (${g0} errors)`,
  },
  {
    pattern: new RegExp("^上传 (.+) 个插件$"),
    replace: (_m, g0) => `Uploaded ${g0} plugins`,
  },
  {
    pattern: new RegExp("^恢复 (.+) 个插件$"),
    replace: (_m, g0) => `Restored ${g0} plugins`,
  },
  {
    pattern: new RegExp("^syncPlugins 异常: (.+)$"),
    replace: (_m, g0) => `syncPlugins error: ${g0}`,
  },
  {
    pattern: new RegExp("^插件同步失败：(.+)$"),
    replace: (_m, g0) => `Plugin sync failed: ${g0}`,
  },
  {
    pattern: new RegExp("^uploadOnly 完成: uploadedPlaylists=(.+), uploadedSongs=(.+), errors=(.+)$"),
    replace: (_m, g0, g1, g2) => `uploadOnly done: uploadedPlaylists=${g0}, uploadedSongs=${g1}, errors=${g2}`,
  },
  {
    pattern: new RegExp("^上传完成（(.+) 个错误）$"),
    replace: (_m, g0) => `Upload complete (${g0} errors)`,
  },
  {
    pattern: new RegExp("^已上传 (.+) 个歌单（(.+) 首歌曲）$"),
    replace: (_m, g0, g1) => `Uploaded ${g0} playlists (${g1} songs)`,
  },
  {
    pattern: new RegExp("^uploadOnly 异常: (.+)$"),
    replace: (_m, g0) => `uploadOnly error: ${g0}`,
  },
  {
    pattern: new RegExp("^上传失败：(.+)$"),
    replace: (_m, g0) => `Upload failed: ${g0}`,
  },
  {
    pattern: new RegExp("^downloadOnly 完成: downloadedPlaylists=(.+), downloadedSongs=(.+), errors=(.+)$"),
    replace: (_m, g0, g1, g2) => `downloadOnly done: downloadedPlaylists=${g0}, downloadedSongs=${g1}, errors=${g2}`,
  },
  {
    pattern: new RegExp("^下载完成（(.+) 个错误）$"),
    replace: (_m, g0) => `Download complete (${g0} errors)`,
  },
  {
    pattern: new RegExp("^已下载 (.+) 个歌单（(.+) 首歌曲）$"),
    replace: (_m, g0, g1) => `Downloaded ${g0} playlists (${g1} songs)`,
  },
  {
    pattern: new RegExp("^downloadOnly 异常: (.+)$"),
    replace: (_m, g0) => `downloadOnly error: ${g0}`,
  },
  {
    pattern: new RegExp("^删除云端歌单失败：(.+)$"),
    replace: (_m, g0) => `Failed to delete cloud playlist: ${g0}`,
  },
  {
    pattern: new RegExp("^uploadSettingsOnly 完成: uploaded=(.+), errors=(.+)$"),
    replace: (_m, g0, g1) => `uploadSettingsOnly done: uploaded=${g0}, errors=${g1}`,
  },
  {
    pattern: new RegExp("^设置上传完成（(.+) 个错误）$"),
    replace: (_m, g0) => `Settings upload complete (${g0} errors)`,
  },
  {
    pattern: new RegExp("^uploadSettingsOnly 异常: (.+)$"),
    replace: (_m, g0) => `uploadSettingsOnly error: ${g0}`,
  },
  {
    pattern: new RegExp("^设置上传失败：(.+)$"),
    replace: (_m, g0) => `Settings upload failed: ${g0}`,
  },
  {
    pattern: new RegExp("^downloadSettingsOnly 完成: downloaded=(.+), errors=(.+)$"),
    replace: (_m, g0, g1) => `downloadSettingsOnly done: downloaded=${g0}, errors=${g1}`,
  },
  {
    pattern: new RegExp("^设置下载完成（(.+) 个错误）$"),
    replace: (_m, g0) => `Settings download complete (${g0} errors)`,
  },
  {
    pattern: new RegExp("^downloadSettingsOnly 异常: (.+)$"),
    replace: (_m, g0) => `downloadSettingsOnly error: ${g0}`,
  },
  {
    pattern: new RegExp("^设置下载失败：(.+)$"),
    replace: (_m, g0) => `Settings download failed: ${g0}`,
  },
  {
    pattern: new RegExp("^uploadFavoritesOnly 完成: uploaded=(.+)$"),
    replace: (_m, g0) => `uploadFavoritesOnly done: uploaded=${g0}`,
  },
  {
    pattern: new RegExp("^已上传 (.+) 首收藏歌曲$"),
    replace: (_m, g0) => `Uploaded ${g0} favorite songs`,
  },
  {
    pattern: new RegExp("^uploadFavoritesOnly 异常: (.+)$"),
    replace: (_m, g0) => `uploadFavoritesOnly error: ${g0}`,
  },
  {
    pattern: new RegExp("^收藏上传失败：(.+)$"),
    replace: (_m, g0) => `Favorites upload failed: ${g0}`,
  },
  {
    pattern: new RegExp("^downloadFavoritesOnly 完成: downloaded=(.+)$"),
    replace: (_m, g0) => `downloadFavoritesOnly done: downloaded=${g0}`,
  },
  {
    pattern: new RegExp("^已下载 (.+) 首收藏歌曲$"),
    replace: (_m, g0) => `Downloaded ${g0} favorite songs`,
  },
  {
    pattern: new RegExp("^downloadFavoritesOnly 异常: (.+)$"),
    replace: (_m, g0) => `downloadFavoritesOnly error: ${g0}`,
  },
  {
    pattern: new RegExp("^收藏下载失败：(.+)$"),
    replace: (_m, g0) => `Favorites download failed: ${g0}`,
  },
  {
    pattern: new RegExp("^设置同步完成（(.+) 个错误）$"),
    replace: (_m, g0) => `Settings sync complete (${g0} errors)`,
  },
  {
    pattern: new RegExp("^同步完成（(.+) 个错误）$"),
    replace: (_m, g0) => `Sync complete (${g0} errors)`,
  },
  {
    pattern: new RegExp("^syncSettings 异常: (.+)$"),
    replace: (_m, g0) => `syncSettings error: ${g0}`,
  },
  {
    pattern: new RegExp("^设置同步失败：(.+)$"),
    replace: (_m, g0) => `Settings sync failed: ${g0}`,
  },
  {
    pattern: new RegExp("^uploadPluginsOnly 完成: uploadedPlugins=(.+), errors=(.+)$"),
    replace: (_m, g0, g1) => `uploadPluginsOnly done: uploadedPlugins=${g0}, errors=${g1}`,
  },
  {
    pattern: new RegExp("^插件上传完成（(.+) 个错误）$"),
    replace: (_m, g0) => `Plugin upload complete (${g0} errors)`,
  },
  {
    pattern: new RegExp("^已上传 (.+) 个插件$"),
    replace: (_m, g0) => `Uploaded ${g0} plugins`,
  },
  {
    pattern: new RegExp("^uploadPluginsOnly 异常: (.+)$"),
    replace: (_m, g0) => `uploadPluginsOnly error: ${g0}`,
  },
  {
    pattern: new RegExp("^插件上传失败：(.+)$"),
    replace: (_m, g0) => `Plugin upload failed: ${g0}`,
  },
  {
    pattern: new RegExp("^downloadPluginsOnly 完成: downloadedPlugins=(.+), errors=(.+)$"),
    replace: (_m, g0, g1) => `downloadPluginsOnly done: downloadedPlugins=${g0}, errors=${g1}`,
  },
  {
    pattern: new RegExp("^插件下载完成（(.+) 个错误）$"),
    replace: (_m, g0) => `Plugin download complete (${g0} errors)`,
  },
  {
    pattern: new RegExp("^已恢复 (.+) 个插件$"),
    replace: (_m, g0) => `Restored ${g0} plugins`,
  },
  {
    pattern: new RegExp("^downloadPluginsOnly 异常: (.+)$"),
    replace: (_m, g0) => `downloadPluginsOnly error: ${g0}`,
  },
  {
    pattern: new RegExp("^插件下载失败：(.+)$"),
    replace: (_m, g0) => `Plugin download failed: ${g0}`,
  },
  {
    pattern: new RegExp("^服务器繁忙，自动延后 (.+) 分钟（第 (.+) 次）$"),
    replace: (_m, g0, g1) => `Server busy, auto-delayed ${g0} minutes (attempt ${g1})`,
  },
  {
    pattern: new RegExp("^服务器当前同步用户过多，已自动延后 (.+) 分钟$"),
    replace: (_m, g0) => `Too many users syncing right now, auto-delayed ${g0} minutes`,
  },
  {
    pattern: new RegExp("^(.+)：“(.+)”的搜索结果$"),
    replace: (_m, g0, g1) => `${g0}: search results for "${g1}"`,
  },
  {
    pattern: new RegExp("^：“(.+)”的搜索结果$"),
    replace: (_m, g0) => `: search results for "${g0}"`,
  },
  {
    pattern: new RegExp("^确定要删除 (.+) 个播放列表吗？$"),
    replace: (_m, g0) => `Delete ${g0} playlists?`,
  },
  {
    pattern: new RegExp("^已添加 (.+) 首歌曲到 (.+)$"),
    replace: (_m, g0, g1) => `Added ${g0} songs to ${g1}`,
  },
  {
    pattern: new RegExp("^已添加 (.+) 个文件夹到本地目录视图$"),
    replace: (_m, g0) => `Added ${g0} folders to the local directory view`,
  },
  {
    pattern: new RegExp("^添加目录结构失败: (.+)$"),
    replace: (_m, g0) => `Failed to add directory structure: ${g0}`,
  },
  {
    pattern: new RegExp("^添加失败: (.+)$"),
    replace: (_m, g0) => `Add failed: ${g0}`,
  },
  {
    pattern: new RegExp("^已导入 (.+) 个文件夹，并开始播放 (.+)$"),
    replace: (_m, g0, g1) => `Imported ${g0} folders and started playing ${g1}`,
  },
  {
    pattern: new RegExp("^已导入 (.+) 个文件夹$"),
    replace: (_m, g0) => `Imported ${g0} folders`,
  },
  {
    pattern: new RegExp("^已载入 (.+) 首歌曲并开始播放$"),
    replace: (_m, g0) => `Loaded ${g0} songs and started playing`,
  },
  {
    pattern: new RegExp("^正在播放 (.+)$"),
    replace: (_m, g0) => `Now playing ${g0}`,
  },
  {
    pattern: new RegExp("^(.+) 个文件夹已在音乐库中，未重复导入$"),
    replace: (_m, g0) => `${g0} folders already in the library, not re-imported`,
  },
  {
    pattern: new RegExp("^添加音乐文件夹失败: (.+)$"),
    replace: (_m, g0) => `Failed to add music folder: ${g0}`,
  },
  {
    pattern: new RegExp("^整理失败: (.+)$"),
    replace: (_m, g0) => `Organize failed: ${g0}`,
  },
  {
    pattern: new RegExp("^删除失败: (.+)$"),
    replace: (_m, g0) => `Delete failed: ${g0}`,
  },
  {
    pattern: new RegExp("^已恢复 (.+) 个文件夹$"),
    replace: (_m, g0) => `Restored ${g0} folders`,
  },
  {
    pattern: new RegExp("^「(.+)」为 VIP 试听片段（(.+) 秒，(.+) 起），完整播放请配置插件登录或更换音源$"),
    replace: (_m, g0, g1, g2) => `"${g0}" is a VIP preview clip (${g1} seconds, from ${g2}). For full playback, configure plugin sign-in or switch sources`,
  },
  {
    pattern: new RegExp("^当前音源仅为试听片段（约 (.+) 秒），完整播放请更换音源或配置插件登录$"),
    replace: (_m, g0) => `This source only offers a preview clip (~${g0} seconds). For full playback, switch sources or configure plugin sign-in`,
  },
  {
    pattern: new RegExp("^\\[Audio\\] 自动换源查找异常: (.+)$"),
    replace: (_m, g0) => `[Audio] Auto source-switch lookup error: ${g0}`,
  },
  {
    pattern: new RegExp("^已自动切换到 (.+) 音源$"),
    replace: (_m, g0) => `Automatically switched to the ${g0} source`,
  },
  {
    pattern: new RegExp("^(.+)，已跳过$"),
    replace: (_m, g0) => `${g0}, skipped`,
  },
  {
    pattern: new RegExp("^\\[B站m4s\\] host=(.+) Cookie=(.+) Referer=(.+) Origin=(.+)$"),
    replace: (_m, g0, g1, g2, g3) => `[Bilibili m4s] host=${g0} Cookie=${g1} Referer=${g2} Origin=${g3}`,
  },
  {
    pattern: new RegExp("^\\[B站m4s\\] host=(.+) Cookie=\\$\\{cookieNames\\.length \\?$"),
    replace: (_m, g0) => `[Bilibili m4s] host=${g0} Cookie=...`,
  },
  {
    pattern: new RegExp("^底部栏 播放栏 控件 (.+)$"),
    replace: (_m, g0) => `Bottom bar Player bar Control ${g0}`,
  },
  {
    pattern: new RegExp("^(.+) 设置 分类$"),
    replace: (_m, g0) => `${g0} Settings Category`,
  },
  {
    pattern: new RegExp("^(.+) (.+) 分组$"),
    replace: (_m, g0, g1) => `${g0} ${g1} Group`,
  },
  {
    pattern: new RegExp("^前端运行错误: (.+)$"),
    replace: (_m, g0) => `Frontend runtime error: ${g0}`,
  },
  {
    pattern: new RegExp("^设置导入失败: (.+)$"),
    replace: (_m, g0) => `Settings import failed: ${g0}`,
  },
  {
    pattern: new RegExp("^检测到 (.+) 条错误日志$"),
    replace: (_m, g0) => `Detected ${g0} error logs`,
  },
  {
    pattern: new RegExp("^检测到 (.+) 条警告日志$"),
    replace: (_m, g0) => `Detected ${g0} warning logs`,
  },
  {
    pattern: new RegExp("^错误最集中的功能：(.+)$"),
    replace: (_m, g0) => `Feature with the most errors: ${g0}`,
  },
  {
    pattern: new RegExp("^日志数量已达到本地上限（(.+) 条），较早记录可能已被自动清理。$"),
    replace: (_m, g0) => `Log count has reached the local limit (${g0} entries); older records may have been auto-cleaned.`,
  },
  {
    pattern: new RegExp("^导出时间：(.+)$"),
    replace: (_m, g0) => `Export time: ${g0}`,
  },
  {
    pattern: new RegExp("^日志数量：(.+)$"),
    replace: (_m, g0) => `Log count: ${g0}`,
  },
  {
    pattern: new RegExp("^自动分析：(.+)$"),
    replace: (_m, g0) => `Auto analysis: ${g0}`,
  },
  {
    pattern: new RegExp("^分析提示：(.+)$"),
    replace: (_m, g0) => `Analysis hint: ${g0}`,
  },
  {
    pattern: new RegExp("^请求失败（code (.+)）$"),
    replace: (_m, g0) => `Request failed (code ${g0})`,
  },
  {
    pattern: new RegExp("^请求超时（(.+)s），action=(.+)$"),
    replace: (_m, g0, g1) => `Request timed out (${g0}s), action=${g1}`,
  },
  {
    pattern: new RegExp("^请求超时（(.+)s）$"),
    replace: (_m, g0) => `Request timed out (${g0}s)`,
  },
  {
    pattern: new RegExp("^请求失败（code (.+)）$"),
    replace: (_m, g0) => `Request failed (code ${g0})`,
  },
  {
    pattern: new RegExp("^请求超时（(.+)s），action=upload_avatar$"),
    replace: (_m, g0) => `Request timed out (${g0}s), action=upload_avatar`,
  },
  {
    pattern: new RegExp("^start: 调度器已启动，同步间隔 (.+)，下次同步时间: (.+)$"),
    replace: (_m, g0, g1) => `start: scheduler started, interval ${g0}, next sync: ${g1}`,
  },
  {
    pattern: new RegExp("^attemptSync: 延迟次数 (.+) 已达上限 (.+) 分钟，放弃本次同步$"),
    replace: (_m, g0, g1) => `attemptSync: delay count ${g0} reached the ${g1}-minute cap, giving up this sync`,
  },
  {
    pattern: new RegExp("^attemptSync: 已安排下次同步时间: (.+)$"),
    replace: (_m, g0) => `attemptSync: next sync scheduled: ${g0}`,
  },
  {
    pattern: new RegExp("^attemptSync: 服务器繁忙 \\(并发: (.+), 带宽: (.+)%\\)，延后 (.+)s \\(第 (.+) 次\\)$"),
    replace: (_m, g0, g1, g2, g3) => `attemptSync: server busy (concurrent: ${g0}, bandwidth: ${g1}%), delayed ${g2}s (attempt ${g3})`,
  },
  {
    pattern: new RegExp("^attemptSync: 同步成功，下次同步时间: (.+)$"),
    replace: (_m, g0) => `attemptSync: sync succeeded, next sync: ${g0}`,
  },
  {
    pattern: new RegExp("^attemptSync: 同步失败，下次同步时间: (.+)$"),
    replace: (_m, g0) => `attemptSync: sync failed, next sync: ${g0}`,
  },
  {
    pattern: new RegExp("^未知专辑-(.+)$"),
    replace: (_m, g0) => `Unknown album - ${g0}`,
  },
  {
    pattern: new RegExp("^源站代理接口返回错误：(.+)$"),
    replace: (_m, g0) => `Origin proxy API returned an error: ${g0}`,
  },
  {
    pattern: new RegExp("^跳转到非音频内容 \\((.+)\\)$"),
    replace: (_m, g0) => `Redirected to non-audio content (${g0})`,
  },
  {
    pattern: new RegExp("^\\[getMediaSource\\] 短时缓存中的酷狗代理URL已失效，删除缓存并重新解析: (.+)$"),
    replace: (_m, g0) => `[getMediaSource] Cached KuGou proxy URL expired, clearing cache and re-resolving: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[getMediaSource\\] 短时缓存中的网易云外链不可用，删除缓存并重新解析: (.+)$"),
    replace: (_m, g0) => `[getMediaSource] Cached NetEase outer link unavailable, clearing cache and re-resolving: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[getMediaSource\\] 复用进行中的直链解析: (.+), id=(.+), quality=(.+)$"),
    replace: (_m, g0, _g1, _g2) => `[getMediaSource] Reusing in-flight direct-link resolution: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[getMediaSource\\] 调用 (.+), id=(.+), platform=(.+), tryQualities=(.+)$"),
    replace: (_m, g0, g1, g2, g3) => `[getMediaSource] Calling ${g0}, id=${g1}, platform=${g2}, tryQualities=${g3}`,
  },
  {
    pattern: new RegExp("^\\[getMediaSource\\] quality=(.+) 返回 QQ 试听链\\(RS02\\)，拒绝并继续: (.+)$"),
    replace: (_m, g0, g1) => `[getMediaSource] quality=${g0} returned a QQ preview link (RS02), rejecting and continuing: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[getMediaSource\\] quality=(.+) 网易云外链不可用，拒绝并继续: (.+)$"),
    replace: (_m, g0, g1) => `[getMediaSource] quality=${g0} NetEase outer link unavailable, rejecting and continuing: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[getMediaSource\\] quality=(.+) 返回的代理URL不可播放，继续下一档: (.+)$"),
    replace: (_m, g0, g1) => `[getMediaSource] quality=${g0} returned an unplayable proxy URL, continuing to next tier: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[getMediaSource\\] quality=(.+) 已尝试过，跳过重复调用$"),
    replace: (_m, g0) => `[getMediaSource] quality=${g0} already tried, skipping duplicate call`,
  },
  {
    pattern: new RegExp("^\\[getMediaSource\\] 沙箱日志检测到致命错误，跳过剩余音质: (.+)$"),
    replace: (_m, g0) => `[getMediaSource] Sandbox log shows a fatal error, skipping remaining qualities: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[getMediaSource\\] legacy quality=(.+) 已尝试过，跳过重复回退$"),
    replace: (_m, g0) => `[getMediaSource] legacy quality=${g0} already tried, skipping duplicate fallback`,
  },
  {
    pattern: new RegExp("^\\[getMediaSource\\] quality=(.+) 无结果，回退到旧键: (.+)$"),
    replace: (_m, g0, g1) => `[getMediaSource] quality=${g0} returned nothing, falling back to legacy key: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[getMediaSource\\] 沙箱日志检测到致命错误\\(legacy\\)，跳过剩余音质: (.+)$"),
    replace: (_m, g0) => `[getMediaSource] Sandbox log shows a fatal error (legacy), skipping remaining qualities: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[getMediaSource\\] quality=(.+) 异常: (.+)$"),
    replace: (_m, g0, g1) => `[getMediaSource] quality=${g0} error: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[getMediaSource\\] 歌曲级/致命错误，跳过剩余音质: (.+)$"),
    replace: (_m, g0) => `[getMediaSource] Song-level/fatal error, skipping remaining qualities: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[getMediaSource\\] 插件提示仅支持 (.+)，跳过中间音质直接尝试$"),
    replace: (_m, g0) => `[getMediaSource] Plugin reports only ${g0} supported, skipping intermediate qualities`,
  },
  {
    pattern: new RegExp("^\\[getMediaSource\\] 插件声明当前仅支持 (.+) 但仍失败，停止重复重试$"),
    replace: (_m, g0) => `[getMediaSource] Plugin claims only ${g0} supported but still failed, stopping retries`,
  },
  {
    pattern: new RegExp("^异常: (.+)$"),
    replace: (_m, g0) => `Error: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[getLyric\\] rawLrc 预览: (.+)$"),
    replace: (_m, g0) => `[getLyric] rawLrc preview: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[getLyric\\] ttml 预览: (.+)$"),
    replace: (_m, g0) => `[getLyric] ttml preview: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[getLyric\\] lxlyric 预览: (.+)$"),
    replace: (_m, g0) => `[getLyric] lxlyric preview: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[getLyric\\] yrc 预览: (.+)$"),
    replace: (_m, g0) => `[getLyric] yrc preview: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[getLyric\\] qrc 预览: (.+)$"),
    replace: (_m, g0) => `[getLyric] qrc preview: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[getLyric\\] eslrc 预览: (.+)$"),
    replace: (_m, g0) => `[getLyric] eslrc preview: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[getLyric\\] (.+) 成功, rawLrc长度=(.+), ttml长度=(.+), lxlyric长度=(.+), yrc长度=(.+), qrc长度=(.+), format=(.+)$"),
    replace: (_m, g0, g1, g2, g3, g4, g5, g6) => `[getLyric] ${g0} succeeded, rawLrc=${g1}, ttml=${g2}, lxlyric=${g3}, yrc=${g4}, qrc=${g5}, format=${g6}`,
  },
  {
    pattern: new RegExp("^\\[getMusicComments\\] (.+) 插件未实现 getMusicComments 方法$"),
    replace: (_m, g0) => `[getMusicComments] ${g0} plugin does not implement getMusicComments`,
  },
  {
    pattern: new RegExp("^\\[getMusicComments\\] (.+) 调用异常: (.+)$"),
    replace: (_m, g0, g1) => `[getMusicComments] ${g0} call error: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[getMusicComments\\] (.+) 成功, 获取 (.+) 条评论, isEnd=(.+)$"),
    replace: (_m, g0, g1, g2) => `[getMusicComments] ${g0} succeeded, got ${g1} comments, isEnd=${g2}`,
  },
  {
    pattern: new RegExp("^获取评论失败: (.+) (.+)$"),
    replace: (_m, g0, _g1) => `Failed to fetch comments: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[searchMusic\\] (.+) 失败: (.+)$"),
    replace: (_m, g0, g1) => `[searchMusic] ${g0} failed: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[searchArtists\\] (.+) 失败: (.+)$"),
    replace: (_m, g0, g1) => `[searchArtists] ${g0} failed: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[searchAlbums\\] (.+) 失败: (.+)$"),
    replace: (_m, g0, g1) => `[searchAlbums] ${g0} failed: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[searchPlaylists\\] (.+) 失败: (.+)$"),
    replace: (_m, g0, g1) => `[searchPlaylists] ${g0} failed: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[getAlbumInfo\\] (.+) 多次尝试仍空/异常: (.+)$"),
    replace: (_m, g0, g1) => `[getAlbumInfo] ${g0} still empty/error after multiple tries: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[getAlbumSongs\\] (.+) 失败: (.+)$"),
    replace: (_m, g0, g1) => `[getAlbumSongs] ${g0} failed: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[getPlaylistDetail\\] (.+) getMusicSheetInfo 多次尝试仍空/异常: (.+)$"),
    replace: (_m, g0, g1) => `[getPlaylistDetail] ${g0} getMusicSheetInfo still empty/error after multiple tries: ${g1}`,
  },
  {
    pattern: new RegExp("^(.+) 按专辑$"),
    replace: (_m, g0) => `${g0} by album`,
  },
  {
    pattern: new RegExp("^\\[BilibiliDetail\\] (.+) getAlbumInfo 失败: (.+)$"),
    replace: (_m, g0, g1) => `[BilibiliDetail] ${g0} getAlbumInfo failed: ${g1}`,
  },
  {
    pattern: new RegExp("^(.+) 按歌单$"),
    replace: (_m, g0) => `${g0} by playlist`,
  },
  {
    pattern: new RegExp("^\\[BilibiliDetail\\] (.+) getMusicSheetInfo 失败: (.+)$"),
    replace: (_m, g0, g1) => `[BilibiliDetail] ${g0} getMusicSheetInfo failed: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[(.+)\\] BilibiliArtistWorks\\((.+)\\) 空间列表为空\\(疑似风控\\)$"),
    replace: (_m, g0, g1) => `[${g0}] BilibiliArtistWorks(${g1}) space list is empty (possible risk control)`,
  },
  {
    pattern: new RegExp("^\\[BilibiliArtistWorks\\] (.+) 失败: (.+)$"),
    replace: (_m, g0, g1) => `[BilibiliArtistWorks] ${g0} failed: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[getArtistWorks\\] (.+) 多次尝试仍空/异常: (.+)$"),
    replace: (_m, g0, g1) => `[getArtistWorks] ${g0} still empty/error after multiple tries: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[getArtistWorks\\] (.+) 失败: (.+)$"),
    replace: (_m, g0, g1) => `[getArtistWorks] ${g0} failed: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[getTopLists\\] (.+) 失败: (.+)$"),
    replace: (_m, g0, g1) => `[getTopLists] ${g0} failed: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[getTopListDetail\\] (.+) 失败: (.+)$"),
    replace: (_m, g0, g1) => `[getTopListDetail] ${g0} failed: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[getRecommendSheetsByTag\\] (.+) 失败: (.+)$"),
    replace: (_m, g0, g1) => `[getRecommendSheetsByTag] ${g0} failed: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[importMusicSheet\\] (.+) 失败: (.+)$"),
    replace: (_m, g0, g1) => `[importMusicSheet] ${g0} failed: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[importMusicItem\\] (.+) 失败: (.+)$"),
    replace: (_m, g0, g1) => `[importMusicItem] ${g0} failed: ${g1}`,
  },
  {
    pattern: new RegExp("^插件实例未缓存，需要重新加载: (.+) \\((.+)\\)$"),
    replace: (_m, g0, g1) => `Plugin instance not cached, reloading: ${g0} (${g1})`,
  },
  {
    pattern: new RegExp("^(.+) 第(.+)次 → (.+)$"),
    replace: (_m, g0, g1, g2) => `${g0} attempt ${g1} → ${g2}`,
  },
  {
    pattern: new RegExp("^\\[Download\\] (.+) 请求被音源降级为 (.+)，跳过该档位$"),
    replace: (_m, g0, g1) => `[Download] ${g0} request downgraded to ${g1} by the source, skipping this tier`,
  },
  {
    pattern: new RegExp("^\\[Download\\]\\[plugin\\] 预解析 (.+)\\((.+)\\) 被降级为 (.+)，跳过该档位$"),
    replace: (_m, g0, g1, g2) => `[Download][plugin] Pre-resolution ${g0}(${g1}) downgraded to ${g2}, skipping this tier`,
  },
  {
    pattern: new RegExp("^\\[Download\\]\\[plugin\\] (.+) 请求被音源降级为 (.+)，跳过该档位$"),
    replace: (_m, g0, g1) => `[Download][plugin] ${g0} request downgraded to ${g1} by the source, skipping this tier`,
  },
  {
    pattern: new RegExp("^\\[Probe\\] (.+) 探测失败:$"),
    replace: (_m, g0) => `[Probe] ${g0} probe failed:`,
  },
  {
    pattern: new RegExp("^\\[Download\\] 缓存复用跳过：(.+) 目标为无损但播放缓存为 (.+)$"),
    replace: (_m, g0, g1) => `[Download] Cache reuse skipped: ${g0} targets lossless but playback cache is ${g1}`,
  },
  {
    pattern: new RegExp("^(.+): 返回空链接$"),
    replace: (_m, g0) => `${g0}: returned an empty link`,
  },
  {
    pattern: new RegExp("^(.+): 解析失败 (.+)$"),
    replace: (_m, g0, g1) => `${g0}: resolution failed ${g1}`,
  },
  {
    pattern: new RegExp("^\\[Download\\] 获取 (.+) 音源失败:$"),
    replace: (_m, g0) => `[Download] Failed to get ${g0} source:`,
  },
  {
    pattern: new RegExp("^(.+): 下载失败 (.+)$"),
    replace: (_m, g0, g1) => `${g0}: download failed ${g1}`,
  },
  {
    pattern: new RegExp("^\\[Download\\] (.+) 档位下载失败，尝试回退更低音质:$"),
    replace: (_m, g0) => `[Download] ${g0} tier download failed, trying lower quality:`,
  },
  {
    pattern: new RegExp("^Rust 兜底\\((.+)\\): 下载失败 (.+)$"),
    replace: (_m, g0, g1) => `Rust fallback (${g0}): download failed ${g1}`,
  },
  {
    pattern: new RegExp("^uploadFavorites 失败: (.+)$"),
    replace: (_m, g0) => `uploadFavorites failed: ${g0}`,
  },
  {
    pattern: new RegExp("^downloadFavorites 失败: (.+)$"),
    replace: (_m, g0) => `downloadFavorites failed: ${g0}`,
  },
  {
    pattern: new RegExp("^(.+) 上报听歌时长失败（不影响排行榜获取）: (.+)$"),
    replace: (_m, g0, g1) => `${g0} Failed to report listening duration (does not affect leaderboard): ${g1}`,
  },
  {
    pattern: new RegExp("^(.+) 重置本地统计数据失败: (.+)$"),
    replace: (_m, g0, g1) => `${g0} Failed to reset local statistics: ${g1}`,
  },
  {
    pattern: new RegExp("^(.+) 获取排行榜失败:$"),
    replace: (_m, g0) => `${g0} Failed to fetch leaderboard:`,
  },
  {
    pattern: new RegExp("^\\[lxLyricFetcher\\] 获取 (.+) 歌词失败:$"),
    replace: (_m, g0) => `[lxLyricFetcher] Failed to fetch lyrics from ${g0}:`,
  },
  {
    pattern: new RegExp("^\\[LxMusicSdk\\] TX 歌单搜索接口异常，尝试 Desktop 兜底: (.+)$"),
    replace: (_m, g0) => `[LxMusicSdk] TX playlist search API error, trying Desktop fallback: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[LxMusicSdk\\] TX playlist (.+): (.+)，尝试 Web 兜底$"),
    replace: (_m, g0, g1) => `[LxMusicSdk] TX playlist ${g0}: ${g1}, trying Web fallback`,
  },
  {
    pattern: new RegExp("^Mobile 接口异常\\((.+)\\)$"),
    replace: (_m, g0) => `Mobile API error (${g0})`,
  },
  {
    pattern: new RegExp("^\\[normalizeLxLyricResponse\\] 插件返回字段 keys=\\[(.+)\\] lyric=(.+) lxlyric=(.+) yrc=(.+) qrc=(.+) eslrc=(.+)$"),
    replace: (_m, g0, g1, g2, g3, g4, g5) => `[normalizeLxLyricResponse] Plugin returned keys=[${g0}] lyric=${g1} lxlyric=${g2} yrc=${g3} qrc=${g4} eslrc=${g5}`,
  },
  {
    pattern: new RegExp("^\\[normalizeLxLyricResponse\\] lxlyric 预览: (.+)$"),
    replace: (_m, g0) => `[normalizeLxLyricResponse] lxlyric preview: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[normalizeLxLyricResponse\\] yrc 预览: (.+)$"),
    replace: (_m, g0) => `[normalizeLxLyricResponse] yrc preview: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[normalizeLxLyricResponse\\] qrc 预览: (.+)$"),
    replace: (_m, g0) => `[normalizeLxLyricResponse] qrc preview: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[normalizeLxLyricResponse\\] eslrc 预览: (.+)$"),
    replace: (_m, g0) => `[normalizeLxLyricResponse] eslrc preview: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[normalizeLxLyricResponse\\] lyric 预览: (.+)$"),
    replace: (_m, g0) => `[normalizeLxLyricResponse] lyric preview: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[fetchLxPluginScript\\] 内置插件 fetch 失败: (.+) - (.+)$"),
    replace: (_m, g0, g1) => `[fetchLxPluginScript] Built-in plugin fetch failed: ${g0} - ${g1}`,
  },
  {
    pattern: new RegExp("^\\[fetchLxPluginScript\\] Tauri 代理获取远程脚本失败: (.+) - (.+)$"),
    replace: (_m, g0, g1) => `[fetchLxPluginScript] Tauri proxy remote script fetch failed: ${g0} - ${g1}`,
  },
  {
    pattern: new RegExp("^\\[fetchLxPluginScript\\] 读取本地文件失败: (.+) - (.+)$"),
    replace: (_m, g0, g1) => `[fetchLxPluginScript] Local file read failed: ${g0} - ${g1}`,
  },
  {
    pattern: new RegExp("^插件大小超过 2MB: (.+) bytes$"),
    replace: (_m, g0) => `Plugin exceeds 2MB: ${g0} bytes`,
  },
  {
    pattern: new RegExp("^=== 开始加载落雪插件: (.+) ===$"),
    replace: (_m, g0) => `=== Loading LX plugin: ${g0} ===`,
  },
  {
    pattern: new RegExp("^\\[loadLxPluginFromScript\\] 复用已有就绪实例: (.+)$"),
    replace: (_m, g0) => `[loadLxPluginFromScript] Reusing ready instance: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[loadLxPluginFromScript\\] 销毁残留实例\\(非就绪\\): (.+)$"),
    replace: (_m, g0) => `[loadLxPluginFromScript] Destroying leftover instance (not ready): ${g0}`,
  },
  {
    pattern: new RegExp("^\\[loadLxPluginFromScript\\] 沙箱模式加载: (.+)$"),
    replace: (_m, g0) => `[loadLxPluginFromScript] Loading in sandbox mode: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[loadLxPluginFromScript\\] 沙箱加载失败，已阻止回退到主线程直接执行: (.+)$"),
    replace: (_m, g0) => `[loadLxPluginFromScript] Sandbox load failed, fallback to main-thread execution blocked: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[lxPluginRequest\\] (.+) musicUrl 返回对象，提取 url 字段: (.+)$"),
    replace: (_m, g0, g1) => `[lxPluginRequest] ${g0} musicUrl returned an object, extracting url field: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[lxPluginRequest\\] 沙箱 (.+) musicUrl 成功: (.+)\\.\\.\\.$"),
    replace: (_m, g0, g1) => `[lxPluginRequest] sandbox ${g0} musicUrl succeeded: ${g1}...`,
  },
  {
    pattern: new RegExp("^\\[lxPluginRequest\\] 沙箱 (.+) lyric 不支持，交给后备歌词接口处理$"),
    replace: (_m, g0) => `[lxPluginRequest] sandbox ${g0} lyric unsupported, handing to fallback lyrics API`,
  },
  {
    pattern: new RegExp("^\\[lxPluginRequest\\] 沙箱模式 (.+) (.+) 失败: (.+)$"),
    replace: (_m, g0, g1, g2) => `[lxPluginRequest] sandbox mode ${g0} ${g1} failed: ${g2}`,
  },
  {
    pattern: new RegExp("^\\[lxPluginRequest\\] 插件未就绪: (.+)$"),
    replace: (_m, g0) => `[lxPluginRequest] plugin not ready: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[lxPluginRequest\\] 插件未注册 requestHandler: (.+)$"),
    replace: (_m, g0) => `[lxPluginRequest] plugin has no requestHandler registered: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[lxPluginRequest\\] 插件 lxApi 未保存: (.+)$"),
    replace: (_m, g0) => `[lxPluginRequest] plugin lxApi not saved: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[lxPluginRequest\\] (.+) musicUrl 成功: (.+)\\.\\.\\.$"),
    replace: (_m, g0, g1) => `[lxPluginRequest] ${g0} musicUrl succeeded: ${g1}...`,
  },
  {
    pattern: new RegExp("^\\[lxPluginRequest\\] (.+) lyric 不支持，交给后备歌词接口处理$"),
    replace: (_m, g0) => `[lxPluginRequest] ${g0} lyric unsupported, handing to fallback lyrics API`,
  },
  {
    pattern: new RegExp("^\\[lxPluginRequest\\] (.+) (.+) 失败: (.+)$"),
    replace: (_m, g0, g1, g2) => `[lxPluginRequest] ${g0} ${g1} failed: ${g2}`,
  },
  {
    pattern: new RegExp("^\\[getLxPluginScript\\] (.+)… 持久化路径\\(备份\\) (.+) 与内存路径\\(原文件\\) (.+) 不一致，优先读取备份$"),
    replace: (_m, g0, g1, g2) => `[getLxPluginScript] ${g0}… persisted path (backup) ${g1} differs from memory path (original) ${g2}, reading backup first`,
  },
  {
    pattern: new RegExp("^\\[ensureLxPluginInstance\\] 插件已禁用，跳过: (.+)$"),
    replace: (_m, g0) => `[ensureLxPluginInstance] plugin disabled, skipping: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[ensureLxPluginInstance\\] 等待已存在的初始化 Promise: (.+)$"),
    replace: (_m, g0) => `[ensureLxPluginInstance] waiting for existing init Promise: ${g0}`,
  },
  {
    pattern: new RegExp("^落雪插件实例未缓存，重新加载: (.+) \\((.+)\\)$"),
    replace: (_m, g0, g1) => `LX plugin instance not cached, reloading: ${g0} (${g1})`,
  },
  {
    pattern: new RegExp("^落雪插件重新加载失败: (.+) (.+)$"),
    replace: (_m, g0, g1) => `LX plugin reload failed: ${g0} ${g1}`,
  },
  {
    pattern: new RegExp("^落雪插件已销毁: (.+)$"),
    replace: (_m, g0) => `LX plugin destroyed: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[initLxPlugin\\] 开始初始化: (.+) \\((.+)\\)$"),
    replace: (_m, g0, g1) => `[initLxPlugin] initializing: ${g0} (${g1})`,
  },
  {
    pattern: new RegExp("^\\[initLxPlugin\\] 无法读取脚本: (.+)$"),
    replace: (_m, g0) => `[initLxPlugin] cannot read script: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[initLxPlugin\\] 初始化成功: (.+)$"),
    replace: (_m, g0) => `[initLxPlugin] initialized: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[initLxPlugin\\] 初始化失败: (.+) \\(sources 为空\\)$"),
    replace: (_m, g0) => `[initLxPlugin] init failed: ${g0} (sources empty)`,
  },
  {
    pattern: new RegExp("^\\[initLxPlugin\\] 初始化异常: (.+) - (.+)$"),
    replace: (_m, g0, g1) => `[initLxPlugin] init error: ${g0} - ${g1}`,
  },
  {
    pattern: new RegExp("^\\[lxSourceFallback\\] Rust 换源失败: (.+)$"),
    replace: (_m, g0) => `[lxSourceFallback] Rust source switch failed: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[LXUrlResolver\\] Rust 批量音质回退失败: (.+)$"),
    replace: (_m, g0) => `[LXUrlResolver] Rust batch quality fallback failed: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[LXUrlResolver\\] 歌曲级别错误，跳过剩余音质: (.+)$"),
    replace: (_m, g0) => `[LXUrlResolver] Song-level error, skipping remaining qualities: ${g0}`,
  },
  {
    pattern: new RegExp("^插件已初始化，但初始化信息中没有音源“(.+)”$"),
    replace: (_m, g0) => `Plugin initialized but its info has no source "${g0}"`,
  },
  {
    pattern: new RegExp("^应用歌曲目录返回 (.+) 首歌曲；选中后由“(.+)”获取歌词$"),
    replace: (_m, g0, g1) => `App song directory returned ${g0} songs; lyrics fetched by "${g1}" after selection`,
  },
  {
    pattern: new RegExp("^应用歌曲目录搜索成功，但没有找到与“(.+)”匹配的歌曲$"),
    replace: (_m, g0) => `App song directory search succeeded but found no song matching "${g0}"`,
  },
  {
    pattern: new RegExp("^应用歌曲目录搜索失败：(.+)$"),
    replace: (_m, g0) => `App song directory search failed: ${g0}`,
  },
  {
    pattern: new RegExp("^插件“(.+)”不可用$"),
    replace: (_m, g0) => `Plugin "${g0}" unavailable`,
  },
  {
    pattern: new RegExp("^\\[platformComments\\] (.+) 评论获取失败:$"),
    replace: (_m, g0) => `[platformComments] Failed to fetch comments for ${g0}:`,
  },
  {
    pattern: new RegExp("^未在 (.+) 中找到匹配的歌单$"),
    replace: (_m, g0) => `No matching playlist found in ${g0}`,
  },
  {
    pattern: new RegExp("^未能从 (.+) 收藏夹中获取歌曲，请检查链接是否正确$"),
    replace: (_m, g0) => `Could not get songs from ${g0} favorites, check the link`,
  },
  {
    pattern: new RegExp("^(.+)收藏夹$"),
    replace: (_m, g0) => `${g0} favorites`,
  },
  {
    pattern: new RegExp("^不支持的音源: (.+)$"),
    replace: (_m, g0) => `Unsupported source: ${g0}`,
  },
  {
    pattern: new RegExp("^signedRequestWithRetry: (.+) 第 (.+)/(.+) 次重试（(.+)ms 后）, error=(.+)$"),
    replace: (_m, g0, g1, g2, g3, g4) => `signedRequestWithRetry: ${g0} retry ${g1}/${g2} (after ${g3}ms), error=${g4}`,
  },
  {
    pattern: new RegExp("^signedRequestWithRetry: (.+) 重试 (.+) 次后仍失败, error=(.+)$"),
    replace: (_m, g0, g1, g2) => `signedRequestWithRetry: ${g0} still failing after ${g1} retries, error=${g2}`,
  },
  {
    pattern: new RegExp("^fileSyncUpload: 总歌曲数=(.+)$"),
    replace: (_m, g0) => `fileSyncUpload: total songs=${g0}`,
  },
  {
    pattern: new RegExp("^fileSyncUpload: 分为 (.+) 块, 每块最多 (.+) 首歌$"),
    replace: (_m, g0, g1) => `fileSyncUpload: split into ${g0} chunks, max ${g1} songs each`,
  },
  {
    pattern: new RegExp("^fileSyncUpload: 上传第 (.+)/(.+) 块, 歌单数=(.+), 歌曲数=(.+)$"),
    replace: (_m, g0, g1, g2, g3) => `fileSyncUpload: uploading chunk ${g0}/${g1}, playlists=${g2}, songs=${g3}`,
  },
  {
    pattern: new RegExp("^fileSyncUpload ← 完成: playlist_count=(.+), song_total=(.+)$"),
    replace: (_m, g0, g1) => `fileSyncUpload ← done: playlist_count=${g0}, song_total=${g1}`,
  },
  {
    pattern: new RegExp("^缺少可处理“(.+)”的插件$"),
    replace: (_m, g0) => `No plugin available to handle "${g0}"`,
  },
  {
    pattern: new RegExp("^(.+) 备份（未标注版本）$"),
    replace: (_m, g0) => `${g0} backup (version not specified)`,
  },
  {
    pattern: new RegExp("^(.+) 旧版备份，已还原 (.+) 首歌曲 ID 以恢复逐字歌词$"),
    replace: (_m, g0, g1) => `${g0} legacy backup, restored ${g1} song IDs to recover word-level lyrics`,
  },
  {
    pattern: new RegExp("^(.+) 旧版备份$"),
    replace: (_m, g0) => `${g0} legacy backup`,
  },
  {
    pattern: new RegExp("^(.+) 新版备份$"),
    replace: (_m, g0) => `${g0} new backup`,
  },
  {
    pattern: new RegExp("^\\[proxyAxios\\] 请求体过大 (.+) bytes，截断$"),
    replace: (_m, g0) => `[proxyAxios] request body too large (${g0} bytes), truncating`,
  },
  {
    pattern: new RegExp("^\\[proxyAxios\\] 请求失败: (.+), url=(.+)$"),
    replace: (_m, g0, g1) => `[proxyAxios] request failed: ${g0}, url=${g1}`,
  },
  {
    pattern: new RegExp("^插件大小不能超过 2MB \\(当前: (.+) bytes\\)$"),
    replace: (_m, g0) => `Plugin cannot exceed 2MB (current: ${g0} bytes)`,
  },
  {
    pattern: new RegExp("^=== 开始加载插件: (.+) \\((.+) chars\\) ===$"),
    replace: (_m, g0, g1) => `=== Loading plugin: ${g0} (${g1} chars) ===`,
  },
  {
    pattern: new RegExp("^\\[loadPluginFromScript\\] 沙箱模式加载: (.+)$"),
    replace: (_m, g0) => `[loadPluginFromScript] loading in sandbox mode: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[loadPluginFromScript\\] 沙箱加载失败，已阻止回退到主线程直接执行: (.+)$"),
    replace: (_m, g0) => `[loadPluginFromScript] sandbox load failed, fallback to main-thread execution blocked: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[loadPluginFromScript\\] 插件加载失败 \\(uri=(.+)\\): (.+)$"),
    replace: (_m, g0, g1) => `[loadPluginFromScript] plugin load failed (uri=${g0}): ${g1}`,
  },
  {
    pattern: new RegExp("^(.+) 第(.+)次 → (.+)$"),
    replace: (_m, g0, g1, g2) => `${g0} attempt ${g1} → ${g2}`,
  },
  {
    pattern: new RegExp("^\\[pluginSearch\\] 实例为 null: (.+)$"),
    replace: (_m, g0) => `[pluginSearch] instance is null: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[pluginSearch\\] 实例就绪: (.+), search=(.+)$"),
    replace: (_m, g0, g1) => `[pluginSearch] instance ready: ${g0}, search=${g1}`,
  },
  {
    pattern: new RegExp("^\\[(.+)\\] 无 search 函数$"),
    replace: (_m, g0) => `[${g0}] no search function`,
  },
  {
    pattern: new RegExp("^\\[(.+)\\] 无 getLyric 函数（歌词替换场景需要）$"),
    replace: (_m, g0) => `[${g0}] no getLyric function (needed for lyric replacement)`,
  },
  {
    pattern: new RegExp("^\\[pluginSearch\\] (.+) searchType=(.+), 第 (.+) 次调用 search\\(\\)$"),
    replace: (_m, g0, g1, g2) => `[pluginSearch] ${g0} searchType=${g1}, calling search() attempt ${g2}`,
  },
  {
    pattern: new RegExp("^插件搜索与宿主兜底均未找到与“(.+)”匹配的歌曲$"),
    replace: (_m, g0) => `Neither plugin search nor host fallback found a song matching "${g0}"`,
  },
  {
    pattern: new RegExp("^\\[pluginSearch\\] (.+) 第 (.+) 次返回空列表，(.+)ms 后重试\\(共 (.+) 次\\)$"),
    replace: (_m, g0, g1, g2, g3) => `[pluginSearch] ${g0} returned empty on attempt ${g1}, retrying after ${g2}ms (${g3} total)`,
  },
  {
    pattern: new RegExp("^插件返回 (.+) 首歌曲，可逐项获取歌词$"),
    replace: (_m, g0) => `Plugin returned ${g0} songs, lyrics can be fetched per item`,
  },
  {
    pattern: new RegExp("^插件搜索成功，但没有找到与“(.+)”匹配的歌曲$"),
    replace: (_m, g0) => `Plugin search succeeded but found no song matching "${g0}"`,
  },
  {
    pattern: new RegExp("^插件多次搜索（最多 6 次）均未找到与“(.+)”匹配的歌曲$"),
    replace: (_m, g0) => `Plugin search (up to 6 tries) found no song matching "${g0}"`,
  },
  {
    pattern: new RegExp("^\\[(.+)\\] 搜索失败: (.+)$"),
    replace: (_m, g0, g1) => `[${g0}] search failed: ${g1}`,
  },
  {
    pattern: new RegExp("^插件搜索调用失败：(.+)$"),
    replace: (_m, g0) => `Plugin search call failed: ${g0}`,
  },
  {
    pattern: new RegExp("^(.+)收藏夹$"),
    replace: (_m, g0) => `${g0} favorites`,
  },
  {
    pattern: new RegExp("^\\[(.+)\\] importMusicSheet 回退失败:$"),
    replace: (_m, g0) => `[${g0}] importMusicSheet fallback failed:`,
  },
  {
    pattern: new RegExp("^\\[(.+)\\] 歌单搜索无结果: search\\(sheet/playlist\\) 返回 keys=$"),
    replace: (_m, g0) => `[${g0}] playlist search empty: search(sheet/playlist) returned keys=`,
  },
  {
    pattern: new RegExp("^\\[(.+)\\] 歌单搜索失败:$"),
    replace: (_m, g0) => `[${g0}] playlist search failed:`,
  },
  {
    pattern: new RegExp("^\\[(.+)\\] 歌单搜索失败: (.+)$"),
    replace: (_m, g0, g1) => `[${g0}] playlist search failed: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[(.+)\\] getTopLists 调用失败:$"),
    replace: (_m, g0) => `[${g0}] getTopLists call failed:`,
  },
  {
    pattern: new RegExp("^\\[(.+)\\] getAlbumInfo\\(album as playlist\\) 调用失败: (.+)$"),
    replace: (_m, g0, g1) => `[${g0}] getAlbumInfo (album as playlist) call failed: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[(.+)\\] getTopListDetail 调用失败: (.+)$"),
    replace: (_m, g0, g1) => `[${g0}] getTopListDetail call failed: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[(.+)\\] getMusicSheetInfo 调用失败，尝试搜索回退: (.+)$"),
    replace: (_m, g0, g1) => `[${g0}] getMusicSheetInfo call failed, trying search fallback: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[(.+)\\] 获取歌单详情失败: (.+)$"),
    replace: (_m, g0, g1) => `[${g0}] failed to get playlist detail: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[(.+)\\] importMusicSheet 失败: (.+)$"),
    replace: (_m, g0, g1) => `[${g0}] importMusicSheet failed: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[(.+)\\] getArtistWorks 调用失败，尝试搜索回退: (.+)$"),
    replace: (_m, g0, g1) => `[${g0}] getArtistWorks call failed, trying search fallback: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[(.+)\\] 获取歌手作品失败: (.+)$"),
    replace: (_m, g0, g1) => `[${g0}] failed to get artist works: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[(.+)\\] 获取歌手专辑失败: (.+)$"),
    replace: (_m, g0, g1) => `[${g0}] failed to get artist albums: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[(.+)\\] getAlbumInfo 调用失败，尝试搜索回退: (.+)$"),
    replace: (_m, g0, g1) => `[${g0}] getAlbumInfo call failed, trying search fallback: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[pluginGetAlbumSongs\\] (.+) getAlbumInfo 为空，走宿主 QQ 专辑曲目兜底: (.+)$"),
    replace: (_m, g0, g1) => `[pluginGetAlbumSongs] ${g0} getAlbumInfo empty, using host QQ album tracks fallback: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[(.+)\\] 获取专辑详情失败: (.+)$"),
    replace: (_m, g0, g1) => `[${g0}] failed to get album detail: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[getMediaSource\\] (.+) 声明原生音质键 (.+)，直传原生键: (.+)$"),
    replace: (_m, g0, g1, g2) => `[getMediaSource] ${g0} declares native quality keys ${g1}, passing through native keys: ${g2}`,
  },
  {
    pattern: new RegExp("^\\[getMediaSource\\] 调用 (.+), id=(.+), platform=(.+), tryQualities=(.+)$"),
    replace: (_m, g0, g1, g2, g3) => `[getMediaSource] calling ${g0}, id=${g1}, platform=${g2}, tryQualities=${g3}`,
  },
  {
    pattern: new RegExp("^\\[getMediaSource\\] 歌曲级错误，跳过剩余音质: (.+)$"),
    replace: (_m, g0) => `[getMediaSource] song-level error, skipping remaining qualities: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[getMediaSource\\] 旧三档音质均不支持，尝试插件原生音质键: (.+)$"),
    replace: (_m, g0) => `[getMediaSource] legacy three tiers unsupported, trying plugin native quality keys: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[getMediaSource\\] 原生音质键 (.+) 获取成功$"),
    replace: (_m, g0) => `[getMediaSource] native quality key ${g0} succeeded`,
  },
  {
    pattern: new RegExp("^\\[getMediaSource\\] 原生音质键 (.+) 未返回有效URL$"),
    replace: (_m, g0) => `[getMediaSource] native quality key ${g0} returned no valid URL`,
  },
  {
    pattern: new RegExp("^\\[getMediaSource\\] 原生音质键 (.+) 异常: (.+)$"),
    replace: (_m, g0, g1) => `[getMediaSource] native quality key ${g0} error: ${g1}`,
  },
  {
    pattern: new RegExp("^异常: (.+)$"),
    replace: (_m, g0) => `Error: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[getMvSource\\] (.+) 调用失败: (.+)$"),
    replace: (_m, g0, g1) => `[getMvSource] ${g0} call failed: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[getLyric\\] (.+) 成功, rawLrc长度=(.+), ttml长度=(.+), lxlyric长度=(.+), yrc长度=(.+), qrc长度=(.+), eslrc长度=(.+)$"),
    replace: (_m, g0, g1, g2, g3, g4, g5, g6) => `[getLyric] ${g0} succeeded, rawLrc=${g1}, ttml=${g2}, lxlyric=${g3}, yrc=${g4}, qrc=${g5}, eslrc=${g6}`,
  },
  {
    pattern: new RegExp("^(.+) 多次尝试后仍为空/异常，放弃本次 artist 结果: (.+)$"),
    replace: (_m, g0, g1) => `${g0} still empty/error after multiple tries, giving up this artist result: ${g1}`,
  },
  {
    pattern: new RegExp("^(.+) 提取出 (.+) 条但无有效 artist 字段$"),
    replace: (_m, g0, g1) => `${g0} extracted ${g1} items but none have a valid artist field`,
  },
  {
    pattern: new RegExp("^\\[pluginArtistSearch\\] (.+) 失败: (.+)$"),
    replace: (_m, g0, g1) => `[pluginArtistSearch] ${g0} failed: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[pluginAlbumSearch\\] (.+) 宿主专辑兜底成功: (.+) 张$"),
    replace: (_m, g0, g1) => `[pluginAlbumSearch] ${g0} host album fallback succeeded: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[pluginAlbumSearch\\] (.+) 直接专辑搜索为空，回退到音乐搜索提取专辑$"),
    replace: (_m, g0) => `[pluginAlbumSearch] ${g0} direct album search empty, falling back to extracting albums from music search`,
  },
  {
    pattern: new RegExp("^\\[pluginAlbumSearch\\] (.+) 失败: (.+)$"),
    replace: (_m, g0, g1) => `[pluginAlbumSearch] ${g0} failed: ${g1}`,
  },
  {
    pattern: new RegExp("^插件实例未缓存，重新加载: (.+) \\((.+)\\)$"),
    replace: (_m, g0, g1) => `Plugin instance not cached, reloading: ${g0} (${g1})`,
  },
  {
    pattern: new RegExp("^插件地址返回 HTTP (.+)$"),
    replace: (_m, g0) => `Plugin URL returned HTTP ${g0}`,
  },
  {
    pattern: new RegExp("^无法下载插件脚本：(.+)$"),
    replace: (_m, g0) => `Cannot download plugin script: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[ensurePluginInstance\\] (.+) 读取脚本成功: (.+) chars$"),
    replace: (_m, g0, g1) => `[ensurePluginInstance] ${g0} script read succeeded: ${g1} chars`,
  },
  {
    pattern: new RegExp("^无法读取插件文件：(.+)$"),
    replace: (_m, g0) => `Cannot read plugin file: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[ensurePluginInstance\\] (.+) 读取脚本失败: (.+)$"),
    replace: (_m, g0, g1) => `[ensurePluginInstance] ${g0} script read failed: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[ensurePluginInstance\\] (.+) loadPluginFromScript 返回 null$"),
    replace: (_m, g0) => `[ensurePluginInstance] ${g0} loadPluginFromScript returned null`,
  },
  {
    pattern: new RegExp("^\\[ensurePluginInstance\\] (.+) loadPluginFromScript 成功: loadedId=(.+)\\.\\.\\. sourceId=(.+)\\.\\.\\. match=(.+)$"),
    replace: (_m, g0, g1, g2, g3) => `[ensurePluginInstance] ${g0} loadPluginFromScript succeeded: loadedId=${g1}... sourceId=${g2}... match=${g3}`,
  },
  {
    pattern: new RegExp("^\\[ensurePluginInstance\\] (.+) 已缓存实例到 source\\.id，并映射沙箱别名$"),
    replace: (_m, g0) => `[ensurePluginInstance] ${g0} cached instance to source.id and mapped sandbox alias`,
  },
  {
    pattern: new RegExp("^\\[ensurePluginInstance\\] (.+) 警告: loadedSource\\.id 在 pluginInstances 中未找到$"),
    replace: (_m, g0) => `[ensurePluginInstance] ${g0} warning: loadedSource.id not found in pluginInstances`,
  },
  {
    pattern: new RegExp("^\\[ensurePluginInstance\\] (.+) 回退匹配成功: key=(.+)\\.\\.\\.$"),
    replace: (_m, g0, g1) => `[ensurePluginInstance] ${g0} fallback match succeeded: key=${g1}...`,
  },
  {
    pattern: new RegExp("^\\[ensurePluginInstance\\] (.+) 脚本为空，readError=(.+)$"),
    replace: (_m, g0, g1) => `[ensurePluginInstance] ${g0} script empty, readError=${g1}`,
  },
  {
    pattern: new RegExp("^\\[ensurePluginInstance\\] (.+) 最终: 实例已就绪$"),
    replace: (_m, g0) => `[ensurePluginInstance] ${g0} final: instance ready`,
  },
  {
    pattern: new RegExp("^\\[ensurePluginInstance\\] (.+) 最终: 实例为 null, error=(.+)$"),
    replace: (_m, g0, g1) => `[ensurePluginInstance] ${g0} final: instance is null, error=${g1}`,
  },
  {
    pattern: new RegExp("^\\[ensurePluginInstance\\] (.+) 重新加载异常: (.+)$"),
    replace: (_m, g0, g1) => `[ensurePluginInstance] ${g0} reload error: ${g1}`,
  },
  {
    pattern: new RegExp("^插件初始化异常：(.+)$"),
    replace: (_m, g0) => `Plugin init error: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[getPluginUserVariableValues\\] pluginId=(.+)\\.\\.\\. localStorage无值 \\(key=(.+)\\.\\.\\.\\)$"),
    replace: (_m, g0, g1) => `[getPluginUserVariableValues] pluginId=${g0}... localStorage empty (key=${g1}...)`,
  },
  {
    pattern: new RegExp("^\\[getPluginUserVariableValues\\] pluginId=(.+)\\.\\.\\. 读取异常: (.+)$"),
    replace: (_m, g0, g1) => `[getPluginUserVariableValues] pluginId=${g0}... read error: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[setPluginUserVariableValues\\] 保存异常: (.+)$"),
    replace: (_m, g0) => `[setPluginUserVariableValues] save error: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[togglePlugin\\] 启用 LX 插件，开始初始化: (.+)$"),
    replace: (_m, g0) => `[togglePlugin] enabling LX plugin, initializing: ${g0}`,
  },
  {
    pattern: new RegExp("^(.+) 初始化失败$"),
    replace: (_m, g0) => `${g0} initialization failed`,
  },
  {
    pattern: new RegExp("^\\[togglePlugin\\] 禁用 LX 插件，销毁实例: (.+)$"),
    replace: (_m, g0) => `[togglePlugin] disabling LX plugin, destroying instance: ${g0}`,
  },
  {
    pattern: new RegExp("^内置插件文件不可用: (.+)$"),
    replace: (_m, g0) => `Built-in plugin file unavailable: ${g0}`,
  },
  {
    pattern: new RegExp("^内置插件加载成功: (.+)$"),
    replace: (_m, g0) => `Built-in plugin loaded: ${g0}`,
  },
  {
    pattern: new RegExp("^内置插件加载失败: (.+) - (.+)$"),
    replace: (_m, g0, g1) => `Built-in plugin load failed: ${g0} - ${g1}`,
  },
  {
    pattern: new RegExp("^loadBuiltinPlugins: (.+) 个插件加载被拒绝$"),
    replace: (_m, g0) => `loadBuiltinPlugins: ${g0} plugin loads rejected`,
  },
  {
    pattern: new RegExp("^\\[loadPlugins\\] 懒加载模式：跳过 (.+) 个插件的预初始化$"),
    replace: (_m, g0) => `[loadPlugins] lazy-load mode: skipping pre-init of ${g0} plugins`,
  },
  {
    pattern: new RegExp("^跳过禁用的 LX 插件: (.+)$"),
    replace: (_m, g0) => `Skipping disabled LX plugin: ${g0}`,
  },
  {
    pattern: new RegExp("^LX 插件 (.+) 初始化失败: (.+)$"),
    replace: (_m, g0, g1) => `LX plugin ${g0} init failed: ${g1}`,
  },
  {
    pattern: new RegExp("^插件 (.+) 加载失败: (.+)$"),
    replace: (_m, g0, g1) => `Plugin ${g0} load failed: ${g1}`,
  },
  {
    pattern: new RegExp("^保存插件脚本到数据目录失败 (.+): (.+)$"),
    replace: (_m, g0, g1) => `Failed to save plugin script to data directory ${g0}: ${g1}`,
  },
  {
    pattern: new RegExp("^restorePluginFromSync: 脚本为空, 跳过 (.+)$"),
    replace: (_m, g0) => `restorePluginFromSync: script empty, skipping ${g0}`,
  },
  {
    pattern: new RegExp("^restorePluginFromSync: 插件已存在, 更新元数据 (.+)$"),
    replace: (_m, g0) => `restorePluginFromSync: plugin exists, updating metadata ${g0}`,
  },
  {
    pattern: new RegExp("^restorePluginFromSync: 脚本解析失败 (.+)$"),
    replace: (_m, g0) => `restorePluginFromSync: script parse failed ${g0}`,
  },
  {
    pattern: new RegExp("^restorePluginFromSync: 恢复成功 (.+) \\((.+)\\)$"),
    replace: (_m, g0, g1) => `restorePluginFromSync: restored ${g0} (${g1})`,
  },
  {
    pattern: new RegExp("^restorePluginFromSync: 恢复失败 (.+) - (.+)$"),
    replace: (_m, g0, g1) => `restorePluginFromSync: restore failed ${g0} - ${g1}`,
  },
  {
    pattern: new RegExp("^插件存储已迁移到后端: (.+) cookies, (.+) storage keys$"),
    replace: (_m, g0, g1) => `Plugin storage migrated to backend: ${g0} cookies, ${g1} storage keys`,
  },
  {
    pattern: new RegExp("^沙箱别名已注册: (.+)\\.\\.\\. -> (.+)\\.\\.\\.$"),
    replace: (_m, g0, g1) => `Sandbox alias registered: ${g0}... -> ${g1}...`,
  },
  {
    pattern: new RegExp("^沙箱不存在: (.+)$"),
    replace: (_m, g0) => `Sandbox does not exist: ${g0}`,
  },
  {
    pattern: new RegExp("^沙箱未就绪: (.+)$"),
    replace: (_m, g0) => `Sandbox not ready: ${g0}`,
  },
  {
    pattern: new RegExp("^沙箱已销毁: (.+)$"),
    replace: (_m, g0) => `Sandbox destroyed: ${g0}`,
  },
  {
    pattern: new RegExp("^(.+): 获取脚本失败$"),
    replace: (_m, g0) => `${g0}: failed to fetch script`,
  },
  {
    pattern: new RegExp("^uploadPlugins: 本地用户插件 (.+) 个$"),
    replace: (_m, g0) => `uploadPlugins: ${g0} local user plugins`,
  },
  {
    pattern: new RegExp("^\\[checkPluginUpdate\\] (.+) 检查更新: (.+)$"),
    replace: (_m, g0, g1) => `[checkPluginUpdate] ${g0} checking update: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[checkPluginUpdate\\] (.+) 获取脚本失败$"),
    replace: (_m, g0) => `[checkPluginUpdate] ${g0} script fetch failed`,
  },
  {
    pattern: new RegExp("^\\[checkPluginUpdate\\] (.+) 脚本哈希一致 \\(hash=(.+)\\.\\.\\.\\)，无更新$"),
    replace: (_m, g0, g1) => `[checkPluginUpdate] ${g0} script hash matches (hash=${g1}...), no update`,
  },
  {
    pattern: new RegExp("^\\[checkPluginUpdate\\] (.+) 脚本哈希不同: 当前=(.+)\\.\\.\\. 远程=(.+)\\.\\.\\.，继续版本比较$"),
    replace: (_m, g0, g1, g2) => `[checkPluginUpdate] ${g0} script hash differs: current=${g1}... remote=${g2}..., comparing versions`,
  },
  {
    pattern: new RegExp("^\\[checkPluginUpdate\\] (.+) 无法从新脚本提取版本号$"),
    replace: (_m, g0) => `[checkPluginUpdate] ${g0} cannot extract version from new script`,
  },
  {
    pattern: new RegExp("^\\[checkPluginUpdate\\] (.+): 当前=(.+), 远程=(.+), 有更新=(.+)$"),
    replace: (_m, g0, g1, g2, g3) => `[checkPluginUpdate] ${g0}: current=${g1}, remote=${g2}, hasUpdate=${g3}`,
  },
  {
    pattern: new RegExp("^\\[performPluginUpdate\\] (.+) 更新成功: (.+) → (.+)$"),
    replace: (_m, g0, g1, g2) => `[performPluginUpdate] ${g0} updated: ${g1} → ${g2}`,
  },
  {
    pattern: new RegExp("^(.+) 已更新到 (.+)$"),
    replace: (_m, g0, g1) => `${g0} updated to ${g1}`,
  },
  {
    pattern: new RegExp("^\\[performPluginUpdate\\] (.+) 更新失败: (.+)$"),
    replace: (_m, g0, g1) => `[performPluginUpdate] ${g0} update failed: ${g1}`,
  },
  {
    pattern: new RegExp("^\\[checkAllPluginUpdates\\] (.+) 检查失败: (.+)$"),
    replace: (_m, g0, g1) => `[checkAllPluginUpdates] ${g0} check failed: ${g1}`,
  },
  {
    pattern: new RegExp("^识别请求失败 \\(HTTP (.+)\\)$"),
    replace: (_m, g0) => `Recognition request failed (HTTP ${g0})`,
  },
  {
    pattern: new RegExp("^uploadSettings: 上传失败: (.+)$"),
    replace: (_m, g0) => `uploadSettings: upload failed: ${g0}`,
  },
  {
    pattern: new RegExp("^downloadSettings: 下载成功, uploaded_at=(.+)$"),
    replace: (_m, g0) => `downloadSettings: download succeeded, uploaded_at=${g0}`,
  },
  {
    pattern: new RegExp("^downloadSettings: 下载失败: (.+)$"),
    replace: (_m, g0) => `downloadSettings: download failed: ${g0}`,
  },
  {
    pattern: new RegExp("^\\[localStore\\] localStorage 容量超限，跳过写入: (.+)$"),
    replace: (_m, g0) => `[localStore] localStorage quota exceeded, skipping write: ${g0}`,
  },
  {
    pattern: new RegExp("^(.+) - 歌曲 (.+)$"),
    replace: (_m, g0, g1) => `${g0} - Song ${g1}`,
  },
  {
    pattern: new RegExp("^(.+) 的专辑$"),
    replace: (_m, g0) => `Albums for ${g0}`,
  },
  {
    pattern: new RegExp("^(.+) 相关歌手 (.+)$"),
    replace: (_m, g0, g1) => `${g0} related artists ${g1}`,
  },
  {
    pattern: new RegExp("^(.+) 相关的歌手简介 (.+)$"),
    replace: (_m, g0, g1) => `${g0} related artist bio ${g1}`,
  },
  {
    pattern: new RegExp("^(.+) 专辑 (.+)$"),
    replace: (_m, g0, g1) => `${g0} album ${g1}`,
  },
  {
    pattern: new RegExp("^(.+) 演唱者 (.+)$"),
    replace: (_m, g0, g1) => `${g0} singer ${g1}`,
  },
  {
    pattern: new RegExp("^(.+) 歌单 (.+)$"),
    replace: (_m, g0, g1) => `${g0} playlist ${g1}`,
  },
  {
    pattern: new RegExp("^用户 (.+)$"),
    replace: (_m, g0) => `User ${g0}`,
  },
  {
    pattern: new RegExp("^(.+) 相关的歌单 (.+)$"),
    replace: (_m, g0, g1) => `${g0} related playlists ${g1}`,
  },
  {
    pattern: new RegExp("^\\[HotSearch\\] 获取热搜失败: (.+)$"),
    replace: (_m, g0) => `[HotSearch] Failed to fetch hot search: ${g0}`,
  },
  {
    pattern: new RegExp("^ZIP: 无效的 Central Directory 条目 #(.+)$"),
    replace: (_m, g0) => `ZIP: invalid Central Directory entry #${g0}`,
  },
  {
    pattern: new RegExp("^ZIP: 无效的 Local File Header: (.+)$"),
    replace: (_m, g0) => `ZIP: invalid Local File Header: ${g0}`,
  },
  {
    pattern: new RegExp("^ZIP: 不支持的压缩方法 (.+) \\((.+)\\)$"),
    replace: (_m, g0, g1) => `ZIP: unsupported compression method ${g0} (${g1})`,
  },
  {
    pattern: new RegExp("^ZIP 中未找到可识别的备份文件。包含: (.+)$"),
    replace: (_m, g0) => `No recognizable backup file found in ZIP. Contains: ${g0}`,
  },
  {
    pattern: new RegExp("^确定要从收藏中移除选中的 (.+) 首歌曲吗？$"),
    replace: (_m, g0) => `Remove the selected ${g0} songs from favorites?`,
  },
  {
    pattern: new RegExp("^无法加载用户数据：(.+)$"),
    replace: (_m, g0) => `Cannot load user data: ${g0}`,
  },
  {
    pattern: new RegExp("^加载失败: (.+)$"),
    replace: (_m, g0) => `Load failed: ${g0}`,
  },
  {
    pattern: new RegExp("^播放失败: (.+)$"),
    replace: (_m, g0) => `Playback failed: ${g0}`,
  },
  {
    pattern: new RegExp("^正在从 (.+) 加载榜单…$"),
    replace: (_m, g0) => `Loading charts from ${g0}…`,
  },
  {
    pattern: new RegExp("^(.+)万播放$"),
    replace: (_m, g0) => `${g0}0K plays`,
  },
  {
    pattern: new RegExp("^(.+) 播放$"),
    replace: (_m, g0) => `${g0} plays`,
  },
{
  pattern: new RegExp("^代理地址无效: (.+)$"),
  replace: (_m, g0) => `Invalid proxy address: ${g0}`,
},
];