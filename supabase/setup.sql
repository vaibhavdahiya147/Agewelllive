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

-- One-key website: limited anonymous logging, never anonymous table access.
begin;
alter table public.care_requests add column if not exists write_token_hash text;

create or replace function public.agewell_public_reserve(
  p_visitor_id text, p_network_hash text, p_input jsonb, p_write_token text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  total_count integer; visitor_count integer; network_count integer;
  new_id uuid; safe_input jsonb; safe_tasks jsonb := '[]'::jsonb;
  task jsonb; task_id text; task_label text; category text; task_day text;
  seen_ids text[] := array[]::text[];
begin
  if p_visitor_id is null or p_network_hash is null or p_write_token is null
     or p_visitor_id !~ '^[a-f0-9]{64}$' or p_network_hash !~ '^[a-f0-9]{64}$'
     or p_write_token !~ '^[a-f0-9]{64}$' or p_input is null
     or jsonb_typeof(p_input) <> 'object' or octet_length(p_input::text) > 5000 then
    raise exception 'Invalid request';
  end if;
  if p_input->'refused' = 'true'::jsonb then
    if coalesce(p_input->>'reason','') not in ('clinical_request','personal_information') then raise exception 'Invalid refusal'; end if;
    safe_input := jsonb_build_object('refused',true,'reason',p_input->>'reason');
  else
    if p_input->'consent' is distinct from 'true'::jsonb
       or coalesce(p_input->>'memberA','') not in ('morning','evening','flexible')
       or coalesce(p_input->>'memberB','') not in ('morning','evening','flexible')
       or jsonb_typeof(p_input->'tasks') is distinct from 'array' then raise exception 'Invalid routine'; end if;
    if jsonb_array_length(p_input->'tasks') not between 1 and 5 then raise exception 'Invalid tasks'; end if;
    for task in select value from jsonb_array_elements(p_input->'tasks') loop
      task_id := task->>'id';
      if task_id is null or task_id not in ('morning','evening','walk','refill','appointment') or task_id = any(seen_ids) then raise exception 'Invalid task ID'; end if;
      seen_ids := array_append(seen_ids,task_id);
      if coalesce(task->>'time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Invalid time'; end if;
      task_day := task->>'day';
      if task_id in ('morning','evening','walk') and task_day is distinct from 'Every day' then raise exception 'Invalid routine day'; end if;
      if task_id = 'appointment' and coalesce(task_day,'') not in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday') then raise exception 'Invalid appointment day'; end if;
      if task_id = 'refill' and (task_day is distinct from 'Monday' or task->>'time' is distinct from '18:00') then raise exception 'Invalid stock check'; end if;
      task_label := case task_id when 'morning' then 'Morning medicine reminder' when 'evening' then 'Evening medicine reminder' when 'walk' then 'Existing walk routine' when 'appointment' then 'Attend the already-booked doctor appointment' else 'Check remaining medicine stock and arrange the existing prescription refill' end;
      category := case task_id when 'walk' then 'routine' when 'appointment' then 'appointments' when 'refill' then 'refills' else 'medicines' end;
      safe_tasks := safe_tasks || jsonb_build_array(jsonb_build_object('id',task_id,'label',task_label,'category',category,'day',task_day,'time',task->>'time'));
    end loop;
    safe_input := jsonb_build_object('tasks',safe_tasks,'memberA',p_input->>'memberA','memberB',p_input->>'memberB','consent',true);
  end if;
  perform pg_advisory_xact_lock(7149021);
  select count(*) into visitor_count from public.care_requests where visitor_id=p_visitor_id and kind='plan';
  select count(*) into network_count from public.care_requests where network_hash=p_network_hash and kind='plan' and created_at >= now()-interval '24 hours';
  select count(*) into total_count from public.care_requests where kind='plan' and created_at >= now()-interval '24 hours';
  if visitor_count >= 3 then return jsonb_build_object('allowed',false,'message','This visitor has used all 3 care-plan attempts.'); end if;
  if network_count >= 12 or total_count >= 100 then return jsonb_build_object('allowed',false,'message','The preview has reached its daily limit. Please try tomorrow.'); end if;
  insert into public.care_requests(visitor_id,network_hash,kind,input,write_token_hash)
    values(p_visitor_id,p_network_hash,'plan',safe_input,encode(sha256(convert_to(p_write_token,'UTF8')),'hex')) returning id into new_id;
  return jsonb_build_object('allowed',true,'id',new_id,'remaining',2-visitor_count);
end;
$$;

create or replace function public.agewell_public_finish(
  p_id uuid, p_write_token text, p_status text, p_output jsonb,
  p_input_tokens integer, p_output_tokens integer, p_model text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  saved_row public.care_requests%rowtype; safe_output jsonb; safe_tasks jsonb := '[]'::jsonb;
  source_task jsonb; assigned jsonb; matches integer; items integer;
begin
  if p_write_token is null or p_write_token !~ '^[a-f0-9]{64}$'
     or p_status is null or p_status not in ('completed','refused','failed')
     or p_output is null or jsonb_typeof(p_output) <> 'object' or octet_length(p_output::text)>5000
     or p_input_tokens is null or p_output_tokens is null
     or p_input_tokens not between 0 and 100000 or p_output_tokens not between 0 and 100000
     or (p_model is not null and (char_length(p_model)>100 or p_model !~ '^[a-z0-9.-]+$')) then raise exception 'Invalid result'; end if;
  select * into saved_row from public.care_requests where id=p_id and kind='plan'
    and status='pending' and created_at >= now()-interval '30 minutes'
    and write_token_hash=encode(sha256(convert_to(p_write_token,'UTF8')),'hex') for update;
  if not found then return jsonb_build_object('saved',false); end if;
  if p_status = 'completed' then
    if saved_row.input->'refused' = 'true'::jsonb or p_output is null
       or jsonb_typeof(p_output->'tasks') is distinct from 'array' then raise exception 'Invalid completed draft'; end if;
    items := jsonb_array_length(saved_row.input->'tasks');
    if jsonb_array_length(p_output->'tasks') <> items then raise exception 'Incomplete draft'; end if;
    for source_task in select value from jsonb_array_elements(saved_row.input->'tasks') loop
      select count(*) into matches from jsonb_array_elements(p_output->'tasks') x where x->>'id'=source_task->>'id';
      if matches <> 1 then raise exception 'Invalid assignments'; end if;
      select x into assigned from jsonb_array_elements(p_output->'tasks') x where x->>'id'=source_task->>'id';
      if coalesce(assigned->>'owner','') not in ('member_a','member_b') then raise exception 'Invalid owner'; end if;
      safe_tasks := safe_tasks || jsonb_build_array(source_task || jsonb_build_object('owner',assigned->>'owner'));
    end loop;
    safe_output := jsonb_build_object('tasks',safe_tasks,'notice','Coordination draft only. Review with your parent. No notifications are scheduled or sent. Keep all medication instructions from the prescriber unchanged.');
  else
    safe_output := jsonb_build_object('message',case when p_status='refused' then 'Coordination-only guardrail refusal.' else 'Draft unavailable.' end);
  end if;
  update public.care_requests set status=p_status,output=safe_output,input_tokens=p_input_tokens,
    output_tokens=p_output_tokens,model=p_model,write_token_hash=null where id=p_id;
  return jsonb_build_object('saved',true);
end;
$$;

create or replace function public.agewell_public_stats()
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'plansGenerated',(select count(*) from public.care_requests where kind='plan' and status='completed'),
    'mostCommonTask',coalesce((select task->>'category' from public.care_requests r cross join lateral jsonb_array_elements(r.input->'tasks') task where r.kind='plan' and r.status='completed' group by task->>'category' order by count(*) desc,task->>'category' limit 1),'none')
  );
$$;

create or replace function public.agewell_join_waitlist(p_email text,p_consent boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cleaned_email text := lower(btrim(p_email)); daily_count bigint;
begin
  if p_consent is distinct from true or cleaned_email is null or char_length(cleaned_email) not between 3 and 254
     or cleaned_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return jsonb_build_object('registered',false,'message','Enter a valid email and confirm consent.');
  end if;
  perform pg_advisory_xact_lock(7149022);
  select count(*) into daily_count from public.waitlist where created_at>=now()-interval '24 hours';
  if daily_count>=100 then return jsonb_build_object('registered',false,'message','The waitlist has reached its daily signup limit. Please try tomorrow.'); end if;
  insert into public.waitlist(email,consent,source) values(cleaned_email,true,'agewell_landing_page') on conflict(email) do nothing;
  return jsonb_build_object('registered',true,'message','You’re on the AgeWell early-access waitlist. Thank you for joining!');
end;
$$;

revoke all on function public.agewell_public_reserve(text,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.agewell_public_finish(uuid,text,text,jsonb,integer,integer,text) from public,anon,authenticated;
revoke all on function public.agewell_public_stats() from public,anon,authenticated;
revoke all on function public.agewell_join_waitlist(text,boolean) from public,anon,authenticated;
grant execute on function public.agewell_public_reserve(text,text,jsonb,text) to anon,authenticated;
grant execute on function public.agewell_public_finish(uuid,text,text,jsonb,integer,integer,text) to anon,authenticated;
grant execute on function public.agewell_public_stats() to anon,authenticated;
grant execute on function public.agewell_join_waitlist(text,boolean) to anon,authenticated;
commit;
