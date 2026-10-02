import { tauriInvoke } from "./invoke";
import type { // 实现
    AudioDevice,
    AudioDeviceFormats,
    AudioOutputStatus,
    PlayAudioOptions,
    PrefetchAudioHeadOptions,
    SeekAudioOptions,
    SoundEffectSettings,
    UpdateLoudnessSettingsOptions,
    UpdatePlaybackMetadataOptions,
    LoudnessRecord,
} from "./contracts";
import { useConcurrentScheduler } from "../../composables/useConcurrentScheduler";

/** 把「开关 + 前置增益 + 十段增益」序列化成可比较的签名字符串。 */
export function createEqualizerSignature(
    enabled: boolean,
    preamp: number,
    gains: number[],
): string {
    const gainText = gains.map((gain) => gain.toFixed(1)).join(",");
    return `${enabled}:${preamp.toFixed(1)}:[${gainText}]`;
}

// —— 均衡器同步的模块级状态 ——
const EQ_THROTTLE_INTERVAL_MS = 50;

// 串行闸门：保证底层同一时刻只处理一个均衡器写入。
const eqScheduler = useConcurrentScheduler(); // 实现
// 最近一次成功同步给底层的签名，供上层做「是否已生效」判断。
let lastSyncedParams: string | null = null; // 实现

// 拖拽节流：待发送的参数与定时器句柄。
let queuedEqualizerArgs: {
    enabled: boolean;
    preamp: number;
    gains: number[];
} | null = null;
let throttleHandle: ReturnType<typeof setTimeout> | null = null;
let lastDispatchAt = 0;

function cancelScheduledThrottle(): void {
    if (throttleHandle !== null) {
        clearTimeout(throttleHandle);
        throttleHandle = null;
    }
}

/** 取出暂存的最新参数并立即下发（节流窗口到期时触发）。 */
function dispatchQueuedEqualizer(): void {
    if (queuedEqualizerArgs === null) return;

    const request = queuedEqualizerArgs;
    queuedEqualizerArgs = null;
    lastDispatchAt = Date.now();

    void playbackApi.setEqualizerSettings(
        request.enabled,
        request.preamp,
        request.gains,
    );
}

export const playbackApi = { // 实现
    // —— 音量与进度查询 ——
    setVolume(volume: number): Promise<void> {
        return tauriInvoke("set_volume", { volume });
    },
    getPlaybackProgress(): Promise<number> {
        return tauriInvoke("get_playback_progress");
    },
    getPlaybackDuration(): Promise<number> {
        return tauriInvoke("get_playback_duration");
    },
    getPlaybackReady(): Promise<boolean> {
        return tauriInvoke("get_playback_ready");
    },
    getPlaybackStartFailed(): Promise<boolean> {
        return tauriInvoke("get_playback_start_failed");
    },
    getPlaybackStartFailedReason(): Promise<string | null> {
        return tauriInvoke("get_playback_start_failed_reason");
    },
    getPlaybackStartFailedInfo(): Promise<{
        failed: boolean;
        reason: string | null;
    }> {
        return tauriInvoke("get_playback_start_failed_info");
    },
    getAudioVisualizerSamples(): Promise<number[]> {
        return tauriInvoke("get_audio_visualizer_samples");
    },

    // —— 播放记录 ——
    recordPlay(payload: {
        songPath: string;
        listenedMs: number;
        durationMs: number;
        title: string;
        artist: string;
        album: string;
        trackNumber?: string;
        countAsPlay: boolean;
    }) {
        return tauriInvoke("record_play", { payload });
    },

    // —— 播放控制 ——
    playAudio(options: PlayAudioOptions): Promise<void> {
        return tauriInvoke("play_audio", options);
    },
    updatePlaybackMetadata(
        options: UpdatePlaybackMetadataOptions,
    ): Promise<void> {
        return tauriInvoke("update_playback_metadata", options);
    },
    pauseAudio(): Promise<void> {
        return tauriInvoke("pause_audio");
    },
    stopAudio(): Promise<void> {
        return tauriInvoke("stop_audio");
    },
    resumeAudio(): Promise<void> {
        return tauriInvoke("resume_audio");
    },
    seekAudio(options: SeekAudioOptions): Promise<void> {
        return tauriInvoke("seek_audio", options);
    },

    // —— 输出设备 ——
    setAudioOutputMode(
        outputMode: PlayAudioOptions["outputMode"],
    ): Promise<void> {
        return tauriInvoke("set_audio_output_mode", { outputMode });
    },
    setOutputDevice(deviceId: string | null) {
        return tauriInvoke("set_output_device", { deviceId });
    },
    setPreventSleep(active: boolean): Promise<void> {
        return tauriInvoke("set_prevent_sleep", { active });
    },
    getOutputDevices(): Promise<AudioDevice[]> {
        return tauriInvoke("get_output_devices");
    },
    getCurrentOutputDevice(): Promise<AudioOutputStatus> {
        return tauriInvoke("get_current_output_device");
    },
    getAudioDeviceFormats(): Promise<AudioDeviceFormats[]> {
        return tauriInvoke("get_audio_device_formats");
    },

    // —— 响度均衡 ——
    getTrackLoudnessInfo(songId: number): Promise<LoudnessRecord | null> {
        return tauriInvoke("get_track_loudness_info", { songId });
    },
    updateLoudnessSettings(
        options: UpdateLoudnessSettingsOptions,
    ): Promise<void> {
        return tauriInvoke("update_loudness_settings", options);
    },

    // —— 音效 ——
    setSoundEffectSettings(settings: SoundEffectSettings): Promise<void> {
        return tauriInvoke("set_sound_effect_settings", { settings });
    },

    // —— 流缓存 ——
    setStreamCacheMaxSize(bytes: number): Promise<void> {
        return tauriInvoke("set_stream_cache_max_size", { bytes });
    },
    getStreamCacheInfo(): Promise<{ current: number; max: number }> {
        return tauriInvoke("get_stream_cache_info");
    },
    clearStreamCache(): Promise<void> {
        return tauriInvoke("clear_stream_cache");
    },
    setStreamCacheDir(path: string): Promise<void> {
        return tauriInvoke("set_stream_cache_dir", { path });
    },
    getStreamCacheDir(): Promise<string> {
        return tauriInvoke("get_stream_cache_dir");
    },

    // —— 预热 ——
    prefetchAudioHead(options: PrefetchAudioHeadOptions): Promise<boolean> {
        return tauriInvoke("prefetch_audio_head", options);
    },

    // —— 均衡器 ——
    getLastSyncedParams(): string | null {
        return lastSyncedParams;
    },

    async setEqualizerSettings(
        enabled: boolean,
        preamp: number,
        gains: number[],
    ): Promise<void> {
        await eqScheduler.execute(async () => {
            await tauriInvoke("set_equalizer_settings", {
                enabled,
                preamp,
                gains,
            });
            lastSyncedParams = createEqualizerSignature(enabled, preamp, gains);
        });
    },

    /** 拖拽场景下的节流入口：窗口期内仅保留最新参数，到期统一下发。 */
    requestEqualizerSettings(
        enabled: boolean,
        preamp: number,
        gains: number[],
    ) {
        queuedEqualizerArgs = { enabled, preamp, gains };

        const elapsedSinceDispatch = Date.now() - lastDispatchAt;
        if (elapsedSinceDispatch >= EQ_THROTTLE_INTERVAL_MS) {
            cancelScheduledThrottle();
            dispatchQueuedEqualizer();
            return;
        }

        if (throttleHandle !== null) return;
        throttleHandle = setTimeout(() => {
            throttleHandle = null;
            dispatchQueuedEqualizer();
        }, EQ_THROTTLE_INTERVAL_MS - elapsedSinceDispatch);
    },

    /** 松手/停止时取消节流并立刻同步最终参数。 */
    flushEqualizerSettings(
        enabled: boolean,
        preamp: number,
        gains: number[],
    ): Promise<void> {
        cancelScheduledThrottle();
        queuedEqualizerArgs = null;

        return playbackApi.setEqualizerSettings(enabled, preamp, gains);
    },
};
