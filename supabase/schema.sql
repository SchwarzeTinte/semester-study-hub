create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade default auth.uid(),
  name text not null,
  teacher text not null default '',
  kind text not null default 'Vorlesung',
  weekdays text[] not null default '{}',
  time text not null default '',
  room text not null default '',
  quick_notes text not null default '',
  archived boolean not null default false,
  archive_marked boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.course_weekly_records (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  week_number integer not null,
  label text not null,
  lecture_done boolean not null default false,
  homework_done boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (course_id, week_number)
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade default auth.uid(),
  name text not null,
  subject text not null default '',
  source_course_id uuid references public.courses(id) on delete set null,
  weekdays text[] not null default '{}',
  time text not null default '',
  room text not null default '',
  notes text not null default '',
  archived boolean not null default false,
  archive_marked boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.review_weekly_records (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  week_number integer not null,
  label text not null,
  review_done boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (review_id, week_number)
);

create table if not exists public.course_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade default auth.uid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  name text not null,
  mime text not null default '',
  size bigint not null default 0,
  category text not null,
  storage_path text not null unique,
  uploaded_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.review_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade default auth.uid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  source_file_id uuid references public.course_files(id) on delete set null,
  name text not null,
  mime text not null default '',
  size bigint not null default 0,
  category text not null,
  storage_path text not null unique,
  reviewed boolean not null default false,
  uploaded_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.courses add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.courses alter column user_id set default auth.uid();

alter table public.reviews add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.reviews alter column user_id set default auth.uid();

alter table public.course_files add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.course_files alter column user_id set default auth.uid();

alter table public.review_files add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.review_files alter column user_id set default auth.uid();

create index if not exists courses_user_id_idx on public.courses (user_id);
create index if not exists courses_archived_idx on public.courses (archived);
create index if not exists reviews_user_id_idx on public.reviews (user_id);
create index if not exists reviews_archived_idx on public.reviews (archived);
create index if not exists course_files_user_id_idx on public.course_files (user_id);
create index if not exists course_files_course_id_idx on public.course_files (course_id);
create index if not exists review_files_user_id_idx on public.review_files (user_id);
create index if not exists review_files_review_id_idx on public.review_files (review_id);
create index if not exists reviews_source_course_id_idx on public.reviews (source_course_id);

drop trigger if exists courses_set_updated_at on public.courses;
create trigger courses_set_updated_at
before update on public.courses
for each row
execute function public.set_updated_at();

drop trigger if exists course_weekly_records_set_updated_at on public.course_weekly_records;
create trigger course_weekly_records_set_updated_at
before update on public.course_weekly_records
for each row
execute function public.set_updated_at();

drop trigger if exists reviews_set_updated_at on public.reviews;
create trigger reviews_set_updated_at
before update on public.reviews
for each row
execute function public.set_updated_at();

drop trigger if exists review_weekly_records_set_updated_at on public.review_weekly_records;
create trigger review_weekly_records_set_updated_at
before update on public.review_weekly_records
for each row
execute function public.set_updated_at();

drop trigger if exists course_files_set_updated_at on public.course_files;
create trigger course_files_set_updated_at
before update on public.course_files
for each row
execute function public.set_updated_at();

drop trigger if exists review_files_set_updated_at on public.review_files;
create trigger review_files_set_updated_at
before update on public.review_files
for each row
execute function public.set_updated_at();

alter table public.courses enable row level security;
alter table public.course_weekly_records enable row level security;
alter table public.reviews enable row level security;
alter table public.review_weekly_records enable row level security;
alter table public.course_files enable row level security;
alter table public.review_files enable row level security;

drop policy if exists "Users can view own courses" on public.courses;
create policy "Users can view own courses"
on public.courses
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own courses" on public.courses;
create policy "Users can insert own courses"
on public.courses
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own courses" on public.courses;
create policy "Users can update own courses"
on public.courses
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own courses" on public.courses;
create policy "Users can delete own courses"
on public.courses
for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can view own course weekly records" on public.course_weekly_records;
create policy "Users can view own course weekly records"
on public.course_weekly_records
for select
to authenticated
using (
  exists (
    select 1
    from public.courses
    where courses.id = course_weekly_records.course_id
      and courses.user_id = auth.uid()
  )
);

drop policy if exists "Users can insert own course weekly records" on public.course_weekly_records;
create policy "Users can insert own course weekly records"
on public.course_weekly_records
for insert
to authenticated
with check (
  exists (
    select 1
    from public.courses
    where courses.id = course_weekly_records.course_id
      and courses.user_id = auth.uid()
  )
);

drop policy if exists "Users can update own course weekly records" on public.course_weekly_records;
create policy "Users can update own course weekly records"
on public.course_weekly_records
for update
to authenticated
using (
  exists (
    select 1
    from public.courses
    where courses.id = course_weekly_records.course_id
      and courses.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.courses
    where courses.id = course_weekly_records.course_id
      and courses.user_id = auth.uid()
  )
);

drop policy if exists "Users can delete own course weekly records" on public.course_weekly_records;
create policy "Users can delete own course weekly records"
on public.course_weekly_records
for delete
to authenticated
using (
  exists (
    select 1
    from public.courses
    where courses.id = course_weekly_records.course_id
      and courses.user_id = auth.uid()
  )
);

drop policy if exists "Users can view own reviews" on public.reviews;
create policy "Users can view own reviews"
on public.reviews
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own reviews" on public.reviews;
create policy "Users can insert own reviews"
on public.reviews
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own reviews" on public.reviews;
create policy "Users can update own reviews"
on public.reviews
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own reviews" on public.reviews;
create policy "Users can delete own reviews"
on public.reviews
for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can view own review weekly records" on public.review_weekly_records;
create policy "Users can view own review weekly records"
on public.review_weekly_records
for select
to authenticated
using (
  exists (
    select 1
    from public.reviews
    where reviews.id = review_weekly_records.review_id
      and reviews.user_id = auth.uid()
  )
);

drop policy if exists "Users can insert own review weekly records" on public.review_weekly_records;
create policy "Users can insert own review weekly records"
on public.review_weekly_records
for insert
to authenticated
with check (
  exists (
    select 1
    from public.reviews
    where reviews.id = review_weekly_records.review_id
      and reviews.user_id = auth.uid()
  )
);

drop policy if exists "Users can update own review weekly records" on public.review_weekly_records;
create policy "Users can update own review weekly records"
on public.review_weekly_records
for update
to authenticated
using (
  exists (
    select 1
    from public.reviews
    where reviews.id = review_weekly_records.review_id
      and reviews.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.reviews
    where reviews.id = review_weekly_records.review_id
      and reviews.user_id = auth.uid()
  )
);

drop policy if exists "Users can delete own review weekly records" on public.review_weekly_records;
create policy "Users can delete own review weekly records"
on public.review_weekly_records
for delete
to authenticated
using (
  exists (
    select 1
    from public.reviews
    where reviews.id = review_weekly_records.review_id
      and reviews.user_id = auth.uid()
  )
);

drop policy if exists "Users can view own course files" on public.course_files;
create policy "Users can view own course files"
on public.course_files
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own course files" on public.course_files;
create policy "Users can insert own course files"
on public.course_files
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own course files" on public.course_files;
create policy "Users can update own course files"
on public.course_files
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own course files" on public.course_files;
create policy "Users can delete own course files"
on public.course_files
for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can view own review files" on public.review_files;
create policy "Users can view own review files"
on public.review_files
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own review files" on public.review_files;
create policy "Users can insert own review files"
on public.review_files
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own review files" on public.review_files;
create policy "Users can update own review files"
on public.review_files
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own review files" on public.review_files;
create policy "Users can delete own review files"
on public.review_files
for delete
to authenticated
using (auth.uid() = user_id);
