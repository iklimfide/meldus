-- Stok kaydı Değiştir modalı: adres alanı
-- Supabase SQL Editor'da bir kez çalıştırın.

alter table public.fide_stok
  add column if not exists adres text;
