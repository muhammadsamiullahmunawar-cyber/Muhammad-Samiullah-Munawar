create type public.app_role as enum ('admin','user');
create type public.conversation_type as enum ('direct','group');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null default '',
  about text not null default '',
  avatar_url text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
grant select, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create policy "own roles readable" on public.user_roles for select to authenticated using (user_id = auth.uid());

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  type public.conversation_type not null default 'direct',
  title text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
grant select, insert, update on public.conversations to authenticated;
grant all on public.conversations to service_role;
alter table public.conversations enable row level security;

create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index on public.conversation_members(user_id);
grant select, update on public.conversation_members to authenticated;
grant all on public.conversation_members to service_role;
alter table public.conversation_members enable row level security;

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null default auth.uid(),
  body text not null check (char_length(body) between 1 and 8000),
  reply_to_id uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);
create index on public.messages(conversation_id, created_at desc);
grant select, insert, update on public.messages to authenticated;
grant all on public.messages to service_role;
alter table public.messages enable row level security;

create or replace function public.is_member(_conv uuid, _user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversation_members where conversation_id = _conv and user_id = _user)
$$;

create or replace function public.shares_conversation(_a uuid, _b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversation_members m1 join public.conversation_members m2
    on m1.conversation_id = m2.conversation_id where m1.user_id = _a and m2.user_id = _b)
$$;

create policy "profiles self or contacts" on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_conversation(auth.uid(), id));
create policy "profiles update self" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "conv members read" on public.conversations for select to authenticated
  using (public.is_member(id, auth.uid()));

create policy "members read" on public.conversation_members for select to authenticated
  using (public.is_member(conversation_id, auth.uid()));
create policy "members update own read marker" on public.conversation_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "messages read" on public.messages for select to authenticated
  using (public.is_member(conversation_id, auth.uid()));
create policy "messages send" on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_member(conversation_id, auth.uid()));
create policy "messages edit own" on public.messages for update to authenticated
  using (sender_id = auth.uid()) with check (sender_id = auth.uid());

-- only allow editing body within 15 minutes, or soft-delete
create or replace function public.guard_message_update()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.conversation_id <> old.conversation_id or new.sender_id <> old.sender_id or new.created_at <> old.created_at then
    raise exception 'immutable fields';
  end if;
  if new.body <> old.body then
    if old.deleted_at is not null or now() - old.created_at > interval '15 minutes' then
      raise exception 'edit window expired';
    end if;
    new.edited_at := now();
  end if;
  if new.deleted_at is not null and old.deleted_at is null then
    new.body := '·';
  end if;
  return new;
end $$;
create trigger messages_guard before update on public.messages for each row execute function public.guard_message_update();

create or replace function public.bump_conversation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  return new;
end $$;
create trigger messages_bump after insert on public.messages for each row execute function public.bump_conversation();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare uname text;
begin
  uname := lower(coalesce(new.raw_user_meta_data->>'username', ''));
  if uname !~ '^[a-z0-9_]{3,24}$' then
    uname := 'user_' || substr(replace(new.id::text,'-',''),1,10);
  end if;
  insert into public.profiles (id, username, display_name)
  values (new.id, uname, coalesce(new.raw_user_meta_data->>'display_name', uname));
  insert into public.user_roles (user_id, role) values (new.id, 'user');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.username_available(_username text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where username = lower(_username))
$$;
grant execute on function public.username_available(text) to anon, authenticated;

-- exact-match lookup + open direct chat
create or replace function public.start_direct_chat(_username text)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); other uuid; conv uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select id into other from public.profiles where username = lower(trim(_username));
  if other is null then raise exception 'No user with that exact username'; end if;
  if other = me then raise exception 'You cannot chat with yourself'; end if;
  select c.id into conv from public.conversations c
    join public.conversation_members a on a.conversation_id = c.id and a.user_id = me
    join public.conversation_members b on b.conversation_id = c.id and b.user_id = other
    where c.type = 'direct' limit 1;
  if conv is not null then return conv; end if;
  insert into public.conversations (type, created_by) values ('direct', me) returning id into conv;
  insert into public.conversation_members (conversation_id, user_id) values (conv, me), (conv, other);
  return conv;
end $$;
revoke execute on function public.start_direct_chat(text) from anon, public;
grant execute on function public.start_direct_chat(text) to authenticated;

create or replace function public.create_group(_title text, _usernames text[])
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); conv uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if char_length(trim(_title)) not between 1 and 60 then raise exception 'Invalid group name'; end if;
  if coalesce(array_length(_usernames,1),0) > 99 then raise exception 'Max 100 members'; end if;
  insert into public.conversations (type, title, created_by) values ('group', trim(_title), me) returning id into conv;
  insert into public.conversation_members (conversation_id, user_id, role) values (conv, me, 'admin');
  insert into public.conversation_members (conversation_id, user_id)
    select conv, p.id from public.profiles p where p.username = any(select lower(trim(u)) from unnest(_usernames) u) and p.id <> me
    on conflict do nothing;
  return conv;
end $$;
revoke execute on function public.create_group(text, text[]) from anon, public;
grant execute on function public.create_group(text, text[]) to authenticated;

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversations;