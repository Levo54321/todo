-- To-do v38: Work projects, the new Mac/iPhone section (additive; no existing function is changed).
--  * wp2_overview: everything the overview and the project list need in ONE call: per project its id, name, prio, status, pos,
--    next_task_id, the whole meta and the latest status update (at, headline, rag), plus the people and clients lists.
--  * wp2_next_set: sets or clears a project's Next task. The task must be an open Work task whose category is this project's
--    name; anything else is refused (23514). Null clears.
-- Touches no shop_* objects. Safe to run more than once.

create or replace function public.wp2_overview(p_token text)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform public.todo_check(p_token);
  return jsonb_build_object(
    'projects', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'prio', p.prio, 'status', p.status, 'pos', p.pos, 'next', p.next_task_id, 'meta', p.meta,
        'last', (select jsonb_build_object('at', u.at, 'headline', u.headline, 'rag', u.rag)
                 from public.work_project_updates u where u.project_id = p.id order by u.at desc, u.id desc limit 1))
        order by p.pos, p.created_at) from public.work_projects p), '[]'::jsonb),
    'people', public.wpeople_json(),
    'clients', public.wclients_json());
end $$;

create or replace function public.wp2_next_set(p_token text, p_id text, p_task uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_name text;
begin
  perform public.todo_check(p_token);
  select name into v_name from public.work_projects where id = p_id for update;
  if v_name is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if p_task is not null and not exists (select 1 from public.todos t where t.id = p_task and t.list = 'work' and not t.done and t.category = v_name) then
    raise exception 'that task is not an open task of this project' using errcode = '23514';
  end if;
  update public.work_projects set next_task_id = p_task where id = p_id;
  return jsonb_build_object('id', p_id, 'next', p_task);
end $$;

revoke all on function public.wp2_overview(text) from public, anon, authenticated;
revoke all on function public.wp2_next_set(text, text, uuid) from public, anon, authenticated;
grant execute on function public.wp2_overview(text) to anon, service_role;
grant execute on function public.wp2_next_set(text, text, uuid) to anon, service_role;
