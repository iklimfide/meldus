-- İklim Fide Panel – Supabase: Tablolar + RLS
-- Bu dosyanın TAMAMINI Supabase SQL Editor'da çalıştırın (SUPABASE_SETUP.md değil).

-- 1. Tablo: fide_stok
create table if not exists public.fide_stok (
  id uuid primary key default gen_random_uuid(),
  cesit text not null,
  ekim_tarihi date,
  teslim_tarihi date,
  ekilen_miktar int default 0,
  cikan_fide int default 0,
  extra_fide int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists fide_stok_updated_at on public.fide_stok;
create trigger fide_stok_updated_at
  before update on public.fide_stok
  for each row execute function public.set_updated_at();

-- 2. Tablo: satislar
create table if not exists public.satislar (
  id uuid primary key default gen_random_uuid(),
  fide_id uuid not null references public.fide_stok(id) on delete restrict,
  musteri_adi text not null,
  miktar int not null check (miktar > 0),
  teslim_tarihi date,
  satis_tarihi timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists idx_satislar_fide_id on public.satislar(fide_id);
create index if not exists idx_satislar_satis_tarihi on public.satislar(satis_tarihi desc);

-- 3. Tablo: cop_kayitlari
create table if not exists public.cop_kayitlari (
  id uuid primary key default gen_random_uuid(),
  fide_id uuid not null references public.fide_stok(id) on delete restrict,
  miktar int not null check (miktar > 0),
  tarih timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists idx_cop_kayitlari_fide_id on public.cop_kayitlari(fide_id);
create index if not exists idx_cop_kayitlari_tarih on public.cop_kayitlari(tarih desc);

-- 4. RLS: fide_stok
alter table public.fide_stok enable row level security;

drop policy if exists "fide_stok_select" on public.fide_stok;
create policy "fide_stok_select" on public.fide_stok for select using (true);

drop policy if exists "fide_stok_insert" on public.fide_stok;
create policy "fide_stok_insert" on public.fide_stok for insert with check (true);

drop policy if exists "fide_stok_update" on public.fide_stok;
create policy "fide_stok_update" on public.fide_stok for update using (true) with check (true);

drop policy if exists "fide_stok_delete" on public.fide_stok;
create policy "fide_stok_delete" on public.fide_stok for delete using (true);

-- 5. RLS: satislar
alter table public.satislar enable row level security;

drop policy if exists "satislar_select" on public.satislar;
create policy "satislar_select" on public.satislar for select using (true);

drop policy if exists "satislar_insert" on public.satislar;
create policy "satislar_insert" on public.satislar for insert with check (true);

-- 6. RLS: cop_kayitlari
alter table public.cop_kayitlari enable row level security;

drop policy if exists "cop_kayitlari_select" on public.cop_kayitlari;
create policy "cop_kayitlari_select" on public.cop_kayitlari for select using (true);

drop policy if exists "cop_kayitlari_insert" on public.cop_kayitlari;
create policy "cop_kayitlari_insert" on public.cop_kayitlari for insert with check (true);

-- 7. (İsteğe bağlı) Eski kurulumda cikan_fide yoksa ekle
alter table public.fide_stok add column if not exists cikan_fide int default 0;

-- 8. (İsteğe bağlı) satislar tablosuna teslim_tarihi ekle
alter table public.satislar add column if not exists teslim_tarihi date;
