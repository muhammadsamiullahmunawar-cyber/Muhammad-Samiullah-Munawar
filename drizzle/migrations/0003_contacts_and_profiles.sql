-- Migration 0003: Contacts, Profile constraints, and exact Username Search RPC
-- Safe, additive-only, idempotent migration.

-- 1. Ensure profiles display_name and username constraints
DO $$
BEGIN
  -- Add display_name if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'display_name'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN display_name text NOT NULL DEFAULT '';
  END IF;

  -- Add check constraint for display_name length if not already present
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'profiles_display_name_len_check'
  ) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_display_name_len_check 
      CHECK (char_length(display_name) <= 40);
  END IF;

  -- Add check constraint for username length (3 to 24 characters, lowercase alphanumeric and underscore)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'profiles_username_format_check'
  ) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_username_format_check 
      CHECK (username ~ '^[a-z0-9_]{3,24}$');
  END IF;
END $$;

-- Case-insensitive unique index on lower(username)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_lower_username_idx ON public.profiles (lower(username));

-- 2. Create contacts table
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

-- 3. RLS Policies on contacts (Default Deny, explicit owner-only)
DO $$
BEGIN
  -- SELECT: Only the owner can view their private contacts
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'contacts' AND policyname = 'contacts_select_owner'
  ) THEN
    CREATE POLICY "contacts_select_owner" ON public.contacts
      FOR SELECT TO authenticated
      USING (owner_id = auth.uid());
  END IF;

  -- INSERT: Only owner can insert, ensuring target contact exists in profiles
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'contacts' AND policyname = 'contacts_insert_owner'
  ) THEN
    CREATE POLICY "contacts_insert_owner" ON public.contacts
      FOR INSERT TO authenticated
      WITH CHECK (
        owner_id = auth.uid()
        AND EXISTS (SELECT 1 FROM public.profiles WHERE id = contact_user_id)
      );
  END IF;

  -- UPDATE: Only owner can update saved_name
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'contacts' AND policyname = 'contacts_update_owner'
  ) THEN
    CREATE POLICY "contacts_update_owner" ON public.contacts
      FOR UPDATE TO authenticated
      USING (owner_id = auth.uid())
      WITH CHECK (owner_id = auth.uid());
  END IF;

  -- DELETE: Only owner can delete their contact
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'contacts' AND policyname = 'contacts_delete_owner'
  ) THEN
    CREATE POLICY "contacts_delete_owner" ON public.contacts
      FOR DELETE TO authenticated
      USING (owner_id = auth.uid());
  END IF;
END $$;

-- 4. Rate-limiting table for username searches (max 20 searches/min)
CREATE TABLE IF NOT EXISTS public.search_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  searched_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS search_rate_limits_user_idx ON public.search_rate_limits (user_id, searched_at DESC);
ALTER TABLE public.search_rate_limits ENABLE ROW LEVEL SECURITY;

-- Clean up old rate limit records older than 1 hour automatically
CREATE OR REPLACE FUNCTION public.clean_old_search_logs()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.search_rate_limits WHERE searched_at < now() - interval '1 hour';
$$;

-- 5. Exact match username lookup function with server-side rate limit
CREATE OR REPLACE FUNCTION public.find_user_by_username(p_username text)
RETURNS TABLE (
  id uuid,
  username text,
  display_name text,
  about text,
  avatar_url text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_recent_searches integer;
  v_clean_username text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_clean_username := lower(trim(p_username));
  IF v_clean_username IS NULL OR char_length(v_clean_username) < 3 THEN
    RETURN;
  END IF;

  -- Rate limit check: at most 20 searches per minute per user
  SELECT COUNT(*) INTO v_recent_searches
  FROM public.search_rate_limits
  WHERE user_id = v_user_id AND searched_at > now() - INTERVAL '1 minute';

  IF v_recent_searches >= 20 THEN
    RAISE EXCEPTION 'Search rate limit exceeded. Please wait a moment before searching again.';
  END IF;

  -- Record this search attempt
  INSERT INTO public.search_rate_limits (user_id) VALUES (v_user_id);

  -- Return only public profile info for exact match; never returns email or auth data
  RETURN QUERY
  SELECT p.id, p.username, p.display_name, p.about, p.avatar_url
  FROM public.profiles p
  WHERE lower(p.username) = v_clean_username
  LIMIT 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.find_user_by_username(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.find_user_by_username(text) TO authenticated;
