import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// avatar_url stores the object path inside the private "avatars" bucket.
// Signed URLs expire after 1h; cache them for 50 minutes.
const cache = new Map<string, { url: string; exp: number }>();
const TTL_MS = 50 * 60 * 1000;

export async function signedAvatarUrl(path: string): Promise<string | null> {
  const hit = cache.get(path);
  if (hit && hit.exp > Date.now()) return hit.url;
  const { data, error } = await supabase.storage.from("avatars").createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return null;
  cache.set(path, { url: data.signedUrl, exp: Date.now() + TTL_MS });
  return data.signedUrl;
}

export function useAvatarUrl(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!path) {
      setUrl(null);
      return;
    }
    signedAvatarUrl(path).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [path]);
  return url;
}

export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const ext =
    (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${userId}/avatar-${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  cache.delete(path);
  return path;
}
