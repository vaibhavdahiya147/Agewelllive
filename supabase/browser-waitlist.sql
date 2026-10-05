-- Restricted browser signup. The publishable key cannot read or edit either table.
begin;
alter table public.waitlist enable row level security;
alter table public.care_requests enable row level security;
revoke all on public.waitlist, public.care_requests from anon, authenticated;

create or replace function public.agewell_join_waitlist(p_email text, p_consent boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cleaned_email text := lower(btrim(p_email));
  daily_count bigint;
begin
  if p_consent is distinct from true or cleaned_email is null
     or char_length(cleaned_email) not between 3 and 254
     or cleaned_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return jsonb_build_object('registered', false, 'message', 'Enter a valid email and agree to receive early-access updates.');
  end if;
  perform pg_advisory_xact_lock(7149022);
  select count(*) into daily_count from public.waitlist where created_at >= now() - interval '24 hours';
  if daily_count >= 100 then
    return jsonb_build_object('registered', false, 'message', 'The waitlist has reached its daily signup limit. Please try again tomorrow.');
  end if;
  insert into public.waitlist(email, consent, source)
    values (cleaned_email, true, 'agewell_landing_page') on conflict (email) do nothing;
  -- Same response for duplicate/new emails; no record details or IDs are returned.
  return jsonb_build_object('registered', true, 'message', 'You’re on the AgeWell early-access waitlist. Thank you for joining!');
end;
$$;
revoke all on function public.agewell_join_waitlist(text, boolean) from public;
grant execute on function public.agewell_join_waitlist(text, boolean) to anon, authenticated;
commit;
