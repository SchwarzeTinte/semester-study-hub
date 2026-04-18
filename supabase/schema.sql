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

create index if not exists courses_archived_idx on public.courses (archived);
create index if not exists reviews_archived_idx on public.reviews (archived);
create index if not exists course_files_course_id_idx on public.course_files (course_id);
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

comment on table public.courses is '本学期课程主表';
comment on table public.course_weekly_records is '课程每周状态';
comment on table public.reviews is '复习条目主表';
comment on table public.review_weekly_records is '复习每周状态，当前主要保留兼容';
comment on table public.course_files is '课程文件元数据，实际文件放在 Storage';
comment on table public.review_files is '复习文件元数据，实际文件放在 Storage';
