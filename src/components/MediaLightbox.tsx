import { useEffect } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface LightboxItem {
  type: "image" | "video";
  url: string;
  title?: string;
}

export function MediaLightbox({
  item,
  onClose,
}: {
  item: LightboxItem | null;
  onClose: () => void;
}) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (item) {
      window.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [item, onClose]);

  if (!item) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="absolute end-4 top-4 z-10 flex items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <Button
          asChild
          variant="secondary"
          size="icon"
          className="size-9 rounded-full bg-black/60 text-white hover:bg-black/80"
        >
          <a
            href={item.url}
            download
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Download"
          >
            <Download className="size-4" />
          </a>
        </Button>
        <Button
          variant="secondary"
          size="icon"
          className="size-9 rounded-full bg-black/60 text-white hover:bg-black/80"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="size-4" />
        </Button>
      </div>

      <div
        className="relative flex max-h-[90vh] max-w-[90vw] items-center justify-center overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {item.type === "image" ? (
          <img
            src={item.url}
            alt={item.title || "Image"}
            className="max-h-[85vh] max-w-full rounded-lg object-contain shadow-2xl"
          />
        ) : (
          <video
            src={item.url}
            controls
            autoPlay
            playsInline
            className="max-h-[85vh] max-w-full rounded-lg shadow-2xl"
          />
        )}
      </div>
    </div>
  );
}
