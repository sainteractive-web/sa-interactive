-- Add server-only notification state to the existing contact form table.
-- Public visitors retain INSERT-only access; the Edge Function uses its
-- server-side service-role credential to claim and update notification state.
begin;

alter table public.contact_submissions
  add column if not exists email_notification_status text not null default 'pending';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'contact_submissions_email_notification_status'
      and conrelid = 'public.contact_submissions'::regclass
  ) then
    alter table public.contact_submissions
      add constraint contact_submissions_email_notification_status
      check (email_notification_status in ('pending', 'sending', 'sent'));
  end if;
end
$$;

revoke all privileges on table public.contact_submissions from public, anon, authenticated;
grant usage on schema public to anon;
grant insert (id, name, email, project)
  on table public.contact_submissions
  to anon;

notify pgrst, 'reload schema';
commit;
