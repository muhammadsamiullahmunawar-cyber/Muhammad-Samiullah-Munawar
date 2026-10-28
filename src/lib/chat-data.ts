import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type Profile = Tables<"profiles">;
export type Message = Tables<"messages">;
export type ConversationRow = Tables<"conversations">;

export type ChatSummary = ConversationRow & {
  members: Profile[];
  myLastRead: string;
  last: Message | undefined;
  unread: number;
  name: string;
};

export async function fetchChats(me: string): Promise<ChatSummary[]> {
  const { data: convs, error } = await supabase
    .from("conversations")
    .select("*")
    .order("last_message_at", { ascending: false });
  if (error) throw error;
  if (!convs.length) return [];
  const ids = convs.map((c) => c.id);
  const [{ data: members }, { data: msgs }, { data: contacts }] = await Promise.all([
    supabase.from("conversation_members").select("*").in("conversation_id", ids),
    supabase
      .from("messages")
      .select("*")
      .in("conversation_id", ids)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.from("contacts").select("contact_user_id, saved_name"),
  ]);
  const userIds = [...new Set((members ?? []).map((m) => m.user_id))];
  const { data: profiles } = await supabase.from("profiles").select("*").in("id", userIds);
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
  const contactsMap = new Map((contacts ?? []).map((c) => [c.contact_user_id, c.saved_name]));

  return convs.map((c) => {
    const mem = (members ?? []).filter((m) => m.conversation_id === c.id);
    const myLastRead = mem.find((m) => m.user_id === me)?.last_read_at ?? c.created_at;
    const cm = (msgs ?? []).filter((m) => m.conversation_id === c.id);
    const profs = mem.map((m) => byId.get(m.user_id)).filter(Boolean) as Profile[];
    const other = profs.find((p) => p.id !== me);
    const savedName = other ? contactsMap.get(other.id) : undefined;
    return {
      ...c,
      members: profs,
      myLastRead,
      last: cm[0],
      unread: cm.filter((m) => m.sender_id !== me && m.created_at > myLastRead).length,
      name:
        c.type === "group"
          ? (c.title ?? "Group")
          : savedName || other?.display_name || other?.username || "Chat",
    };
  });
}

export function resolveContactName(
  user?: { id?: string; display_name?: string | null; username?: string | null } | null,
  contactsMap?: Map<string, string> | Record<string, string>,
): string {
  if (!user) return "Someone";
  let saved: string | undefined;
  if (contactsMap && user.id) {
    saved = contactsMap instanceof Map ? contactsMap.get(user.id) : contactsMap[user.id];
  }
  return saved?.trim() || user.display_name?.trim() || user.username?.trim() || "Someone";
}

export async function fetchContacts(): Promise<Record<string, string>> {
  const { data, error } = await supabase.from("contacts").select("contact_user_id, saved_name");
  if (error || !data) return {};
  return Object.fromEntries(data.map((c) => [c.contact_user_id, c.saved_name]));
}

export async function saveContact(contactUserId: string, savedName: string) {
  const trimmed = savedName.trim();
  if (!trimmed || trimmed.length > 40) throw new Error("Name must be 1 to 40 characters");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase.from("contacts").upsert(
    {
      owner_id: user.id,
      contact_user_id: contactUserId,
      saved_name: trimmed,
    },
    { onConflict: "owner_id,contact_user_id" },
  );
  if (error) {
    console.error("Failed to update contact in database:", error);
    throw error;
  }
}

export async function deleteContact(contactUserId: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let query = supabase.from("contacts").delete().eq("contact_user_id", contactUserId);
  if (user) {
    query = query.eq("owner_id", user.id);
  }
  const { error } = await query;
  if (error) {
    console.error("Failed to delete contact in database:", error);
    throw error;
  }
}

export const PAGE = 40;

export async function fetchMessages(convId: string, before?: string) {
  let q = supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", convId)
    .order("created_at", { ascending: false })
    .limit(PAGE);
  if (before) q = q.lt("created_at", before);
  const { data, error } = await q;
  if (error) throw error;
  return data.reverse();
}

export function initials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

export function timeLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString();
}

export const EDIT_WINDOW_MS = 15 * 60 * 1000;
export function canEdit(m: Message, me: string, now = Date.now()) {
  return (
    m.sender_id === me && !m.deleted_at && now - new Date(m.created_at).getTime() < EDIT_WINDOW_MS
  );
}
