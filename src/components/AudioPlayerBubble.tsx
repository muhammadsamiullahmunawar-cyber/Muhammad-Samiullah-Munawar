import { useEffect, useId, useRef, useState } from "react";
import { Download, Loader2, Pause, Play, RefreshCw } from "lucide-react";
import { formatDuration } from "@/lib/media-utils";
import { downloadMedia } from "@/lib/media-storage";
import { toast } from "sonner";

const GLOBAL_AUDIO_PLAY_EVENT = "techu-audio-playing";

// In-memory cache per audio source URL / path so blobs are never downloaded twice
const voiceBlobCache = new Map<string, Blob>();

export function AudioPlayerBubble({
  src,
  durationSeconds,
  isMine,
  mimeType,
  mediaPath,
  onRefreshUrl,
}: {
  src: string | null;
  durationSeconds?: number | null;
  isMine: boolean;
  mimeType?: string | null;
  mediaPath?: string | null;
  onRefreshUrl?: () => Promise<string | null>;
}) {
  const instanceId = useId();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [playbackRate, setPlaybackRate] = useState<1 | 1.5 | 2>(1);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isLoadingBlob, setIsLoadingBlob] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [activeBlobUrl, setActiveBlobUrl] = useState<string | null>(null);

  // Check if format can be played on this device
  const isFormatSupported = (() => {
    if (typeof window === "undefined" || !mimeType) return true;
    try {
      const a = document.createElement("audio");
      return a.canPlayType(mimeType) !== "";
    } catch {
      return true;
    }
  })();

  // Compute effective duration: prefer stored media_duration_seconds, fallback to finite audio.duration
  const effectiveDuration = (() => {
    if (
      durationSeconds !== null &&
      durationSeconds !== undefined &&
      Number.isFinite(durationSeconds) &&
      durationSeconds > 0
    ) {
      return Math.round(durationSeconds);
    }
    if (audioDuration !== null && Number.isFinite(audioDuration) && audioDuration > 0) {
      return audioDuration;
    }
    return 0;
  })();

  // Pause other voice notes when any voice note plays
  useEffect(() => {
    const handleOtherPlay = (e: Event) => {
      const custom = e as CustomEvent<{ id: string }>;
      if (custom.detail?.id !== instanceId && audioRef.current && !audioRef.current.paused) {
        audioRef.current.pause();
        setIsPlaying(false);
      }
    };

    window.addEventListener(GLOBAL_AUDIO_PLAY_EVENT, handleOtherPlay);
    return () => {
      window.removeEventListener(GLOBAL_AUDIO_PLAY_EVENT, handleOtherPlay);
    };
  }, [instanceId]);

  // Clean up created object URL on unmount
  useEffect(() => {
    return () => {
      if (activeBlobUrl && activeBlobUrl.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(activeBlobUrl);
        } catch {
          // ignore
        }
      }
    };
  }, [activeBlobUrl]);

  // Audio element listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateFromAudio = () => {
      if (audio) {
        setCurrentTime(audio.currentTime);
      }
    };

    const onLoadedMetadata = () => {
      if (audio.duration && Number.isFinite(audio.duration) && audio.duration > 0) {
        setAudioDuration(Math.round(audio.duration));
      }
      setIsBuffering(false);
    };

    const onDurationChange = () => {
      if (audio.duration && Number.isFinite(audio.duration) && audio.duration > 0) {
        setAudioDuration(Math.round(audio.duration));
      }
    };

    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      if (audio) {
        audio.currentTime = 0;
      }
    };

    const onWaiting = () => setIsBuffering(true);
    const onStalled = () => setIsBuffering(true);
    const onPlaying = () => {
      setIsBuffering(false);
      setIsPlaying(true);
    };
    const onCanPlay = () => setIsBuffering(false);
    const onPause = () => setIsPlaying(false);
    const onError = () => {
      setIsBuffering(false);
      setIsPlaying(false);
      setHasError(true);
    };

    audio.addEventListener("timeupdate", updateFromAudio);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("stalled", onStalled);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("timeupdate", updateFromAudio);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("stalled", onStalled);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("error", onError);
      audio.pause();
    };
  }, []);

  // Smooth requestAnimationFrame while playing for seamless progress bar fill
  useEffect(() => {
    if (!isPlaying) return;
    let rafId: number;

    const tick = () => {
      if (audioRef.current && !audioRef.current.paused) {
        setCurrentTime(audioRef.current.currentTime);
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [isPlaying]);

  // Load audio blob reliably for Android Chrome / Data Saver
  const loadAudioBlob = async (targetSrc: string): Promise<string> => {
    if (targetSrc.startsWith("blob:")) return targetSrc;

    const cacheKey = mediaPath || targetSrc;
    const cached = voiceBlobCache.get(cacheKey);
    if (cached) {
      const objUrl = URL.createObjectURL(cached);
      setActiveBlobUrl(objUrl);
      return objUrl;
    }

    setIsLoadingBlob(true);
    try {
      let resp = await fetch(targetSrc);
      if (!resp.ok && (resp.status === 400 || resp.status === 403) && onRefreshUrl) {
        // Refresh signed URL once if expired
        const fresh = await onRefreshUrl();
        if (fresh) {
          resp = await fetch(fresh);
        }
      }
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const blob = await resp.blob();
      voiceBlobCache.set(cacheKey, blob);
      const objUrl = URL.createObjectURL(blob);
      setActiveBlobUrl(objUrl);
      return objUrl;
    } finally {
      setIsLoadingBlob(false);
    }
  };

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio || !src) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }

    setHasError(false);
    window.dispatchEvent(
      new CustomEvent(GLOBAL_AUDIO_PLAY_EVENT, { detail: { id: instanceId } }),
    );

    try {
      let playUrl = activeBlobUrl;
      if (!playUrl) {
        playUrl = await loadAudioBlob(src);
        audio.src = playUrl;
        audio.load();
      }

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        await playPromise;
        setIsPlaying(true);
      }
    } catch (err) {
      console.error("Audio playback error:", err);
      setIsPlaying(false);
      setHasError(true);
    }
  };

  const handleRetry = async () => {
    setHasError(false);
    if (onRefreshUrl) {
      try {
        const fresh = await onRefreshUrl();
        if (fresh) {
          await loadAudioBlob(fresh);
          togglePlay();
          return;
        }
      } catch (e) {
        console.error("Retry audio error:", e);
      }
    }
    if (src) {
      try {
        await loadAudioBlob(src);
        togglePlay();
      } catch {
        setHasError(true);
      }
    }
  };

  const handleDownload = async () => {
    if (!mediaPath) {
      if (activeBlobUrl) {
        const a = document.createElement("a");
        a.href = activeBlobUrl;
        a.download = `voice-note-${Date.now()}.${mimeType?.includes("mp4") ? "mp4" : "webm"}`;
        a.click();
        return;
      }
      toast.error("Download link unavailable");
      return;
    }
    setIsDownloading(true);
    try {
      await downloadMedia({ path: mediaPath, mimeType });
      toast.success("Voice note downloaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to download voice note");
    } finally {
      setIsDownloading(false);
    }
  };

  const seekToClientX = (clientX: number) => {
    const audio = audioRef.current;
    const bar = progressBarRef.current;
    if (!audio || !bar || !effectiveDuration) return;

    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const target = ratio * effectiveDuration;

    audio.currentTime = target;
    setCurrentTime(target);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    seekToClientX(e.clientX);

    const onPointerMove = (ev: PointerEvent) => {
      seekToClientX(ev.clientX);
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const cycleSpeed = () => {
    const nextRate: 1 | 1.5 | 2 = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
    setPlaybackRate(nextRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate;
    }
  };

  const progressPercent =
    effectiveDuration > 0 ? Math.min(100, Math.max(0, (currentTime / effectiveDuration) * 100)) : 0;

  if (!isFormatSupported) {
    return (
      <div className="flex flex-col gap-1.5 py-1 text-xs">
        <span className="opacity-80">This voice note cannot be played on this device</span>
        <button
          type="button"
          onClick={handleDownload}
          disabled={isDownloading}
          className="inline-flex items-center gap-1.5 font-semibold text-primary underline hover:opacity-80 touch-manipulation"
        >
          {isDownloading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Download className="size-3.5" />
          )}
          Download voice note
        </button>
      </div>
    );
  }

  return (
    <div className="flex w-full min-w-0 max-w-[270px] sm:w-64 items-center gap-2 py-1 select-none">
      <audio ref={audioRef} preload="none" />

      {hasError ? (
        <button
          type="button"
          onClick={handleRetry}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-destructive text-destructive-foreground hover:opacity-90 touch-manipulation"
          title="Retry loading voice note"
          aria-label="Retry voice note"
        >
          <RefreshCw className="size-4" />
        </button>
      ) : (
        <button
          type="button"
          onClick={togglePlay}
          disabled={!src || isLoadingBlob}
          className={`grid size-10 shrink-0 place-items-center rounded-full transition-transform active:scale-95 touch-manipulation ${
            isMine
              ? "bg-primary text-primary-foreground hover:opacity-90"
              : "bg-primary text-primary-foreground hover:opacity-90"
          }`}
          aria-label={isPlaying ? "Pause voice note" : "Play voice note"}
        >
          {isLoadingBlob || isBuffering ? (
            <Loader2 className="size-4 animate-spin" />
          ) : isPlaying ? (
            <Pause className="size-4 fill-current" />
          ) : (
            <Play className="ms-0.5 size-4 fill-current" />
          )}
        </button>
      )}

      <div className="flex flex-1 min-w-0 flex-col justify-center gap-1">
        <div
          ref={progressBarRef}
          className="relative h-2.5 w-full cursor-pointer touch-none rounded-full bg-black/10 py-0.5 dark:bg-white/10"
          onPointerDown={handlePointerDown}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-75"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-[11px] opacity-70">
          <span>{formatDuration(Math.floor(currentTime || 0))}</span>
          <span>{formatDuration(effectiveDuration || 0)}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={cycleSpeed}
        className="rounded px-1.5 py-1 text-xs font-semibold opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5 touch-manipulation min-h-[36px] flex items-center shrink-0"
        aria-label={`Playback speed: ${playbackRate}x`}
      >
        {playbackRate}x
      </button>

      {mediaPath && (
        <button
          type="button"
          onClick={handleDownload}
          disabled={isDownloading}
          className="grid size-8 shrink-0 place-items-center rounded-full opacity-60 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5 touch-manipulation"
          title="Download voice note"
          aria-label="Download voice note"
        >
          {isDownloading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Download className="size-3.5" />
          )}
        </button>
      )}
    </div>
  );
}
