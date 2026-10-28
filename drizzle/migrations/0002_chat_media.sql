-- Migration 0002: Add Chat Media (Images, Videos, Voice Notes)
-- Safe, additive-only migration (IF NOT EXISTS). Does not drop or modify existing columns.

-- 1. Add media metadata columns to messages table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'message_type'
  ) THEN
    ALTER TABLE public.messages ADD COLUMN message_type text NOT NULL DEFAULT 'text';
    ALTER TABLE public.messages ADD CONSTRAINT messages_message_type_check 
      CHECK (message_type IN ('text', 'image', 'video', 'voice'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'media_path'
  ) THEN
    ALTER TABLE public.messages ADD COLUMN media_path text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'media_mime_type'
  ) THEN
    ALTER TABLE public.messages ADD COLUMN media_mime_type text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'media_size_bytes'
  ) THEN
    ALTER TABLE public.messages ADD COLUMN media_size_bytes bigint;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'media_duration_seconds'
  ) THEN
    ALTER TABLE public.messages ADD COLUMN media_duration_seconds numeric;
  END IF;
END $$;

-- 2. Configure private Storage bucket 'chat-media'
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-media',
  'chat-media',
  false,
  26214400, -- 25MB max per file
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/webm',
    'audio/webm',
    'audio/ogg',
    'audio/mp4',
    'audio/mpeg',
    'audio/wav',
    'audio/x-m4a'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 26214400,
  allowed_mime_types = ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/webm',
    'audio/webm',
    'audio/ogg',
    'audio/mp4',
    'audio/mpeg',
    'audio/wav',
    'audio/x-m4a'
  ];

-- 3. Storage RLS Policies for 'chat-media'
-- Expected storage path: {userId}/{conversationId}/{randomUUID}.{ext}
-- IDOR prevention: only members of conversation can read; only user can upload into their own userId folder and verified conversation

DO $$
BEGIN
  -- SELECT: Only conversation members can read media files
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'chat_media_read_by_conv_members'
  ) THEN
    CREATE POLICY "chat_media_read_by_conv_members"
    ON storage.objects FOR SELECT TO authenticated
    USING (
      bucket_id = 'chat-media'
      AND auth.uid() IS NOT NULL
      AND (storage.foldername(name))[2] IS NOT NULL
      AND public.is_member(((storage.foldername(name))[2])::uuid, auth.uid())
    );
  END IF;

  -- INSERT: User can only upload to their own userId folder, in a conversation they belong to
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'chat_media_upload_own_folder'
  ) THEN
    CREATE POLICY "chat_media_upload_own_folder"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'chat-media'
      AND auth.uid() IS NOT NULL
      AND (storage.foldername(name))[1] = auth.uid()::text
      AND (storage.foldername(name))[2] IS NOT NULL
      AND public.is_member(((storage.foldername(name))[2])::uuid, auth.uid())
    );
  END IF;

  -- UPDATE: User can only update their own files
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'chat_media_update_own_folder'
  ) THEN
    CREATE POLICY "chat_media_update_own_folder"
    ON storage.objects FOR UPDATE TO authenticated
    USING (
      bucket_id = 'chat-media'
      AND (storage.foldername(name))[1] = auth.uid()::text
    )
    WITH CHECK (
      bucket_id = 'chat-media'
      AND (storage.foldername(name))[1] = auth.uid()::text
    );
  END IF;

  -- DELETE: User can only delete their own files
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'chat_media_delete_own_folder'
  ) THEN
    CREATE POLICY "chat_media_delete_own_folder"
    ON storage.objects FOR DELETE TO authenticated
    USING (
      bucket_id = 'chat-media'
      AND (storage.foldername(name))[1] = auth.uid()::text
    );
  END IF;
END $$;

-- 4. Server-Side Abuse Protection & Rate Limiting Trigger
CREATE OR REPLACE FUNCTION public.check_media_rate_limits()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  recent_count integer;
  daily_bytes bigint;
BEGIN
  IF NEW.message_type <> 'text' THEN
    -- Maximum 20 media uploads per minute
    SELECT COUNT(*) INTO recent_count
    FROM public.messages
    WHERE sender_id = NEW.sender_id
      AND message_type <> 'text'
      AND created_at > now() - INTERVAL '1 minute';

    IF recent_count >= 20 THEN
      RAISE EXCEPTION 'Rate limit exceeded: maximum 20 media uploads per minute';
    END IF;

    -- Maximum 200MB upload per 24 hours
    SELECT COALESCE(SUM(media_size_bytes), 0) INTO daily_bytes
    FROM public.messages
    WHERE sender_id = NEW.sender_id
      AND created_at > now() - INTERVAL '24 hours';

    IF daily_bytes + COALESCE(NEW.media_size_bytes, 0) > 209715200 THEN
      RAISE EXCEPTION 'Daily storage quota exceeded (200MB limit per 24 hours)';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_media_rate_limit ON public.messages;
CREATE TRIGGER messages_media_rate_limit
  BEFORE INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.check_media_rate_limits();
