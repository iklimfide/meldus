-- Aktarım geri alma için delete politikası (tablo zaten varsa bir kez çalıştırın)

drop policy if exists "extra_aktar_hareketleri_delete" on public.extra_aktar_hareketleri;
create policy "extra_aktar_hareketleri_delete"
  on public.extra_aktar_hareketleri for delete using (true);
