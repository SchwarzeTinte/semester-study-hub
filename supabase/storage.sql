insert into storage.buckets (id, name, public)
values ('study-files', 'study-files', false)
on conflict (id) do update
set public = excluded.public;

drop policy if exists "Users can read own study files" on storage.objects;
create policy "Users can read own study files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'study-files'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1
      from public.course_files
      where course_files.storage_path = name
        and course_files.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.review_files
      where review_files.storage_path = name
        and review_files.user_id = auth.uid()
    )
  )
);

drop policy if exists "Users can upload own study files" on storage.objects;
create policy "Users can upload own study files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'study-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can update own study files" on storage.objects;
create policy "Users can update own study files"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'study-files'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1
      from public.course_files
      where course_files.storage_path = name
        and course_files.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.review_files
      where review_files.storage_path = name
        and review_files.user_id = auth.uid()
    )
  )
)
with check (
  bucket_id = 'study-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can delete own study files" on storage.objects;
create policy "Users can delete own study files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'study-files'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1
      from public.course_files
      where course_files.storage_path = name
        and course_files.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.review_files
      where review_files.storage_path = name
        and review_files.user_id = auth.uid()
    )
  )
);
