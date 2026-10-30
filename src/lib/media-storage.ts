import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ValidatedMedia } from "./media-utils";

const BUCKET = "chat-media";
// Signed URLs expire after 60 mins (3600s); cache locally for 50 minutes
const signedUrlCache = new Map<string, { url: string; exp: number }>();
const TTL_MS = 50 * 60 * 1000;

export function evictSignedUrl(path: string | null | undefined) {
  if (path) signedUrlCache.delete(path);
}

export async function getSignedMediaUrl(
  path: string | null | undefined,
  forceRefresh = false,
): Promise<string | null> {
  if (!path) return null;
  if (!forceRefresh) {
    const hit = signedUrlCache.get(path);
    if (hit && hit.exp > Date.now()) {
      return hit.url;
    }
  }

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) {
    return null;
  }

  signedUrlCache.set(path, { url: data.signedUrl, exp: Date.now() + TTL_MS });
  return data.signedUrl;
}

export async function downloadMedia({
  path,
  mimeType,
  fallbackFilename,
}: {
  path: string;
  mimeType?: string | null;
  fallbackFilename?: string;
}): Promise<void> {
  let ext = "bin";
  if (mimeType) {
    if (mimeType.includes("mp4")) ext = "mp4";
    else if (mimeType.includes("webm")) ext = "webm";
    else if (mimeType.includes("ogg")) ext = "ogg";
    else if (mimeType.includes("wav")) ext = "wav";
    else if (mimeType.includes("jpeg") || mimeType.includes("jpg")) ext = "jpg";
    else if (mimeType.includes("png")) ext = "png";
    else if (mimeType.includes("webp")) ext = "webp";
    else if (mimeType.includes("gif")) ext = "gif";
  } else if (path.includes(".")) {
    const parts = path.split(".");
    ext = parts[parts.length - 1].toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  }
  const filename = fallbackFilename || `techu-${Date.now()}.${ext}`;

  // 1. Try createSignedUrl with { download: filename }
  let downloadUrl: string | null = null;
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, 3600, { download: filename });
    if (!error && data?.signedUrl) {
      downloadUrl = data.signedUrl;
    }
  } catch {
    // fallback to normal signed URL
  }

  if (!downloadUrl) {
    downloadUrl = await getSignedMediaUrl(path);
  }

  if (!downloadUrl) throw new Error("Could not generate download link");

  // 2. Fetch blob to guarantee Android Chrome saves the file with correct name and extension
  try {
    let res = await fetch(downloadUrl);
    if (!res.ok && (res.status === 400 || res.status === 403)) {
      // Refresh expired signed URL once
      evictSignedUrl(path);
      const fresh = await getSignedMediaUrl(path, true);
      if (fresh) {
        res = await fetch(fresh);
      }
    }
    if (!res.ok) throw new Error(`Download HTTP error ${res.status}`);

    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
  } catch (err) {
    console.error("Direct blob download failed, falling back to link click:", err);
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = filename;
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}

// React hook to fetch and keep signed media URL refreshed
export function useSignedMediaUrl(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!path) {
      setUrl(null);
      return;
    }

    getSignedMediaUrl(path).then((u) => {
      if (alive) setUrl(u);
    });

    return () => {
      alive = false;
    };
  }, [path]);

  return url;
}

// Upload validated media to chat-media bucket under {userId}/{conversationId}/{randomUUID}.{ext}
export async function uploadChatMedia({
  userId,
  conversationId,
  media,
  onProgress,
}: {
  userId: string;
  conversationId: string;
  media: ValidatedMedia;
  onProgress?: (percent: number) => void;
}): Promise<string> {
  const randomUUID = crypto.randomUUID();
  const safeExt = media.extension.toLowerCase().replace(/[^a-z0-9]/g, "");
  // Strict path structure enforcing ownership and conversation scoping
  const storagePath = `${userId}/${conversationId}/${randomUUID}.${safeExt}`;

  // Fake progressive tick for responsive progress feedback
  let progress = 10;
  onProgress?.(progress);
  const timer = setInterval(() => {
    progress = Math.min(85, progress + 15);
    onProgress?.(progress);
  }, 150);

  try {
    const { error } = await supabase.storage.from(BUCKET).upload(storagePath, media.file, {
      contentType: media.mimeType,
      cacheControl: "3600",
      upsert: false,
    });

    clearInterval(timer);

    if (error) {
      throw new Error(error.message || "Failed to upload media");
    }

    onProgress?.(100);
    return storagePath;
  } catch (err) {
    clearInterval(timer);
    throw err;
  }
}
