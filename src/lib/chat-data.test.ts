import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { canEdit, type Message } from "./chat-data";

const base = {
  id: "1",
  conversation_id: "c",
  sender_id: "me",
  body: "hi",
  reply_to_id: null,
  edited_at: null,
  deleted_at: null,
} as Omit<Message, "created_at">;

describe("edit window", () => {
  const now = Date.parse("2026-01-01T12:00:00Z");
  it("allows editing own message within 15 minutes", () => {
    expect(canEdit({ ...base, created_at: "2026-01-01T11:50:00Z" }, "me", now)).toBe(true);
  });
  it("blocks editing after 15 minutes", () => {
    expect(canEdit({ ...base, created_at: "2026-01-01T11:44:00Z" }, "me", now)).toBe(false);
  });
  it("blocks editing someone else's message", () => {
    expect(canEdit({ ...base, created_at: "2026-01-01T11:59:00Z" }, "other", now)).toBe(false);
  });
});
