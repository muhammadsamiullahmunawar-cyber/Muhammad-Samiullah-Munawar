import { useEffect, useRef, useState } from "react";
import { Mic, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import { formatDuration, processVoiceNote, type ValidatedMedia } from "@/lib/media-utils";

const MIC_STORAGE_KEY = "techu_mic_permission";

function getStoredMicPref(): string | null {
  try {
    return localStorage.getItem(MIC_STORAGE_KEY);
  } catch (e) {
    return null;
  }
}

function setStoredMicPref(val: string | null) {
  try {
    if (val === null) {
      localStorage.removeItem(MIC_STORAGE_KEY);
    } else {
      localStorage.setItem(MIC_STORAGE_KEY, val);
    }
  } catch (e) {
    // Ignore storage restriction error
  }
}

export function VoiceRecorder({
  onRecordingComplete,
  disabled,
}: {
  onRecordingComplete: (media: ValidatedMedia) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [isRecording, setIsRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [slideCancelActive, setSlideCancelActive] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  const allowedThisTimeRef = useRef<boolean>(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const cancelledRef = useRef<boolean>(false);
  const durationRef = useRef<number>(0);

  // Pick best supported MIME type: audio/mp4 (AAC), then audio/webm;codecs=opus, then audio/ogg;codecs=opus
  function getSupportedMimeType(): string {
    if (typeof MediaRecorder === "undefined") return "";
    const types = [
      "audio/mp4",
      "audio/webm;codecs=opus",
      "audio/ogg;codecs=opus",
      "audio/webm",
      "audio/aac",
    ];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return "";
  }

  const stopTracks = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const cancelRecording = () => {
    cancelledRef.current = true;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    stopTracks();
    setIsRecording(false);
    setSeconds(0);
    setSlideCancelActive(false);
    toast.info("Recording cancelled");
  };

  const handleMicClick = () => {
    if (disabled || isRecording) return;

    if (typeof window !== "undefined" && window.isSecureContext === false) {
      toast.error(t("micInsecure"));
      return;
    }

    const storedPref = getStoredMicPref();

    if (storedPref === "denied") {
      toast.error(t("micTurnedOff"), {
        action: {
          label: t("micTurnOn"),
          onClick: () => {
            setStoredMicPref(null);
            setShowPrompt(true);
          },
        },
      });
      return;
    }

    if (storedPref === "granted" || allowedThisTimeRef.current) {
      startRecording();
    } else {
      setShowPrompt(true);
    }
  };

  const startRecording = async () => {
    if (disabled || isRecording) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast.error("Audio recording is not supported in this browser");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      streamRef.current = stream;
      audioChunksRef.current = [];
      cancelledRef.current = false;
      durationRef.current = 0;

      const mimeType = getSupportedMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }

        if (cancelledRef.current) {
          audioChunksRef.current = [];
          stopTracks();
          return;
        }

        const realMime = recorder.mimeType || mimeType || "audio/webm";
        const audioBlob = new Blob(audioChunksRef.current, {
          type: realMime,
        });

        // Stop all media tracks only after Blob is safely built
        stopTracks();

        const finalDuration = Math.round(durationRef.current);
        if (finalDuration < 1 && audioBlob.size < 2000) {
          toast.info("Voice note too short");
          return;
        }

        try {
          const validated = await processVoiceNote(audioBlob, finalDuration);
          onRecordingComplete(validated);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Failed to process voice note");
        }
      };

      // Start recording without timeslice to prevent chunk drop / data loss
      recorder.start();
      setIsRecording(true);
      setSeconds(0);

      timerRef.current = window.setInterval(() => {
        setSeconds((prev) => {
          const next = prev + 1;
          durationRef.current = next;
          // Max 3 minutes (180s)
          if (next >= 180) {
            stopRecording();
          }
          return next;
        });
      }, 1000);
    } catch (err: unknown) {
      console.warn("Microphone access error:", err);
      setIsRecording(false);
      setSlideCancelActive(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      stopTracks();

      const errorObj = err as { name?: string };
      if (errorObj?.name === "NotAllowedError" || errorObj?.name === "PermissionDeniedError") {
        toast.error(t("micDeniedHint"));
      } else if (errorObj?.name === "NotFoundError" || errorObj?.name === "DevicesNotFoundError") {
        toast.error(t("micNotFound"));
      } else if (errorObj?.name === "NotReadableError" || errorObj?.name === "TrackStartError") {
        toast.error(t("micBusy"));
      } else {
        toast.error("Could not access microphone");
      }
    }
  };

  const stopRecording = () => {
    if (!isRecording) return;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        if (typeof recorder.requestData === "function") {
          recorder.requestData();
        }
      } catch {
        // ignore if not allowed in current state
      }
      recorder.stop();
    }
    setIsRecording(false);
    setSlideCancelActive(false);
  };

  // Touch handlers for mobile: hold to record, slide left to cancel
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0]?.clientX ?? null;
    handleMicClick();
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isRecording || touchStartXRef.current === null) return;
    const currentX = e.touches[0]?.clientX ?? 0;
    const deltaX = touchStartXRef.current - currentX;
    // Slid left more than 60px
    if (deltaX > 60) {
      setSlideCancelActive(true);
    } else {
      setSlideCancelActive(false);
    }
  };

  const handleTouchEnd = () => {
    if (slideCancelActive) {
      cancelRecording();
    } else if (isRecording) {
      stopRecording();
    }
    touchStartXRef.current = null;
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      stopTracks();
    };
  }, []);

  if (isRecording) {
    return (
      <div className="flex flex-1 items-center justify-between gap-2 rounded-full bg-secondary/80 px-3 py-1 animate-in fade-in">
        <div className="flex items-center gap-2">
          <span className="size-2.5 animate-pulse rounded-full bg-destructive" />
          <span className="font-mono text-xs font-semibold text-foreground">
            {formatDuration(seconds)}
          </span>
          <span className="hidden text-xs text-muted-foreground sm:inline">(Max 3m)</span>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {slideCancelActive ? (
            <span className="font-semibold text-destructive">Release to cancel</span>
          ) : (
            <span className="hidden text-[11px] sm:inline">Slide left to cancel</span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={cancelRecording}
            className="size-10 sm:size-8 rounded-full text-destructive hover:bg-destructive/10 touch-manipulation"
            aria-label="Cancel voice note"
          >
            <Trash2 className="size-4" />
          </Button>

          <Button
            type="button"
            size="icon"
            onClick={stopRecording}
            className="size-10 sm:size-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 touch-manipulation"
            aria-label="Finish and send voice note"
          >
            <Square className="size-3.5 fill-current" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Button
        type="button"
        size="icon"
        variant="secondary"
        disabled={disabled}
        onClick={handleMicClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="size-10 shrink-0 rounded-full touch-manipulation"
        aria-label="Record voice note"
      >
        <Mic className="size-5 sm:size-4" />
      </Button>

      <Dialog open={showPrompt} onOpenChange={setShowPrompt}>
        <DialogContent className="max-w-sm rounded-3xl p-6 shadow-soft">
          <DialogHeader>
            <DialogTitle>{t("micPermissionTitle")}</DialogTitle>
            <DialogDescription className="mt-2 text-sm text-muted-foreground">
              {t("micPermissionDesc")}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 flex flex-col gap-2">
            <Button
              type="button"
              onClick={() => {
                setStoredMicPref("granted");
                setShowPrompt(false);
                startRecording();
              }}
              className="w-full rounded-full"
            >
              {t("micAllow")}
            </Button>

            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                allowedThisTimeRef.current = true;
                setShowPrompt(false);
                startRecording();
              }}
              className="w-full rounded-full"
            >
              {t("micAllowOnce")}
            </Button>

            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setStoredMicPref("denied");
                setShowPrompt(false);
                toast.info(t("micTurnedOff"), {
                  action: {
                    label: t("micTurnOn"),
                    onClick: () => {
                      setStoredMicPref(null);
                      setShowPrompt(true);
                    },
                  },
                });
              }}
              className="w-full rounded-full text-muted-foreground hover:text-foreground"
            >
              {t("micNever")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
