import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ValidatedMedia } from "./media-utils";

const BUCKET = "chat-media";
// Signed URLs expire after 60 mins (3600s); cache locally for 50 minutes
const signedUrlCache = new Map<string, { url: string; exp: number }>();
const TTL_MS = 50 * 60 * 1000;

export async function getSignedMediaUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const hit = signedUrlCache.get(path);
  if (hit && hit.exp > Date.now()) {
    return hit.url;
  }

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) {
    return null;
  }

  signedUrlCache.set(path, { url: data.signedUrl, exp: Date.now() + TTL_MS });
  return data.signedUrl;
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
