-- Meldus: Son işlemler log tablosu
-- Supabase SQL Editor'da bir kez çalıştırın.

create table if not exists public.meldus_islem_log (
  id uuid primary key default gen_random_uuid(),
  kullanici text not null,
  islem text not null,
  detay text,
  created_at timestamptz default now()
);

create index if not exists idx_meldus_islem_log_created on public.meldus_islem_log(created_at desc);

alter table public.meldus_islem_log enable row level security;

drop policy if exists "meldus_islem_log_select" on public.meldus_islem_log;
create policy "meldus_islem_log_select" on public.meldus_islem_log for select using (true);

drop policy if exists "meldus_islem_log_insert" on public.meldus_islem_log;
create policy "meldus_islem_log_insert" on public.meldus_islem_log for insert with check (true);
