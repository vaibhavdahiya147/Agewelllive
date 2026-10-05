-- Run once in the AgeWell project's SQL Editor. Only additive changes.
create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email text not null unique check (char_length(email) between 3 and 254),
  consent boolean not null check (consent),
  source text not null default 'agewell_landing_page'
);
create table if not exists public.care_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  visitor_id text not null,
  network_hash text not null,
  kind text not null check (kind in ('plan','waitlist')),
  input jsonb not null,
  output jsonb,
  status text not null default 'pending' check (status in ('pending','completed','refused','failed')),
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  model text
);
create index if not exists care_requests_visitor on public.care_requests (visitor_id,kind);
create index if not exists care_requests_network on public.care_requests (network_hash,created_at);
alter table public.waitlist enable row level security;
alter table public.care_requests enable row level security;
revoke all on public.waitlist,public.care_requests from anon,authenticated;
grant select,insert,update on public.waitlist,public.care_requests to service_role;

create or replace function public.agewell_reserve_request(p_visitor_id text,p_network_hash text,p_kind text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public,pg_temp as $$
declare visitor_count integer; network_count integer; total_count integer; limit_count integer; new_id uuid;
begin
  if p_kind not in ('plan','waitlist') or char_length(p_visitor_id) <> 64 or char_length(p_network_hash) <> 64 then
    raise exception 'Invalid request identity';
  end if;
  -- A single transaction lock prevents parallel requests bypassing quotas.
  perform pg_advisory_xact_lock(7149021);
  limit_count := case when p_kind = 'plan' then 3 else 5 end;
  select count(*) into visitor_count from public.care_requests where visitor_id=p_visitor_id and kind=p_kind;
  select count(*) into network_count from public.care_requests where network_hash=p_network_hash and kind=p_kind and created_at >= now()-interval '24 hours';
  select count(*) into total_count from public.care_requests where kind=p_kind and created_at >= now()-interval '24 hours';
  if visitor_count >= limit_count then return jsonb_build_object('allowed',false,'message',case when p_kind='plan' then 'This visitor has used all 3 care-plan attempts. Join the waitlist for future access.' else 'This visitor has reached the waitlist submission limit.' end); end if;
  if network_count >= 12 or total_count >= 100 then return jsonb_build_object('allowed',false,'message','The preview has reached its daily limit. Please try again tomorrow.'); end if;
  insert into public.care_requests(visitor_id,network_hash,kind,input) values(p_visitor_id,p_network_hash,p_kind,p_input) returning id into new_id;
  return jsonb_build_object('allowed',true,'id',new_id,'remaining',limit_count-visitor_count-1);
end;
$$;
create or replace function public.agewell_stats()
returns jsonb language sql security definer set search_path = public,pg_temp as $$
  select jsonb_build_object(
    'plansGenerated',(select count(*) from public.care_requests where kind='plan' and status='completed'),
    'mostCommonTask',coalesce((select task->>'category' from public.care_requests r cross join lateral jsonb_array_elements(r.input->'tasks') task where r.kind='plan' and r.status='completed' group by task->>'category' order by count(*) desc,task->>'category' limit 1),'none'),
    'waitlistMembers',(select count(*) from public.waitlist)
  );
$$;
revoke all on function public.agewell_reserve_request(text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.agewell_stats() from public,anon,authenticated;
grant execute on function public.agewell_reserve_request(text,text,text,jsonb) to service_role;
grant execute on function public.agewell_stats() to service_role;
