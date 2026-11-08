-- Run this once in Supabase Dashboard > SQL Editor > New query.
-- Safe to re-run: an existing table is preserved, grants are reset, and the
-- named insert policy is replaced. Review an existing table's columns first.

begin;

create table if not exists public.contact_submissions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  project text not null,
  email_notification_status text not null default 'pending',
  constraint contact_submissions_email_notification_status
    check (email_notification_status in ('pending', 'sending', 'sent')),
  created_at timestamptz not null default now(),
  constraint contact_submissions_name_length
    check (char_length(btrim(name)) between 1 and 120),
  constraint contact_submissions_email_format
    check (
      char_length(btrim(email)) between 3 and 254
      and btrim(email) ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    ),
  constraint contact_submissions_project_length
    check (char_length(btrim(project)) between 1 and 5000)
);

alter table public.contact_submissions enable row level security;

-- Remove broad table privileges, then permit only the columns submitted by
-- the existing public contact form. There are no public read/update/delete grants.
revoke all privileges on table public.contact_submissions from public, anon, authenticated;
grant usage on schema public to anon;
grant insert (id, name, email, project)
  on table public.contact_submissions
  to anon;

drop policy if exists "Allow anonymous contact submissions"
  on public.contact_submissions;

create policy "Allow anonymous contact submissions"
  on public.contact_submissions
  for insert
  to anon
  with check (true);

commit;
