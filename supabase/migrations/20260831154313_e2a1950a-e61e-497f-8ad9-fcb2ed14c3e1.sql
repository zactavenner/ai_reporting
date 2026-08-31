create table public.hyperframes_render_jobs (
  id uuid primary key,
  project_id uuid not null references public.video_projects(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  requested_by uuid not null,
  title text not null,
  spec jsonb not null,
  status text not null default 'queued' check (status in ('queued','rendering','completed','failed')),
  claim_token uuid,
  error text,
  output_url text,
  creative_id uuid references public.creatives(id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);
create index hyperframes_render_jobs_queue on public.hyperframes_render_jobs (created_at) where status = 'queued';
create index hyperframes_render_jobs_requester on public.hyperframes_render_jobs (requested_by, created_at desc);
alter table public.hyperframes_render_jobs enable row level security;
revoke all on public.hyperframes_render_jobs from public, anon, authenticated;
grant all on public.hyperframes_render_jobs to service_role;

create table public.hyperframes_workers (
  id text primary key,
  last_seen_at timestamptz not null default now()
);
alter table public.hyperframes_workers enable row level security;
revoke all on public.hyperframes_workers from public, anon, authenticated;
grant all on public.hyperframes_workers to service_role;

create function public.claim_hyperframes_render()
returns setof public.hyperframes_render_jobs language sql security invoker set search_path = public as $$
  update public.hyperframes_render_jobs
  set status = 'rendering', claim_token = gen_random_uuid(), started_at = now()
  where id = (
    select id from public.hyperframes_render_jobs where status = 'queued'
    order by created_at for update skip locked limit 1
  ) returning *;
$$;
revoke all on function public.claim_hyperframes_render() from public, anon, authenticated;
grant execute on function public.claim_hyperframes_render() to service_role;

create function public.complete_hyperframes_render(job_id uuid, lease_token uuid, media_url text)
returns uuid language plpgsql security invoker set search_path = public as $$
declare job public.hyperframes_render_jobs;
begin
  select * into job from public.hyperframes_render_jobs where id = job_id for update;
  if not found or job.claim_token is distinct from lease_token then raise exception 'Invalid render lease'; end if;
  if job.status = 'completed' then return job.creative_id; end if;
  if job.status <> 'rendering' then raise exception 'Job is not rendering'; end if;
  if media_url not like '%/storage/v1/object/public/creatives/' || job.client_id::text || '/hyperframes/' || job.id::text || '/final.mp4' then
    raise exception 'Output path does not match client and job';
  end if;
  insert into public.creatives (id, client_id, title, type, platform, file_url, status, source, aspect_ratio)
    values (job.id, job.client_id, job.title, 'video', 'meta', media_url, 'pending', 'hyperframes', job.spec->>'aspectRatio');
  update public.hyperframes_render_jobs set status = 'completed', output_url = media_url,
    creative_id = job.id, completed_at = now() where id = job.id;
  -- Never reassign a project to a different client during a render.
  update public.video_projects set output_url = media_url, status = 'review', updated_at = now()
    where id = job.project_id and client_id = job.client_id;
  return job.id;
end;
$$;
revoke all on function public.complete_hyperframes_render(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.complete_hyperframes_render(uuid, uuid, text) to service_role;