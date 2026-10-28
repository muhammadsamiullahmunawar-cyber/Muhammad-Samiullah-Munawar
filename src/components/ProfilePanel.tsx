import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { signedAvatarUrl, uploadAvatar } from "@/lib/avatar";
import { initials } from "@/lib/chat-data";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const MAX_BYTES = 5 * 1024 * 1024;

export function ProfilePanel({
  open,
  onClose,
  me,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  me: string;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [about, setAbout] = useState("");
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingFile = useRef<File | null>(null);

  useEffect(() => {
    if (!open) return;
    pendingFile.current = null;
    supabase
      .from("profiles")
      .select("username,display_name,about,avatar_url")
      .eq("id", me)
      .single()
      .then(async ({ data }) => {
        if (!data) return;
        setName(data.display_name || "");
        setUsername(data.username);
        setAbout(data.about || t("defaultAbout"));
        setAvatarPath(data.avatar_url);
        setPreview(data.avatar_url ? await signedAvatarUrl(data.avatar_url) : null);
      });
  }, [open, me, t]);

  function pickFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      toast.error(t("photoMustBeImage"));
      return;
    }
    if (f.size > MAX_BYTES) {
      toast.error(t("photoTooBig"));
      return;
    }
    pendingFile.current = f;
    setPreview(URL.createObjectURL(f));
  }

  function removeAvatar() {
    pendingFile.current = null;
    setPreview(null);
    setAvatarPath(null);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const display = name.trim();
    if (!display) return;
    if (display.length > 40) {
      toast.error("Display name must be 40 characters or less");
      return;
    }
    const cleanAbout = about.trim().slice(0, 120);
    setBusy(true);
    try {
      let path = avatarPath;
      if (pendingFile.current) {
        path = await uploadAvatar(me, pendingFile.current);
        pendingFile.current = null;
      }
      const { error } = await supabase
        .from("profiles")
        .update({
          display_name: display,
          about: cleanAbout,
          avatar_url: path,
        })
        .eq("id", me);
      if (error) throw error;
      setAvatarPath(path);
      toast.success(t("profileSaved"));
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("profileSaveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("myProfile")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="group relative grid size-24 place-items-center overflow-hidden rounded-full bg-secondary text-2xl font-bold text-secondary-foreground"
              aria-label={t("changePhoto")}
            >
              {preview ? (
                <img src={preview} alt="" className="size-full object-cover" />
              ) : (
                initials(name || username || "?")
              )}
              <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                <Camera className="size-6 text-white" />
              </span>
            </button>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t("changePhoto")}</span>
              {(preview || avatarPath) && (
                <button
                  type="button"
                  onClick={removeAvatar}
                  className="text-xs text-destructive hover:underline"
                >
                  Remove
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={pickFile}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="profile-name">
              {t("displayName")}
            </label>
            <Input
              id="profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              required
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="profile-about">
              {t("about")}
            </label>
            <Input
              id="profile-about"
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              maxLength={120}
              placeholder={t("defaultAbout")}
            />
          </div>
          <p className="text-xs text-muted-foreground">@{username}</p>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            {t("save")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
