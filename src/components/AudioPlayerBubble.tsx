import { useEffect, useId, useRef, useState } from "react";
import { Loader2, Pause, Play } from "lucide-react";
import { formatDuration } from "@/lib/media-utils";

const GLOBAL_AUDIO_PLAY_EVENT = "techu-audio-playing";

export function AudioPlayerBubble({
  src,
  durationSeconds,
  isMine,
}: {
  src: string | null;
  durationSeconds?: number | null;
  isMine: boolean;
}) {
  const instanceId = useId();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [playbackRate, setPlaybackRate] = useState<1 | 1.5 | 2>(1);
  const [isBuffering, setIsBuffering] = useState(false);

  // Compute effective duration: prefer finite audio.duration; fallback to media_duration_seconds
  const effectiveDuration = (() => {
    if (audioDuration !== null && Number.isFinite(audioDuration) && audioDuration > 0) {
      return audioDuration;
    }
    if (
      durationSeconds !== null &&
      durationSeconds !== undefined &&
      Number.isFinite(durationSeconds) &&
      durationSeconds > 0
    ) {
      return Math.round(durationSeconds);
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
    const onPlaying = () => {
      setIsBuffering(false);
      setIsPlaying(true);
    };
    const onPause = () => setIsPlaying(false);

    audio.addEventListener("timeupdate", updateFromAudio);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onPause);

    return () => {
      audio.removeEventListener("timeupdate", updateFromAudio);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onPause);
      audio.pause();
      if (src && src.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(src);
        } catch {
          // ignore
        }
      }
    };
  }, [src]);

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

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio || !src) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      // Notify other players to pause first
      window.dispatchEvent(
        new CustomEvent(GLOBAL_AUDIO_PLAY_EVENT, { detail: { id: instanceId } }),
      );
      try {
        await audio.play();
        setIsPlaying(true);
      } catch (err) {
        console.error("Playback error:", err);
      }
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

  return (
    <div className="flex w-64 max-w-full items-center gap-2 py-1 select-none">
      {src && <audio ref={audioRef} src={src} preload="metadata" />}

      <button
        type="button"
        onClick={togglePlay}
        disabled={!src}
        className={`grid size-9 shrink-0 place-items-center rounded-full transition-transform active:scale-95 ${
          isMine
            ? "bg-primary text-primary-foreground hover:opacity-90"
            : "bg-primary text-primary-foreground hover:opacity-90"
        }`}
        aria-label={isPlaying ? "Pause voice note" : "Play voice note"}
      >
        {isBuffering ? (
          <Loader2 className="size-4 animate-spin" />
        ) : isPlaying ? (
          <Pause className="size-4 fill-current" />
        ) : (
          <Play className="ms-0.5 size-4 fill-current" />
        )}
      </button>

      <div className="flex flex-1 flex-col justify-center gap-1">
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
        className="rounded px-1.5 py-0.5 text-xs font-semibold opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5"
        aria-label={`Playback speed: ${playbackRate}x`}
      >
        {playbackRate}x
      </button>
    </div>
  );
}
