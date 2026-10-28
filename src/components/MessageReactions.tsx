import { useEffect, useRef } from "react";

export const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];
export const REACTION_HOLD_MS = 500;

export interface ReactionRecord {
  message_id: string;
  user_id: string;
  emoji: string;
  created_at?: string;
}

export function ReactionFloatingBar({
  anchorRect,
  coords,
  myReaction,
  onSelectEmoji,
  onClose,
}: {
  anchorRect?: DOMRect | null;
  coords?: { x: number; y: number } | null;
  myReaction?: string;
  onSelectEmoji: (emoji: ReactionEmoji) => void;
  onClose: () => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    const handlePointerDownOutside = (e: MouseEvent | TouchEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDownOutside, true);
    document.addEventListener("touchstart", handlePointerDownOutside, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDownOutside, true);
      document.removeEventListener("touchstart", handlePointerDownOutside, true);
    };
  }, [onClose]);

  // Compute viewport-safe position
  let top = 0;
  let left = 0;

  if (coords) {
    top = coords.y - 54;
    left = coords.x - 120;
  } else if (anchorRect) {
    top = anchorRect.top - 50;
    left = anchorRect.left + anchorRect.width / 2 - 120;
  }

  // Viewport bounds constraint (keep 12px padding from screen edges)
  const estimatedWidth = 240;
  const estimatedHeight = 44;
  if (typeof window !== "undefined") {
    if (top < 12 && anchorRect) {
      top = anchorRect.bottom + 8; // flip below if off top
    }
    top = Math.max(12, Math.min(window.innerHeight - estimatedHeight - 12, top));
    left = Math.max(12, Math.min(window.innerWidth - estimatedWidth - 12, left));
  }

  return (
    <div
      ref={barRef}
      style={{ top: `${top}px`, left: `${left}px` }}
      className="fixed z-50 flex items-center gap-1 rounded-full border border-border/80 bg-popover/95 p-1.5 shadow-xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-150 select-none"
      onClick={(e) => e.stopPropagation()}
    >
      {REACTION_EMOJIS.map((emoji) => {
        const isSelected = myReaction === emoji;
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => {
              if (typeof navigator !== "undefined" && navigator.vibrate) {
                try {
                  navigator.vibrate(40);
                } catch {
                  // ignore
                }
              }
              onSelectEmoji(emoji);
              onClose();
            }}
            className={`grid size-8 place-items-center rounded-full text-lg leading-none transition-transform hover:scale-125 active:scale-95 ${
              isSelected ? "bg-primary/20 ring-1 ring-primary" : "hover:bg-muted"
            }`}
            aria-label={`React with ${emoji}`}
          >
            {emoji}
          </button>
        );
      })}
    </div>
  );
}

export function ReactionChips({
  reactions,
  me,
  onToggleReaction,
  isMine,
}: {
  reactions: ReactionRecord[];
  me: string;
  onToggleReaction: (emoji: ReactionEmoji) => void;
  isMine: boolean;
}) {
  if (!reactions || reactions.length === 0) return null;

  // Group by emoji
  const grouped = new Map<string, { count: number; hasMine: boolean }>();
  for (const r of reactions) {
    const existing = grouped.get(r.emoji) || { count: 0, hasMine: false };
    existing.count += 1;
    if (r.user_id === me) {
      existing.hasMine = true;
    }
    grouped.set(r.emoji, existing);
  }

  return (
    <div className={`mt-1 flex flex-wrap gap-1 ${isMine ? "justify-end" : "justify-start"}`}>
      {Array.from(grouped.entries()).map(([emoji, info]) => (
        <button
          key={emoji}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleReaction(emoji as ReactionEmoji);
          }}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors active:scale-95 select-none ${
            info.hasMine
              ? "border-primary/40 bg-primary/15 text-primary font-semibold shadow-xs"
              : "border-border/60 bg-background/80 text-foreground hover:bg-muted/80 shadow-xs"
          }`}
          aria-label={`${emoji} ${info.count}`}
        >
          <span>{emoji}</span>
          {info.count > 1 && <span className="text-[11px] font-medium">{info.count}</span>}
        </button>
      ))}
    </div>
  );
}
