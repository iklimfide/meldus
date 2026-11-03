-- Meldus: panel kullanıcıları
-- Supabase SQL Editor'da bir kez çalıştırın.

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  password text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint users_username_key unique (username),
  constraint users_username_len check (char_length(username) >= 2)
);

create index if not exists idx_users_username on public.users (username);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists users_updated_at on public.users;
create trigger users_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

alter table public.users enable row level security;

drop policy if exists "users_select" on public.users;
create policy "users_select" on public.users for select using (true);

drop policy if exists "users_insert" on public.users;
create policy "users_insert" on public.users for insert with check (true);

drop policy if exists "users_update" on public.users;
create policy "users_update" on public.users for update using (true) with check (true);

drop policy if exists "users_delete" on public.users;
create policy "users_delete" on public.users for delete using (true);
