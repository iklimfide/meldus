# İklim Fide Panel – Supabase Kurulum Rehberi

Bu dosya açıklama içindir. **SQL çalıştırmak için `supabase_schema.sql` dosyasını kullanın.**

Supabase Dashboard → **SQL Editor** → New query → `supabase_schema.sql` dosyasının **içeriğini yapıştırın** (bu .md dosyasını değil) → Run.

---

## 1. Tablolar

`supabase_schema.sql` içinde tanımlı; tek seferde çalıştırılabilir.

### 1.1 `fide_stok`

```sql
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

-- Güncellenme zamanı trigger (isteğe bağlı)
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger fide_stok_updated_at
  before update on public.fide_stok
  for each row execute function public.set_updated_at();
```

### 1.2 `satislar`

```sql
create table if not exists public.satislar (
  id uuid primary key default gen_random_uuid(),
  fide_id uuid not null references public.fide_stok(id) on delete restrict,
  musteri_adi text not null,
  miktar int not null check (miktar > 0),
  satis_tarihi timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists idx_satislar_fide_id on public.satislar(fide_id);
create index if not exists idx_satislar_satis_tarihi on public.satislar(satis_tarihi desc);
```

### 1.3 `cop_kayitlari`

```sql
create table if not exists public.cop_kayitlari (
  id uuid primary key default gen_random_uuid(),
  fide_id uuid not null references public.fide_stok(id) on delete restrict,
  miktar int not null check (miktar > 0),
  tarih timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists idx_cop_kayitlari_fide_id on public.cop_kayitlari(fide_id);
create index if not exists idx_cop_kayitlari_tarih on public.cop_kayitlari(tarih desc);
```

### 1.4 `extra_aktar_hareketleri` (sonrakine / öncekine aktarım kaydı)

Meldus “Hareketler” modalında sonrakine/öncekine aktarım toplamlarını göstermek için. **Mevcut projede bu tablo yoksa** aşağıdaki SQL’i Supabase SQL Editor’da bir kez çalıştırın.

```sql
create table if not exists public.extra_aktar_hareketleri (
  id uuid primary key default gen_random_uuid(),
  kaynak_fide_id uuid not null references public.fide_stok(id) on delete restrict,
  hedef_fide_id uuid not null references public.fide_stok(id) on delete restrict,
  miktar int not null check (miktar > 0),
  tip text not null check (tip in ('sonrakine', 'oncekine')),
  created_at timestamptz default now()
);

create index if not exists idx_extra_aktar_kaynak on public.extra_aktar_hareketleri(kaynak_fide_id);
create index if not exists idx_extra_aktar_hedef on public.extra_aktar_hareketleri(hedef_fide_id);

alter table public.extra_aktar_hareketleri enable row level security;

create policy "extra_aktar_hareketleri_select"
  on public.extra_aktar_hareketleri for select using (true);

create policy "extra_aktar_hareketleri_insert"
  on public.extra_aktar_hareketleri for insert with check (true);

create policy "extra_aktar_hareketleri_delete"
  on public.extra_aktar_hareketleri for delete using (true);
```

**Not:** Bu tabloyu eklemeden önce yapılmış sonrakine/öncekine aktarımlar kayıtlı olmadığı için geçmişte görünmez; tablo sonrası yapılanlar listelenir.

Aktarım **geri alma** için `extra_aktar_hareketleri_delete` politikası gerekir. Tablo zaten varsa sadece şunu çalıştırın:

```sql
create policy "extra_aktar_hareketleri_delete"
  on public.extra_aktar_hareketleri for delete using (true);
```

### 1.5 Soft delete (`fide_stok.deleted_at`)

Stok **Sil** / **Seçilenleri sil** satırı hard delete etmez; `deleted_at` yazar. Panelde **Silinenler → Geri al** ile geri gelir. Mevcut DB için bir kez: `meldus/sql/fide_stok_soft_delete.sql`.

```sql
alter table public.fide_stok add column if not exists deleted_at timestamptz;
create index if not exists idx_fide_stok_deleted_at
  on public.fide_stok (deleted_at)
  where deleted_at is not null;
```

### 1.6 `meldus_islem_log` (Son işlemler)

Kim ne yaptı kaydı için. **Mevcut projede yoksa** SQL Editor’da bir kez çalıştırın (`meldus/sql/meldus_islem_log.sql`).

```sql
create table if not exists public.meldus_islem_log (
  id uuid primary key default gen_random_uuid(),
  kullanici text not null,
  islem text not null,
  detay text,
  created_at timestamptz default now()
);

create index if not exists idx_meldus_islem_log_created on public.meldus_islem_log(created_at desc);

alter table public.meldus_islem_log enable row level security;

create policy "meldus_islem_log_select"
  on public.meldus_islem_log for select using (true);

create policy "meldus_islem_log_insert"
  on public.meldus_islem_log for insert with check (true);
```

---

## 2. RLS (Row Level Security) – Zorunlu

Tablolara erişim için RLS açıp politikaları ekleyin. **Anon key** ile giriş yapıyorsanız, aşağıdaki politikalar “anon” rolüne okuma/yazma verir. Sadece yetkili kullanıcılara açmak isterseniz `auth.role() = 'authenticated'` veya kendi rolünüzü kullanın.

### 2.1 `fide_stok`

```sql
alter table public.fide_stok enable row level security;

-- Okuma: herkese (anon/authenticated)
create policy "fide_stok_select"
  on public.fide_stok for select
  using (true);

-- Ekleme
create policy "fide_stok_insert"
  on public.fide_stok for insert
  with check (true);

-- Güncelleme (inline düzenleme + extra_fide düşme)
create policy "fide_stok_update"
  on public.fide_stok for update
  using (true)
  with check (true);

-- Silme (isterseniz kapatabilirsiniz)
create policy "fide_stok_delete"
  on public.fide_stok for delete
  using (true);
```

### 2.2 `satislar`

```sql
alter table public.satislar enable row level security;

create policy "satislar_select"
  on public.satislar for select
  using (true);

create policy "satislar_insert"
  on public.satislar for insert
  with check (true);
```

### 2.3 `cop_kayitlari`

```sql
alter table public.cop_kayitlari enable row level security;

create policy "cop_kayitlari_select"
  on public.cop_kayitlari for select
  using (true);

create policy "cop_kayitlari_insert"
  on public.cop_kayitlari for insert
  with check (true);
```

---

## 3. Panel tarafında config

- `panel/config.example.js` dosyasını `panel/config.js` olarak kopyalayın.
- Supabase Dashboard → Project Settings → API içinden **Project URL** ve **anon public** key’i alıp `config.js` içinde `SUPABASE_URL` ve `SUPABASE_ANON_KEY` olarak yazın.
- `config.js` dosyasını Git’e eklemeyin (proje `.gitignore` içinde tanımlı).
- API anahtarlarını koda açık yazmayın.
- Hata alırsanız Supabase Dashboard → Table Editor → ilgili tablo → “RLS disabled” olup olmadığını kontrol edin; politikaların `true` ile tanımlı olduğundan emin olun.
- “Permission denied for table …” görürseniz ilgili tablo için `SELECT`/`INSERT`/`UPDATE` politikası eksik veya yanlış demektir; yukarıdaki SQL’i tekrar uygulayın.

Bu yapı panelin güvenli ve tutarlı çalışması için yeterlidir.
