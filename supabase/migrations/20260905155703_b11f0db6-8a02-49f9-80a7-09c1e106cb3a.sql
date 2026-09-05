alter table public.linq_comment_deliveries
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists ghl_message_id text,
  add column if not exists comment_marker text;

create index if not exists linq_comment_deliveries_lease_idx
  on public.linq_comment_deliveries (status, lease_expires_at);

-- Atomic per (message, contact) claim with owner token and stale-lease recovery.
create or replace function public.linq_claim_delivery(
  p_message_id text,
  p_contact_id text,
  p_location_id text,
  p_chat_id text,
  p_marker text,
  p_owner text,
  p_lease_seconds integer default 120
)
returns table (
  delivery_id uuid,
  delivery_status text,
  attempts integer,
  ghl_message_id text,
  claimed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.linq_comment_deliveries;
begin
  insert into public.linq_comment_deliveries as d (
    linq_message_id, ghl_contact_id, ghl_location_id, linq_chat_id,
    comment_marker, status, lease_owner, lease_expires_at
  ) values (
    p_message_id, p_contact_id, p_location_id, p_chat_id,
    p_marker, 'pending', p_owner, now() + make_interval(secs => p_lease_seconds)
  )
  on conflict (linq_message_id, ghl_contact_id) do update
    set lease_owner = p_owner,
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        linq_chat_id = coalesce(d.linq_chat_id, p_chat_id),
        comment_marker = coalesce(d.comment_marker, p_marker)
    where d.status <> 'posted'
      and (
        d.lease_owner is null
        or d.lease_owner = p_owner
        or d.lease_expires_at is null
        or d.lease_expires_at < now()
      )
  returning d.* into v_row;

  if v_row.id is not null then
    return query select v_row.id, v_row.status, v_row.attempts, v_row.ghl_message_id, true;
    return;
  end if;

  select * into v_row
  from public.linq_comment_deliveries
  where linq_message_id = p_message_id and ghl_contact_id = p_contact_id;

  return query select v_row.id, v_row.status, v_row.attempts, v_row.ghl_message_id, false;
end;
$$;

-- Lease a batch of retryable rows so two reconcilers never post the same note.
create or replace function public.linq_claim_pending_deliveries(
  p_owner text,
  p_limit integer default 20,
  p_lease_seconds integer default 300
)
returns setof public.linq_comment_deliveries
language sql
security definer
set search_path = public
as $$
  with candidates as (
    select id
    from public.linq_comment_deliveries
    where status in ('pending', 'failed')
      and (lease_expires_at is null or lease_expires_at < now())
    order by updated_at asc
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  )
  update public.linq_comment_deliveries d
     set lease_owner = p_owner,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds)
   from candidates c
  where d.id = c.id
  returning d.*;
$$;

revoke all on function public.linq_claim_delivery(text, text, text, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.linq_claim_pending_deliveries(text, integer, integer) from public, anon, authenticated;
grant execute on function public.linq_claim_delivery(text, text, text, text, text, text, integer) to service_role;
grant execute on function public.linq_claim_pending_deliveries(text, integer, integer) to service_role;