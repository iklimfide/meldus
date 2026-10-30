-- Stok soft delete: Sil / Seçilenleri sil artık satırı silmez;
-- deleted_at set eder. Panelde «Silinenler» → Geri al ile geri gelir.
-- Supabase SQL Editor'da bir kez çalıştırın.

alter table public.fide_stok
  add column if not exists deleted_at timestamptz;

create index if not exists idx_fide_stok_deleted_at
  on public.fide_stok (deleted_at)
  where deleted_at is not null;
