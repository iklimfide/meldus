-- Alacak PDF deposu
-- Supabase SQL Editor'da bir kez çalıştırın.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('alacak', 'alacak', false, 20971520, array['application/pdf']::text[])
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "alacak_select" on storage.objects;
create policy "alacak_select" on storage.objects
  for select using (bucket_id = 'alacak');

drop policy if exists "alacak_insert" on storage.objects;
create policy "alacak_insert" on storage.objects
  for insert with check (bucket_id = 'alacak');

drop policy if exists "alacak_update" on storage.objects;
create policy "alacak_update" on storage.objects
  for update using (bucket_id = 'alacak') with check (bucket_id = 'alacak');

drop policy if exists "alacak_delete" on storage.objects;
create policy "alacak_delete" on storage.objects
  for delete using (bucket_id = 'alacak');
