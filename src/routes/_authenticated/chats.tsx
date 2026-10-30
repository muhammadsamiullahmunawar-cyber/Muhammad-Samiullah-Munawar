import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, memo, type FormEvent } from "react";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  Download,
  Film,
  Loader2,
  LogOut,
  Paperclip,
  Pencil,
  Reply,
  Search,
  Send,
  Trash2,
  Users,
  UserPlus,
  Smile,
  X,
} from "lucide-react";
import {
  ReactionFloatingBar,
  ReactionChips,
  type ReactionEmoji,
  type ReactionRecord,
  REACTION_HOLD_MS,
} from "@/components/MessageReactions";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Brand, LangToggle } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import {
  canEdit,
  deleteContact,
  fetchChats,
  fetchContacts,
  fetchMessages,
  initials,
  PAGE,
  resolveContactName,
  saveContact,
  timeLabel,
  type ChatSummary,
  type Message,
  type Profile,
} from "@/lib/chat-data";
import { ProfilePanel } from "@/components/ProfilePanel";
import { useAvatarUrl } from "@/lib/avatar";
import { MediaLightbox, type LightboxItem } from "@/components/MediaLightbox";
import { AudioPlayerBubble } from "@/components/AudioPlayerBubble";
import { VoiceRecorder } from "@/components/VoiceRecorder";
import { downloadMedia, getSignedMediaUrl, uploadChatMedia, useSignedMediaUrl } from "@/lib/media-storage";
import {
  formatDuration,
  processAndCompressImage,
  processVideo,
  type ValidatedMedia,
} from "@/lib/media-utils";

export const Route = createFileRoute("/_authenticated/chats")({
  validateSearch: z.object({ c: z.string().uuid().optional() }),
  head: () => ({
    meta: [
      { title: "Chats — Techu Brothers" },
      { name: "description", content: "Your Techu Brothers conversations." },
      { property: "og:title", content: "Chats — Techu Brothers" },
      { property: "og:description", content: "Your Techu Brothers conversations." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ChatsPage,
});

function ChatsPage() {
  const { user } = Route.useRouteContext();
  const me = user.id;
  const { c } = Route.useSearch();
  const navigate = useNavigate({ from: "/chats" });
  const qc = useQueryClient();
  const { t } = useI18n();
  const [filter, setFilter] = useState("");
  const [dialog, setDialog] = useState<"direct" | "group" | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [contactModalUser, setContactModalUser] = useState<
    Profile | { id: string; display_name?: string | null; username?: string | null } | null
  >(null);

  const chats = useQuery({ queryKey: ["chats", me], queryFn: () => fetchChats(me) });
  const contacts = useQuery({ queryKey: ["contacts", me], queryFn: () => fetchContacts() });
  const contactsMap = contacts.data ?? {};
  const myProfile = chats.data?.flatMap((x) => x.members).find((m) => m.id === me);

  // live list refresh
  useEffect(() => {
    const ch = supabase
      .channel(`list-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () =>
        qc.invalidateQueries({ queryKey: ["chats", me] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () =>
        qc.invalidateQueries({ queryKey: ["chats", me] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "contacts" }, () => {
        qc.invalidateQueries({ queryKey: ["contacts", me] });
        qc.invalidateQueries({ queryKey: ["chats", me] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc, me]);

  // presence: online users + heartbeat last seen
  const [online, setOnline] = useState<Set<string>>(new Set());
  useEffect(() => {
    const ch = supabase.channel("presence:global", { config: { presence: { key: me } } });
    ch.on("presence", { event: "sync" }, () =>
      setOnline(new Set(Object.keys(ch.presenceState()))),
    ).subscribe((s) => {
      if (s === "SUBSCRIBED") ch.track({ at: Date.now() });
    });
    const beat = () =>
      supabase.from("profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", me);
    beat();
    const iv = setInterval(beat, 60_000);
    return () => {
      clearInterval(iv);
      supabase.removeChannel(ch);
    };
  }, [me]);

  const list = useMemo(
    () => (chats.data ?? []).filter((x) => x.name.toLowerCase().includes(filter.toLowerCase())),
    [chats.data, filter],
  );
  const active = chats.data?.find((x) => x.id === c);

  const markChatRead = async (chatId: string) => {
    if (!chatId || !me) return;
    const nowIso = new Date().toISOString();

    // Optimistically set unread to 0 and myLastRead to now
    qc.setQueryData<ChatSummary[]>(["chats", me], (old) => {
      if (!old) return old;
      return old.map((x) =>
        x.id === chatId ? { ...x, unread: 0, myLastRead: nowIso } : x,
      );
    });

    try {
      const { error } = await supabase
        .from("conversation_members")
        .update({ last_read_at: nowIso })
        .eq("conversation_id", chatId)
        .eq("user_id", me);

      if (error) {
        console.error("[markChatRead Error]:", error.message || error);
      }
    } catch (err) {
      console.error("[markChatRead Exception]:", err instanceof Error ? err.message : String(err));
    }
  };

  // Mark read on opening the chat & reset horizontal scroll
  useEffect(() => {
    if (c) {
      markChatRead(c);
      if (typeof window !== "undefined") {
        window.scrollTo(0, 0);
        document.documentElement.scrollLeft = 0;
        document.body.scrollLeft = 0;
      }
    }
  }, [c]);

  // Mark read when tab becomes visible again or gets window focus
  useEffect(() => {
    const handleVis = () => {
      if (typeof document !== "undefined" && !document.hidden && c) {
        markChatRead(c);
      }
    };
    document.addEventListener("visibilitychange", handleVis);
    window.addEventListener("focus", handleVis);
    return () => {
      document.removeEventListener("visibilitychange", handleVis);
      window.removeEventListener("focus", handleVis);
    };
  }, [c]);

  // Temporary development-only horizontal overflow detector (zero footprint in production)
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
      const timer = setTimeout(() => {
        const docW = window.innerWidth;
        const allEls = document.querySelectorAll("*");
        for (const el of allEls) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            if (rect.right > docW + 1 || rect.left < -1) {
              console.warn("[Dev Overflow Check] Offending element:", el, {
                left: rect.left,
                right: rect.right,
                windowWidth: docW,
              });
            }
          }
        }
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [c]);

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex h-[100dvh] min-h-[100dvh] max-h-[100dvh] w-full overflow-hidden overflow-x-hidden bg-background">
      <aside
        className={`${c ? "hidden md:flex" : "flex"} w-full flex-col border-e bg-sidebar md:w-[360px]`}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <Brand />
          <div className="flex items-center gap-0.5 sm:gap-1">
            <LangToggle />
            <button
              onClick={() => setProfileOpen(true)}
              aria-label={t("myProfile")}
              className="flex size-10 items-center justify-center rounded-full transition-opacity hover:opacity-80 touch-manipulation"
            >
              <Avatar
                name={myProfile?.display_name || myProfile?.username || "?"}
                url={myProfile?.avatar_url}
              />
            </button>
            <Button
              variant="ghost"
              size="icon"
              onClick={signOut}
              aria-label={t("signOut")}
              className="size-10 touch-manipulation"
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
        <div className="flex gap-2 px-4 pb-3">
          <div className="relative flex-1">
            <Search className="absolute start-3 top-2.5 size-4 text-muted-foreground" />
            <Input
              className="h-10 rounded-full ps-9 text-base md:text-sm"
              placeholder={t("searchChats")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <Button
            size="icon"
            variant="secondary"
            className="size-10 shrink-0 rounded-full touch-manipulation"
            onClick={() => setDialog("direct")}
            aria-label={t("newChat")}
          >
            <UserPlus className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="secondary"
            className="size-10 shrink-0 rounded-full touch-manipulation"
            onClick={() => setDialog("group")}
            aria-label={t("newGroup")}
          >
            <Users className="size-4" />
          </Button>
        </div>
        <ul className="flex-1 overflow-y-auto">
          {list.map((x) => {
            const other = x.members.find((m) => m.id !== me);
            return (
              <li key={x.id}>
                <button
                  onClick={() => navigate({ search: { c: x.id } })}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-sidebar-accent touch-manipulation ${x.id === c ? "bg-sidebar-accent" : ""}`}
                >
                  <Avatar
                    name={x.name}
                    url={x.type === "direct" ? other?.avatar_url : undefined}
                    online={x.type === "direct" && !!other && online.has(other.id)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-2">
                      <div className="flex min-w-0 items-baseline gap-1.5 truncate">
                        <span className="truncate font-semibold">{x.name}</span>
                        {x.type === "direct" && other?.username && (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            @{other.username}
                          </span>
                        )}
                      </div>
                      {x.last && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {timeLabel(x.last.created_at)}
                        </span>
                      )}
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="truncate text-sm text-muted-foreground">
                        {x.last
                          ? x.last.deleted_at
                            ? "Message deleted"
                            : x.last.message_type === "image"
                              ? t("photo")
                              : x.last.message_type === "video"
                                ? t("video")
                                : x.last.message_type === "voice"
                                  ? t("voiceMessage")
                                  : x.last.body
                          : "No messages yet"}
                      </span>
                      {x.unread > 0 && (
                        <span className="grid min-w-5 place-items-center rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground">
                          {x.unread > 99 ? "99+" : x.unread}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
          {chats.isSuccess && list.length === 0 && (
            <li className="px-6 py-10 text-center text-sm text-muted-foreground">
              Start a chat by tapping the person icon above.
            </li>
          )}
        </ul>
      </aside>

      <section
        className={`${
          c
            ? "max-md:fixed max-md:inset-0 max-md:z-20 max-md:h-[100dvh] max-md:w-full max-md:left-0 max-md:right-0 max-md:top-0 max-md:bottom-0 max-md:bg-background max-md:overflow-hidden md:flex"
            : "hidden md:flex"
        } flex-1 flex-col min-h-0 min-w-0`}
        style={{ transform: "none", margin: 0 }}
      >
        {active ? (
          <ChatView
            key={active.id}
            chat={active}
            me={me}
            online={online}
            contactsMap={contactsMap}
            onEditContact={(p) => setContactModalUser(p)}
            onBack={() => {
              if (active) markChatRead(active.id);
              navigate({ search: {} });
            }}
            onMarkRead={markChatRead}
          />
        ) : (
          <div className="chat-wallpaper grid flex-1 place-items-center p-6 text-center text-muted-foreground">
            <p>{t("pickChat")}</p>
          </div>
        )}
      </section>

      <NewChatDialog
        mode={dialog}
        onClose={() => setDialog(null)}
        me={me}
        myUsername={myProfile?.username}
        contactsMap={contactsMap}
        onEditContact={(u) => setContactModalUser(u)}
        onCreated={(id) => {
          setDialog(null);
          qc.invalidateQueries({ queryKey: ["chats", me] });
          navigate({ search: { c: id } });
        }}
      />
      <ContactEditDialog
        open={!!contactModalUser}
        contact={contactModalUser}
        currentSavedName={contactModalUser ? contactsMap[contactModalUser.id] : undefined}
        onClose={() => setContactModalUser(null)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["contacts", me] });
          qc.invalidateQueries({ queryKey: ["chats", me] });
        }}
      />
      <ProfilePanel
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        me={me}
        onSaved={() => qc.invalidateQueries({ queryKey: ["chats", me] })}
      />
    </div>
  );
}

function Avatar({
  name,
  url,
  online,
}: {
  name: string;
  url?: string | null | undefined;
  online?: boolean;
}) {
  const src = useAvatarUrl(url);
  return (
    <span className="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-full bg-secondary font-bold text-secondary-foreground">
      {src ? <img src={src} alt="" className="size-full object-cover" /> : initials(name)}
      {online && (
        <span className="absolute bottom-0 end-0 size-3 rounded-full border-2 border-sidebar bg-primary" />
      )}
    </span>
  );
}

function ContactEditDialog({
  contact,
  currentSavedName,
  open,
  onClose,
  onSaved,
}: {
  contact: { id: string; display_name?: string | null; username?: string | null } | null;
  currentSavedName?: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(currentSavedName || "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(currentSavedName || "");
  }, [currentSavedName, open]);

  if (!contact) return null;

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!contact) return;
    const trimmed = name.trim();
    setBusy(true);
    try {
      if (!trimmed) {
        await deleteContact(contact.id);
        toast.success(t("contactDeleted"));
      } else {
        await saveContact(contact.id, trimmed);
        toast.success(t("contactSaved"));
      }
      onSaved();
      onClose();
    } catch (err) {
      console.error("Failed to update contact:", err);
      toast.error(err instanceof Error ? err.message : "Failed to update contact");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!contact) return;
    setBusy(true);
    try {
      await deleteContact(contact.id);
      toast.success(t("contactDeleted"));
      onSaved();
      onClose();
    } catch (err) {
      console.error("Failed to delete contact:", err);
      toast.error(err instanceof Error ? err.message : "Failed to delete contact");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{currentSavedName ? t("editContact") : t("saveContact")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="contact-name">
              {t("savedName")}
            </label>
            <Input
              id="contact-name"
              placeholder={contact.display_name || contact.username || ""}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              @{contact.username} • Only visible to you
            </p>
          </div>
          <div className="flex gap-2">
            {currentSavedName && (
              <Button type="button" variant="outline" onClick={handleDelete} disabled={busy}>
                {t("removeContact")}
              </Button>
            )}
            <Button type="submit" className="flex-1" disabled={busy}>
              {busy && <Loader2 className="animate-spin size-4" />}
              {t("save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface FoundUser {
  id: string;
  username: string;
  display_name: string;
  about?: string;
  avatar_url: string | null;
}

function NewChatDialog({
  mode,
  onClose,
  onCreated,
  me,
  myUsername,
  contactsMap,
  onEditContact,
}: {
  mode: "direct" | "group" | null;
  onClose: () => void;
  onCreated: (id: string) => void;
  me: string;
  myUsername?: string;
  contactsMap: Record<string, string>;
  onEditContact: (user: {
    id: string;
    display_name?: string | null;
    username?: string | null;
  }) => void;
}) {
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [searchStatus, setSearchStatus] = useState<
    "idle" | "searching" | "found" | "not_found" | "self" | "rate_limited" | "error"
  >("idle");
  const [foundUser, setFoundUser] = useState<FoundUser | null>(null);

  useEffect(() => {
    setUsername("");
    setTitle("");
    setSearchStatus("idle");
    setFoundUser(null);
  }, [mode]);

  // Debounced exact search for direct chat mode
  useEffect(() => {
    if (mode !== "direct") return;
    const clean = username.trim().toLowerCase();
    if (!clean) {
      setSearchStatus("idle");
      setFoundUser(null);
      return;
    }
    if (clean.length < 3) {
      setSearchStatus("idle");
      setFoundUser(null);
      return;
    }
    if (myUsername && clean === myUsername.toLowerCase()) {
      setSearchStatus("self");
      setFoundUser(null);
      return;
    }

    setSearchStatus("searching");
    const timer = setTimeout(async () => {
      try {
        const { data, error } = await supabase.rpc("find_user_by_username", {
          p_username: clean,
        });
        if (error) {
          if (error.message.toLowerCase().includes("rate limit")) {
            setSearchStatus("rate_limited");
          } else {
            setSearchStatus("error");
          }
          setFoundUser(null);
          return;
        }
        if (data && data.length > 0) {
          const u = data[0];
          if (u.id === me) {
            setSearchStatus("self");
            setFoundUser(null);
          } else {
            setFoundUser(u);
            setSearchStatus("found");
          }
        } else {
          setSearchStatus("not_found");
          setFoundUser(null);
        }
      } catch {
        setSearchStatus("error");
        setFoundUser(null);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [username, mode, me, myUsername]);

  async function handleStartChat(targetUsername: string) {
    setBusy(true);
    const res = await supabase.rpc("start_direct_chat", { _username: targetUsername.trim() });
    setBusy(false);
    if (res.error) {
      toast.error(res.error.message);
      return;
    }
    onCreated(res.data as string);
  }

  async function submitGroup(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await supabase.rpc("create_group", {
      _title: title,
      _usernames: username.split(/[\s,]+/).filter(Boolean),
    });
    setBusy(false);
    if (res.error) {
      toast.error(res.error.message);
      return;
    }
    onCreated(res.data as string);
  }

  async function handleDirectSubmit(e: FormEvent) {
    e.preventDefault();
    if (foundUser) {
      await handleStartChat(foundUser.username);
    } else {
      const clean = username.trim().toLowerCase();
      if (!clean) return;
      if (myUsername && clean === myUsername.toLowerCase()) {
        toast.error(t("cannotChatSelf"));
        return;
      }
      setBusy(true);
      const { data, error } = await supabase.rpc("find_user_by_username", {
        p_username: clean,
      });
      setBusy(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      if (data && data.length > 0 && data[0].id !== me) {
        setFoundUser(data[0]);
        setSearchStatus("found");
        await handleStartChat(data[0].username);
      } else if (data && data.length > 0 && data[0].id === me) {
        setSearchStatus("self");
      } else {
        setSearchStatus("not_found");
      }
    }
  }

  return (
    <Dialog open={!!mode} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "group" ? t("newGroup") : t("newChat")}</DialogTitle>
        </DialogHeader>
        {mode === "group" ? (
          <form onSubmit={submitGroup} className="space-y-3">
            <Input
              placeholder="Group name"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={60}
              required
            />
            <Input
              placeholder="Usernames, separated by commas"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              Exact usernames only, so nobody can browse the member list.
            </p>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Loader2 className="animate-spin size-4" /> : "Start"}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleDirectSubmit} className="space-y-4">
            <div className="relative">
              <Input
                placeholder={t("searchByUsername")}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
              />
              {searchStatus === "searching" && (
                <span className="absolute end-3 top-2.5">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t("searchByExactUsername")}</p>

            {searchStatus === "self" && (
              <p className="rounded-lg bg-secondary/80 p-3 text-center text-sm font-medium text-muted-foreground">
                {t("cannotChatSelf")}
              </p>
            )}

            {searchStatus === "not_found" && (
              <p className="rounded-lg bg-secondary/80 p-3 text-center text-sm text-muted-foreground">
                {t("userNotFound")}
              </p>
            )}

            {searchStatus === "rate_limited" && (
              <p className="rounded-lg bg-destructive/10 p-3 text-center text-sm text-destructive">
                Search limit reached. Please wait a minute before trying again.
              </p>
            )}

            {searchStatus === "found" && foundUser && (
              <div className="rounded-xl border bg-card p-4 shadow-xs">
                <div className="flex items-center gap-3">
                  <Avatar
                    name={foundUser.display_name || foundUser.username}
                    url={foundUser.avatar_url}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold">
                        {resolveContactName(foundUser, contactsMap)}
                      </span>
                      <button
                        type="button"
                        onClick={() => onEditContact(foundUser)}
                        className="text-xs text-primary hover:underline"
                      >
                        {contactsMap[foundUser.id] ? t("editContact") : t("saveContact")}
                      </button>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">@{foundUser.username}</p>
                    {foundUser.about && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {foundUser.about}
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  type="button"
                  onClick={() => handleStartChat(foundUser.username)}
                  className="mt-4 w-full"
                  disabled={busy}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : t("startChat")}
                </Button>
              </div>
            )}
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ChatBubbleMedia({
  message,
  isMine,
  onOpenLightbox,
}: {
  message: Message;
  isMine: boolean;
  onOpenLightbox: (item: LightboxItem) => void;
}) {
  const url = useSignedMediaUrl(message.media_path);
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!message.media_path) return;
    setDownloading(true);
    try {
      await downloadMedia({
        path: message.media_path,
        mimeType: message.media_mime_type,
      });
      toast.success(
        message.message_type === "image" ? "Photo downloaded" : "Video downloaded",
      );
    } catch {
      toast.error("Download failed");
    } finally {
      setDownloading(false);
    }
  };

  if (message.message_type === "voice") {
    return (
      <AudioPlayerBubble
        src={url}
        durationSeconds={message.media_duration_seconds}
        isMine={isMine}
        mimeType={message.media_mime_type}
        mediaPath={message.media_path}
        onRefreshUrl={() => getSignedMediaUrl(message.media_path, true)}
      />
    );
  }

  if (message.message_type === "image") {
    return (
      <div className="relative my-1 overflow-hidden rounded-xl group/media">
        {url ? (
          <>
            <button
              type="button"
              className="block cursor-pointer overflow-hidden rounded-xl transition-opacity hover:opacity-95"
              onClick={() => onOpenLightbox({ type: "image", url, title: message.body })}
              aria-label="View photo in fullscreen"
            >
              <img
                src={url}
                alt=""
                loading="lazy"
                decoding="async"
                className="max-h-72 w-auto max-w-full rounded-xl object-cover"
              />
            </button>
            {message.media_path && (
              <button
                type="button"
                onClick={handleDownload}
                disabled={downloading}
                className="absolute top-2 end-2 grid size-7 place-items-center rounded-full bg-black/60 text-white shadow-sm transition-opacity hover:bg-black/80 touch-manipulation"
                title="Download photo"
                aria-label="Download photo"
              >
                {downloading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Download className="size-3.5" />
                )}
              </button>
            )}
          </>
        ) : (
          <div className="flex h-36 w-52 items-center justify-center rounded-xl bg-black/5 dark:bg-white/5">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
    );
  }

  if (message.message_type === "video") {
    return (
      <div className="relative my-1 overflow-hidden rounded-xl group/media">
        {url ? (
          <>
            <video
              src={url}
              controls
              playsInline
              preload="metadata"
              className="max-h-72 w-auto max-w-full rounded-xl object-contain bg-black/40"
            />
            {message.media_path && (
              <button
                type="button"
                onClick={handleDownload}
                disabled={downloading}
                className="absolute top-2 end-2 grid size-7 place-items-center rounded-full bg-black/60 text-white shadow-sm transition-opacity hover:bg-black/80 touch-manipulation"
                title="Download video"
                aria-label="Download video"
              >
                {downloading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Download className="size-3.5" />
                )}
              </button>
            )}
          </>
        ) : (
          <div className="flex h-36 w-52 items-center justify-center rounded-xl bg-black/5 dark:bg-white/5">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
    );
  }

  return null;
}

interface MessageItemProps {
  m: Message;
  mine: boolean;
  chatType: "direct" | "group";
  parent?: Message;
  senderName: string;
  othersRead: boolean;
  isSelected: boolean;
  canEditMessage: boolean;
  messageReactions: ReactionRecord[];
  currentUserId: string;
  onSelect: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  onMouseDown: (e: React.MouseEvent, id: string) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseUp: () => void;
  onMouseLeave: () => void;
  onTouchStart: (e: React.TouchEvent, id: string) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
  onOpenReactions: (messageId: string, anchorRect: DOMRect) => void;
  onReply: (m: Message) => void;
  onEdit: (m: Message) => void;
  onDelete: (m: Message) => void;
  onToggleReaction: (messageId: string, emoji: ReactionEmoji) => void;
  onOpenLightbox: (item: LightboxItem) => void;
  photoText: string;
  videoText: string;
  voiceText: string;
}

const MessageItem = memo(function MessageItem({
  m,
  mine,
  chatType,
  parent,
  senderName,
  othersRead,
  isSelected,
  canEditMessage,
  messageReactions,
  currentUserId,
  onSelect,
  onContextMenu,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onMouseLeave,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onTouchCancel,
  onOpenReactions,
  onReply,
  onEdit,
  onDelete,
  onToggleReaction,
  onOpenLightbox,
  photoText,
  videoText,
  voiceText,
}: MessageItemProps) {
  return (
    <div className={`group flex flex-col ${mine ? "items-end" : "items-start"}`}>
      <div
        className={`relative max-w-[85%] md:max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm touch-manipulation break-words [overflow-wrap:anywhere] ${
          mine
            ? "rounded-ee-sm bg-bubble-out text-bubble-out-foreground"
            : "rounded-es-sm bg-bubble-in text-bubble-in-foreground"
        }`}
        onClick={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest("button, a, audio, video, input, textarea")) return;
          onSelect(m.id);
        }}
        onContextMenu={(e) => onContextMenu(e, m.id)}
        onMouseDown={(e) => onMouseDown(e, m.id)}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onTouchStart={(e) => onTouchStart(e, m.id)}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
      >
        {chatType === "group" && !mine && (
          <div className="text-xs font-bold text-primary truncate">{senderName}</div>
        )}
        {parent && (
          <div className="mb-1 truncate rounded-lg border-s-4 border-primary bg-background/40 px-2 py-1 text-xs opacity-80 break-words [overflow-wrap:anywhere]">
            {parent.deleted_at ? "Deleted message" : parent.body}
          </div>
        )}
        {m.deleted_at ? (
          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] italic opacity-60">
            This message was deleted
          </p>
        ) : (
          <>
            {m.message_type && m.message_type !== "text" && (
              <ChatBubbleMedia message={m} isMine={mine} onOpenLightbox={onOpenLightbox} />
            )}
            {m.body &&
              m.body !== photoText &&
              m.body !== videoText &&
              m.body !== voiceText &&
              m.body !== "Photo" &&
              m.body !== "Video" &&
              m.body !== "Voice message" &&
              m.body !== " " && (
                <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{m.body}</p>
              )}
          </>
        )}
        <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] opacity-60">
          {m.edited_at && !m.deleted_at && <span>edited</span>}
          <span>{timeLabel(m.created_at)}</span>
          {mine &&
            (m.id.startsWith("tmp-") ? (
              <Check className="size-3" />
            ) : (
              <CheckCheck className={`size-3 ${othersRead ? "text-primary" : ""}`} />
            ))}
        </div>
        {!m.deleted_at && !m.id.startsWith("tmp-") && (
          <div
            className={`absolute z-20 rounded-full bg-popover p-1 text-popover-foreground shadow-md transition-all ${
              isSelected ? "flex" : "hidden"
            } md:hidden md:group-hover:flex max-md:-top-9 max-md:end-1 ${
              mine ? "md:top-1 md:end-full md:me-1" : "md:top-1 md:start-full md:ms-1"
            }`}
          >
            <button
              type="button"
              className="flex size-8 md:size-auto items-center justify-center rounded-full p-1.5 md:p-1 hover:bg-muted touch-manipulation"
              onClick={(e) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                onOpenReactions(m.id, rect);
              }}
              aria-label="React"
            >
              <Smile className="size-4 md:size-3.5" />
            </button>
            <button
              type="button"
              className="flex size-8 md:size-auto items-center justify-center rounded-full p-1.5 md:p-1 hover:bg-muted touch-manipulation"
              onClick={(e) => {
                e.stopPropagation();
                onReply(m);
              }}
              aria-label="Reply"
            >
              <Reply className="size-4 md:size-3.5" />
            </button>
            {canEditMessage && (
              <button
                type="button"
                className="flex size-8 md:size-auto items-center justify-center rounded-full p-1.5 md:p-1 hover:bg-muted touch-manipulation"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(m);
                }}
                aria-label="Edit"
              >
                <Pencil className="size-4 md:size-3.5" />
              </button>
            )}
            {mine && (
              <button
                type="button"
                className="flex size-8 md:size-auto items-center justify-center rounded-full p-1.5 md:p-1 hover:bg-muted touch-manipulation text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(m);
                }}
                aria-label="Delete for everyone"
              >
                <Trash2 className="size-4 md:size-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
      <ReactionChips
        reactions={messageReactions}
        me={currentUserId}
        onToggleReaction={(emoji) => onToggleReaction(m.id, emoji)}
        isMine={mine}
      />
    </div>
  );
});

function ChatView({
  chat,
  me,
  online,
  contactsMap,
  onEditContact,
  onBack,
}: {
  chat: ChatSummary;
  me: string;
  online: Set<string>;
  contactsMap: Record<string, string>;
  onEditContact: (contact: Profile) => void;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [typing, setTyping] = useState<string[]>([]);
  const [readMap, setReadMap] = useState<Record<string, string>>({});
  const [pendingMedia, setPendingMedia] = useState<ValidatedMedia | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [lightboxItem, setLightboxItem] = useState<LightboxItem | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [reactions, setReactions] = useState<ReactionRecord[]>([]);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [activeReactionTarget, setActiveReactionTarget] = useState<{
    messageId: string;
    anchorRect?: DOMRect | null;
    coords?: { x: number; y: number } | null;
  } | null>(null);

  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdStartPosRef = useRef<{ x: number; y: number } | null>(null);

  const clearHoldTimer = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    holdStartPosRef.current = null;
  };

  const handleBubbleMouseDown = (e: React.MouseEvent, messageId: string) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, a, audio, video, input, textarea")) return;

    clearHoldTimer();
    const startX = e.clientX;
    const startY = e.clientY;
    holdStartPosRef.current = { x: startX, y: startY };

    holdTimerRef.current = setTimeout(() => {
      setActiveReactionTarget({
        messageId,
        coords: { x: startX, y: startY },
      });
      clearHoldTimer();
    }, REACTION_HOLD_MS);
  };

  const handleBubbleMouseMove = (e: React.MouseEvent) => {
    if (!holdStartPosRef.current) return;
    const dx = Math.abs(e.clientX - holdStartPosRef.current.x);
    const dy = Math.abs(e.clientY - holdStartPosRef.current.y);
    if (dx > 10 || dy > 10) {
      clearHoldTimer();
    }
  };

  const handleBubbleTouchStart = (e: React.TouchEvent, messageId: string) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const target = e.target as HTMLElement;
    if (target.closest("button, a, audio, video, input, textarea")) return;

    clearHoldTimer();
    const startX = touch.clientX;
    const startY = touch.clientY;
    holdStartPosRef.current = { x: startX, y: startY };

    holdTimerRef.current = setTimeout(() => {
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        try {
          navigator.vibrate(40);
        } catch {
          // ignore
        }
      }
      setActiveReactionTarget({
        messageId,
        coords: { x: startX, y: startY },
      });
      clearHoldTimer();
    }, REACTION_HOLD_MS);
  };

  const handleBubbleTouchMove = (e: React.TouchEvent) => {
    if (!holdStartPosRef.current || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - holdStartPosRef.current.x);
    const dy = Math.abs(touch.clientY - holdStartPosRef.current.y);
    if (dx > 10 || dy > 10) {
      clearHoldTimer();
    }
  };

  const handleToggleReaction = async (messageId: string, emoji: ReactionEmoji) => {
    if (messageId.startsWith("tmp-")) return;
    const existing = reactions.find((r) => r.message_id === messageId && r.user_id === me);
    if (existing?.emoji === emoji) {
      setReactions((cur) => cur.filter((r) => !(r.message_id === messageId && r.user_id === me)));
      const { error } = await supabase
        .from("message_reactions")
        .delete()
        .eq("message_id", messageId)
        .eq("user_id", me);
      if (error) {
        console.error("Failed to remove reaction:", error);
        setReactions((cur) => [...cur, existing]);
      }
    } else {
      const newRec: ReactionRecord = {
        message_id: messageId,
        user_id: me,
        emoji,
        created_at: new Date().toISOString(),
      };
      setReactions((cur) => [
        ...cur.filter((r) => !(r.message_id === messageId && r.user_id === me)),
        newRec,
      ]);
      const { error } = await supabase.from("message_reactions").upsert(
        {
          message_id: messageId,
          user_id: me,
          emoji,
        },
        { onConflict: "message_id,user_id" },
      );
      if (error) {
        console.error("Failed to set reaction:", error);
        setReactions((cur) => {
          const without = cur.filter((r) => !(r.message_id === messageId && r.user_id === me));
          return existing ? [...without, existing] : without;
        });
      }
    }
  };

  const scroller = useRef<HTMLDivElement>(null);
  const typingCh = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastTyped = useRef(0);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const other = chat.members.find((m) => m.id !== me);
  const nameOf = (id: string) => {
    const p = chat.members.find((m) => m.id === id);
    return resolveContactName(p, contactsMap);
  };

  const markRead = () =>
    supabase
      .from("conversation_members")
      .update({ last_read_at: new Date().toISOString() })
      .eq("conversation_id", chat.id)
      .eq("user_id", me);

  const loadMembersRead = async () => {
    const { data } = await supabase
      .from("conversation_members")
      .select("user_id,last_read_at")
      .eq("conversation_id", chat.id);
    setReadMap(Object.fromEntries((data ?? []).map((r) => [r.user_id, r.last_read_at])));
  };

  useEffect(() => {
    const ids = msgs.map((m) => m.id).filter((id) => !id.startsWith("tmp-"));
    if (ids.length === 0) return;

    supabase
      .from("message_reactions")
      .select("*")
      .in("message_id", ids)
      .then(({ data, error }) => {
        if (!error && data) {
          setReactions(data as ReactionRecord[]);
        }
      });
  }, [msgs, chat.id]);

  useEffect(() => {
    fetchMessages(chat.id).then((m) => {
      setMsgs(m);
      setHasMore(m.length === PAGE);
      requestAnimationFrame(() => scroller.current?.scrollTo({ top: 1e9 }));
    });
    markRead();
    loadMembersRead();
    const ch = supabase
      .channel(`conv-${chat.id}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${chat.id}`,
        },
        (p) => {
          const m = p.new as Message;
          setMsgs((cur) =>
            cur.some((x) => x.id === m.id)
              ? cur
              : [
                  ...cur.filter(
                    (x) => !(x.id.startsWith("tmp-") && x.body === m.body && m.sender_id === me),
                  ),
                  m,
                ],
          );
          if (m.sender_id !== me) markRead();
          requestAnimationFrame(() => scroller.current?.scrollTo({ top: 1e9, behavior: "smooth" }));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${chat.id}`,
        },
        (p) => {
          const m = p.new as Message;
          setMsgs((cur) => cur.map((x) => (x.id === m.id ? m : x)));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "message_reactions",
        },
        (p) => {
          if (p.eventType === "INSERT") {
            const rec = p.new as ReactionRecord;
            setReactions((cur) => {
              const without = cur.filter(
                (r) => !(r.message_id === rec.message_id && r.user_id === rec.user_id),
              );
              return [...without, rec];
            });
          } else if (p.eventType === "UPDATE") {
            const rec = p.new as ReactionRecord;
            setReactions((cur) =>
              cur.map((r) =>
                r.message_id === rec.message_id && r.user_id === rec.user_id ? rec : r,
              ),
            );
          } else if (p.eventType === "DELETE") {
            const old = p.old as Partial<ReactionRecord>;
            if (old.message_id && old.user_id) {
              setReactions((cur) =>
                cur.filter((r) => !(r.message_id === old.message_id && r.user_id === old.user_id)),
              );
            }
          }
        },
      )
      .subscribe();
    const tch = supabase.channel(`typing:${chat.id}`);
    tch
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const uid = payload.uid as string;
        if (uid === me) return;
        setTyping((cur) => [...new Set([...cur, uid])]);
        setTimeout(() => setTyping((cur) => cur.filter((x) => x !== uid)), 3000);
      })
      .on("broadcast", { event: "read" }, () => loadMembersRead())
      .subscribe((s) => {
        if (s === "SUBSCRIBED") tch.send({ type: "broadcast", event: "read", payload: {} });
      });
    typingCh.current = tch;
    return () => {
      supabase.removeChannel(ch);
      supabase.removeChannel(tch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.id]);

  async function loadOlder() {
    if (!msgs[0]) return;
    const el = scroller.current;
    const prevH = el?.scrollHeight ?? 0;
    const older = await fetchMessages(chat.id, msgs[0].created_at);
    setHasMore(older.length === PAGE);
    setMsgs((cur) => [...older, ...cur]);
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - prevH;
    });
  }

  function onType(v: string) {
    setText(v);
    if (Date.now() - lastTyped.current > 2000) {
      lastTyped.current = Date.now();
      typingCh.current?.send({ type: "broadcast", event: "typing", payload: { uid: me } });
    }
  }

  async function handleMediaFile(file: File) {
    try {
      if (file.type.startsWith("image/")) {
        const processed = await processAndCompressImage(file);
        setPendingMedia(processed);
      } else if (file.type.startsWith("video/")) {
        const processed = await processVideo(file);
        setPendingMedia(processed);
      } else {
        toast.error("Only image (JPEG, PNG, WebP, GIF) and video (MP4, WebM) files are supported");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid media file");
    }
  }

  function onPickMedia(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) handleMediaFile(file);
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }

  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleMediaFile(file);
  }

  async function handleVoiceComplete(media: ValidatedMedia) {
    setUploadProgress(10);
    try {
      const uploadedPath = await uploadChatMedia({
        userId: me,
        conversationId: chat.id,
        media,
        onProgress: setUploadProgress,
      });

      const reply = replyTo?.id ?? null;
      setReplyTo(null);

      const tmp: Message = {
        id: `tmp-${Date.now()}`,
        conversation_id: chat.id,
        sender_id: me,
        body: t("voiceMessage"),
        reply_to_id: reply,
        created_at: new Date().toISOString(),
        edited_at: null,
        deleted_at: null,
        message_type: "voice",
        media_path: uploadedPath,
        media_mime_type: media.mimeType,
        media_size_bytes: media.sizeBytes,
        media_duration_seconds: media.durationSeconds ?? null,
      };

      setMsgs((cur) => [...cur, tmp]);
      requestAnimationFrame(() => scroller.current?.scrollTo({ top: 1e9, behavior: "smooth" }));

      const { data, error } = await supabase
        .from("messages")
        .insert({
          conversation_id: chat.id,
          body: t("voiceMessage"),
          reply_to_id: reply,
          message_type: "voice",
          media_path: uploadedPath,
          media_mime_type: media.mimeType,
          media_size_bytes: media.sizeBytes,
          media_duration_seconds: media.durationSeconds ?? null,
        })
        .select()
        .single();

      if (error) {
        setMsgs((cur) => cur.filter((x) => x.id !== tmp.id));
        toast.error(error.message || "Voice note not sent. Try again.");
        return;
      }

      setMsgs((cur) =>
        cur.some((x) => x.id === data.id)
          ? cur.filter((x) => x.id !== tmp.id)
          : cur.map((x) => (x.id === tmp.id ? data : x)),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Voice upload failed");
    } finally {
      setUploadProgress(null);
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const rawBody = text.trim();
    if (!rawBody && !pendingMedia) return;
    if (rawBody.length > 8000) return;

    if (editing) {
      const { error } = await supabase
        .from("messages")
        .update({ body: rawBody })
        .eq("id", editing.id);
      setEditing(null);
      setText("");
      if (error)
        toast.error(
          error.message.includes("window") ? "You can only edit within 15 minutes" : error.message,
        );
      return;
    }

    const currentMedia = pendingMedia;
    const defaultBody =
      currentMedia?.type === "image"
        ? t("photo")
        : currentMedia?.type === "video"
          ? t("video")
          : "";
    const body = rawBody || defaultBody || " ";
    const reply = replyTo?.id ?? null;

    setText("");
    setPendingMedia(null);
    setReplyTo(null);

    let mediaPath: string | null = null;
    if (currentMedia) {
      setUploadProgress(10);
      try {
        mediaPath = await uploadChatMedia({
          userId: me,
          conversationId: chat.id,
          media: currentMedia,
          onProgress: setUploadProgress,
        });
      } catch (err) {
        setUploadProgress(null);
        setPendingMedia(currentMedia);
        setText(rawBody);
        toast.error(err instanceof Error ? err.message : "Upload failed");
        return;
      }
      setUploadProgress(null);
    }

    const tmp: Message = {
      id: `tmp-${Date.now()}`,
      conversation_id: chat.id,
      sender_id: me,
      body,
      reply_to_id: reply,
      created_at: new Date().toISOString(),
      edited_at: null,
      deleted_at: null,
      message_type: currentMedia ? currentMedia.type : "text",
      media_path: mediaPath,
      media_mime_type: currentMedia ? currentMedia.mimeType : null,
      media_size_bytes: currentMedia ? currentMedia.sizeBytes : null,
      media_duration_seconds: currentMedia?.durationSeconds ?? null,
    };

    setMsgs((cur) => [...cur, tmp]);
    requestAnimationFrame(() => scroller.current?.scrollTo({ top: 1e9, behavior: "smooth" }));

    const { data, error } = await supabase
      .from("messages")
      .insert({
        conversation_id: chat.id,
        body: tmp.body,
        reply_to_id: reply,
        message_type: tmp.message_type,
        media_path: tmp.media_path,
        media_mime_type: tmp.media_mime_type,
        media_size_bytes: tmp.media_size_bytes,
        media_duration_seconds: tmp.media_duration_seconds,
      })
      .select()
      .single();

    if (error) {
      setMsgs((cur) => cur.filter((x) => x.id !== tmp.id));
      setText(rawBody);
      setPendingMedia(currentMedia);
      toast.error("Message not sent. Try again.");
      return;
    }

    setMsgs((cur) =>
      cur.some((x) => x.id === data.id)
        ? cur.filter((x) => x.id !== tmp.id)
        : cur.map((x) => (x.id === tmp.id ? data : x)),
    );
  }

  async function del(m: Message) {
    const { error } = await supabase
      .from("messages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", m.id);
    if (error) toast.error(error.message);
  }

  const othersRead = (m: Message) =>
    Object.entries(readMap)
      .filter(([u]) => u !== me)
      .every(([, at]) => at >= m.created_at);

  return (
    <>
      <header className="flex items-center gap-2 sm:gap-3 border-b bg-card px-3 py-2 sm:px-4">
        <Button
          variant="ghost"
          size="icon"
          className="size-10 shrink-0 md:hidden touch-manipulation"
          onClick={onBack}
          aria-label="Back"
        >
          <ArrowLeft className="size-5 rtl:rotate-180" />
        </Button>
        <Avatar
          name={chat.name}
          url={chat.type === "direct" ? other?.avatar_url : undefined}
          online={chat.type === "direct" && !!other && online.has(other.id)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{chat.name}</span>
            {chat.type === "direct" && other?.username && (
              <span className="shrink-0 text-xs text-muted-foreground">@{other.username}</span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {typing.length
              ? `${typing.map(nameOf).join(", ")} typing…`
              : chat.type === "group"
                ? `${chat.members.length} members`
                : other && online.has(other.id)
                  ? "online"
                  : other
                    ? `last seen ${timeLabel(other.last_seen_at)}`
                    : ""}
          </div>
        </div>
        {chat.type === "direct" && other && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onEditContact(other)}
            title={contactsMap[other.id] ? t("editContact") : t("saveContact")}
            aria-label={contactsMap[other.id] ? t("editContact") : t("saveContact")}
          >
            <Pencil className="size-4 text-muted-foreground" />
          </Button>
        )}
      </header>

      <div
        ref={scroller}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`chat-wallpaper relative flex-1 overflow-y-auto overflow-x-hidden px-3 py-4 md:px-10 ${
          isDragging ? "ring-2 ring-inset ring-primary" : ""
        }`}
        onScroll={(e) => {
          if (activeReactionTarget) setActiveReactionTarget(null);
          if (selectedMessageId) setSelectedMessageId(null);
          if (e.currentTarget.scrollTop < 40 && hasMore) loadOlder();
        }}
        onClick={() => {
          if (selectedMessageId) setSelectedMessageId(null);
        }}
      >
        {isDragging && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur-xs">
            <div className="rounded-2xl border-2 border-dashed border-primary bg-card/90 px-6 py-4 text-center shadow-lg">
              <Paperclip className="mx-auto mb-2 size-8 text-primary animate-bounce" />
              <p className="font-semibold text-foreground">Drop photo or video here to attach</p>
            </div>
          </div>
        )}
        <div className="mx-auto flex max-w-3xl flex-col gap-1.5">
          {msgs.map((m) => {
            const mine = m.sender_id === me;
            const parent = m.reply_to_id ? msgs.find((x) => x.id === m.reply_to_id) : undefined;
            return (
              <MessageItem
                key={m.id}
                m={m}
                mine={mine}
                chatType={chat.type}
                parent={parent}
                senderName={nameOf(m.sender_id)}
                othersRead={othersRead(m)}
                isSelected={selectedMessageId === m.id}
                canEditMessage={canEdit(m, me)}
                messageReactions={reactions.filter((r) => r.message_id === m.id)}
                currentUserId={me}
                onSelect={(id) => setSelectedMessageId((prev) => (prev === id ? null : id))}
                onContextMenu={(e, id) => {
                  if (e.shiftKey) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setActiveReactionTarget({
                    messageId: id,
                    coords: { x: e.clientX, y: e.clientY },
                  });
                }}
                onMouseDown={(e, id) => handleBubbleMouseDown(e, id)}
                onMouseMove={handleBubbleMouseMove}
                onMouseUp={clearHoldTimer}
                onMouseLeave={clearHoldTimer}
                onTouchStart={(e, id) => handleBubbleTouchStart(e, id)}
                onTouchMove={handleBubbleTouchMove}
                onTouchEnd={clearHoldTimer}
                onTouchCancel={clearHoldTimer}
                onOpenReactions={(messageId, anchorRect) => {
                  setActiveReactionTarget({
                    messageId,
                    anchorRect,
                  });
                }}
                onReply={(msg) => setReplyTo(msg)}
                onEdit={(msg) => {
                  setEditing(msg);
                  setText(msg.body);
                }}
                onDelete={(msg) => del(msg)}
                onToggleReaction={(messageId, emoji) => handleToggleReaction(messageId, emoji)}
                onOpenLightbox={setLightboxItem}
                photoText={t("photo")}
                videoText={t("video")}
                voiceText={t("voiceMessage")}
              />
            );
          })}
        </div>
      </div>

      <form
        onSubmit={send}
        className="border-t bg-card px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
      >
        <input
          ref={mediaInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm"
          onChange={onPickMedia}
          className="hidden"
        />

        {pendingMedia && (
          <div className="mb-2 flex items-center justify-between rounded-xl border bg-muted/60 p-2 text-xs">
            <div className="flex items-center gap-2">
              {pendingMedia.type === "image" ? (
                <img
                  src={pendingMedia.previewUrl}
                  alt="Preview"
                  className="size-12 rounded-lg object-cover"
                />
              ) : (
                <div className="relative size-12 overflow-hidden rounded-lg bg-black/40">
                  <video src={pendingMedia.previewUrl} className="size-full object-cover" />
                  <Film className="absolute bottom-1 end-1 size-3.5 text-white" />
                </div>
              )}
              <div className="min-w-0">
                <p className="font-medium text-foreground">
                  {pendingMedia.type === "image" ? t("photo") : t("video")}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {(pendingMedia.sizeBytes / (1024 * 1024)).toFixed(1)} MB
                  {pendingMedia.durationSeconds
                    ? ` • ${formatDuration(pendingMedia.durationSeconds)}`
                    : ""}
                </p>
                {uploadProgress !== null && (
                  <div className="mt-1 h-1.5 w-32 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full bg-primary transition-all duration-150"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPendingMedia(null)}
              disabled={uploadProgress !== null}
              className="rounded-full p-1 hover:bg-black/10 dark:hover:bg-white/10"
              aria-label="Cancel attachment"
            >
              <X className="size-4" />
            </button>
          </div>
        )}

        {(replyTo || editing) && (
          <div className="mb-2 flex items-center justify-between rounded-lg border-s-4 border-primary bg-muted px-3 py-1.5 text-xs">
            <span className="truncate">
              {editing ? "Editing message" : `Replying: ${replyTo!.body}`}
            </span>
            <button
              type="button"
              onClick={() => {
                setReplyTo(null);
                if (editing) {
                  setEditing(null);
                  setText("");
                }
              }}
              aria-label="Cancel"
            >
              <X className="size-4" />
            </button>
          </div>
        )}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="size-10 shrink-0 rounded-full touch-manipulation"
            onClick={() => mediaInputRef.current?.click()}
            aria-label={t("attachMedia")}
          >
            <Paperclip className="size-5 sm:size-4" />
          </Button>

          <Input
            className="h-10 rounded-full text-base md:text-sm"
            placeholder={pendingMedia ? "Add a caption..." : t("typeMessage")}
            value={text}
            maxLength={8000}
            onChange={(e) => onType(e.target.value)}
          />

          <VoiceRecorder
            onRecordingComplete={handleVoiceComplete}
            disabled={uploadProgress !== null}
          />

          <Button
            type="submit"
            size="icon"
            className="size-10 shrink-0 rounded-full touch-manipulation"
            aria-label="Send"
          >
            <Send className="size-5 sm:size-4 rtl:rotate-180" />
          </Button>
        </div>
      </form>

      <MediaLightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />

      {activeReactionTarget && (
        <ReactionFloatingBar
          anchorRect={activeReactionTarget.anchorRect}
          coords={activeReactionTarget.coords}
          myReaction={
            reactions.find(
              (r) => r.message_id === activeReactionTarget.messageId && r.user_id === me,
            )?.emoji
          }
          onSelectEmoji={(emoji) => handleToggleReaction(activeReactionTarget.messageId, emoji)}
          onClose={() => setActiveReactionTarget(null)}
        />
      )}
    </>
  );
}
