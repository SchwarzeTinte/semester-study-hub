-- Usage:
-- 1. Make sure the target user has already registered once in the app.
-- 2. Replace the username below with the account name you want to own the old data.
-- 3. Run this script in Supabase SQL Editor.

do $$
declare
  target_username text := 'replace_with_username';
  target_user_id uuid;
begin
  select id
  into target_user_id
  from auth.users
  where email = target_username || '@users.semester-study-hub.local'
  limit 1;

  if target_user_id is null then
    raise exception 'Target user "%" was not found. Register this username in the app first.', target_username;
  end if;

  update public.courses
  set user_id = target_user_id
  where user_id is null;

  update public.reviews
  set user_id = target_user_id
  where user_id is null;

  update public.course_files as course_files
  set user_id = courses.user_id
  from public.courses as courses
  where course_files.course_id = courses.id
    and course_files.user_id is distinct from courses.user_id;

  update public.review_files as review_files
  set user_id = reviews.user_id
  from public.reviews as reviews
  where review_files.review_id = reviews.id
    and review_files.user_id is distinct from reviews.user_id;

  raise notice 'Backfill finished. courses=% reviews=% course_files=% review_files=%',
    (select count(*) from public.courses where user_id = target_user_id),
    (select count(*) from public.reviews where user_id = target_user_id),
    (select count(*) from public.course_files where user_id = target_user_id),
    (select count(*) from public.review_files where user_id = target_user_id);
end $$;
