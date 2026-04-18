insert into storage.buckets (id, name, public)
values ('study-files', 'study-files', true)
on conflict (id) do nothing;

drop policy if exists "Public can read study files" on storage.objects;
create policy "Public can read study files"
on storage.objects
for select
to public
using (bucket_id = 'study-files');

drop policy if exists "Public can upload study files" on storage.objects;
create policy "Public can upload study files"
on storage.objects
for insert
to public
with check (bucket_id = 'study-files');

drop policy if exists "Public can update study files" on storage.objects;
create policy "Public can update study files"
on storage.objects
for update
to public
using (bucket_id = 'study-files')
with check (bucket_id = 'study-files');

drop policy if exists "Public can delete study files" on storage.objects;
create policy "Public can delete study files"
on storage.objects
for delete
to public
using (bucket_id = 'study-files');
