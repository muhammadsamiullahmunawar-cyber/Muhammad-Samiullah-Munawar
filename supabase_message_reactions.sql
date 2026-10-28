-- Run this in your Supabase SQL Editor to enable message reactions and contacts upsert hardening

-- 1. Ensure contacts table, constraints, and RLS policies
CREATE TABLE IF NOT EXISTS public.contacts (
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  saved_name text NOT NULL CHECK (char_length(saved_name) BETWEEN 1 AND 40),
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (owner_id, contact_user_id),
  CHECK (owner_id <> contact_user_id)
);

CREATE INDEX IF NOT EXISTS contacts_owner_id_idx ON public.contacts (owner_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
GRANT ALL ON public.contacts TO service_role;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'contacts' AND policyname = 'contacts_select_owner'
  ) THEN
    CREATE POLICY "contacts_select_owner" ON public.contacts
      FOR SELECT TO authenticated
      USING (owner_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'contacts' AND policyname = 'contacts_insert_owner'
  ) THEN
    CREATE POLICY "contacts_insert_owner" ON public.contacts
      FOR INSERT TO authenticated
      WITH CHECK (owner_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'contacts' AND policyname = 'contacts_update_owner'
  ) THEN
    CREATE POLICY "contacts_update_owner" ON public.contacts
      FOR UPDATE TO authenticated
      USING (owner_id = auth.uid())
      WITH CHECK (owner_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'contacts' AND policyname = 'contacts_delete_owner'
  ) THEN
    CREATE POLICY "contacts_delete_owner" ON public.contacts
      FOR DELETE TO authenticated
      USING (owner_id = auth.uid());
  END IF;
END $$;

-- 2. Create message_reactions table
CREATE TABLE IF NOT EXISTS public.message_reactions (
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK (emoji IN ('👍', '❤️', '😂', '😮', '😢', '🙏')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS message_reactions_message_id_idx ON public.message_reactions (message_id);
CREATE INDEX IF NOT EXISTS message_reactions_user_id_idx ON public.message_reactions (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_reactions TO authenticated;
GRANT ALL ON public.message_reactions TO service_role;

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- SELECT: members of the conversation can view reactions
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'message_reactions' AND policyname = 'reactions_select_members'
  ) THEN
    CREATE POLICY "reactions_select_members" ON public.message_reactions
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.messages m
          WHERE m.id = message_reactions.message_id
          AND public.is_member(m.conversation_id, auth.uid())
        )
      );
  END IF;

  -- INSERT: user can react if they are a member of the conversation
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'message_reactions' AND policyname = 'reactions_insert_own'
  ) THEN
    CREATE POLICY "reactions_insert_own" ON public.message_reactions
      FOR INSERT TO authenticated
      WITH CHECK (
        user_id = auth.uid()
        AND EXISTS (
          SELECT 1 FROM public.messages m
          WHERE m.id = message_reactions.message_id
          AND public.is_member(m.conversation_id, auth.uid())
        )
      );
  END IF;

  -- UPDATE: user can update their own reaction
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'message_reactions' AND policyname = 'reactions_update_own'
  ) THEN
    CREATE POLICY "reactions_update_own" ON public.message_reactions
      FOR UPDATE TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (
        user_id = auth.uid()
        AND EXISTS (
          SELECT 1 FROM public.messages m
          WHERE m.id = message_reactions.message_id
          AND public.is_member(m.conversation_id, auth.uid())
        )
      );
  END IF;

  -- DELETE: user can delete their own reaction
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'message_reactions' AND policyname = 'reactions_delete_own'
  ) THEN
    CREATE POLICY "reactions_delete_own" ON public.message_reactions
      FOR DELETE TO authenticated
      USING (user_id = auth.uid());
  END IF;
END $$;

-- 3. Enable Realtime Replication
ALTER TABLE public.message_reactions REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND schemaname = 'public' 
    AND tablename = 'message_reactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;
  END IF;
END $$;
