-- NEXUS: закрываем таблицу user_sessions от прямого доступа с публичным ключом.
-- Раньше любой, у кого есть публичный ключ из приложения, мог прочитать все device_id или править чужие строки.
-- Теперь приложение шлёт «пульс» через функцию nexus_ping, а таблицу читает только админ-панель (admin_stats).
-- Выполните ОДИН раз в SQL Editor ПОСЛЕ того, как все обновились до 3.3.10: старые версии шлют пульс напрямую в таблицу и после этого перестанут попадать в статистику.
create or replace function public.nexus_ping(p_device uuid, p_version text)
returns void language sql security definer set search_path = public as $$
  insert into public.user_sessions (device_id, app_version, last_seen)
  values (p_device, left(coalesce(p_version, ''), 32), now())
  on conflict (device_id) do update set app_version = excluded.app_version, last_seen = now();
$$;
grant execute on function public.nexus_ping(uuid, text) to anon, authenticated;

drop policy if exists us_insert on public.user_sessions;
drop policy if exists us_update on public.user_sessions;
drop policy if exists us_select on public.user_sessions;
revoke all on public.user_sessions from anon, authenticated;

-- Публикация релиза: SHA-256 обязателен (приложение всё равно не установит обновление без него).
create or replace function public.admin_publish_release(p_token text, p_version text, p_changelog text, p_url text, p_sha256 text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._nx_admin(p_token, true);
  if p_version !~ '^\d+\.\d+\.\d+$' then raise exception 'nx_bad_version'; end if;
  if p_url !~* '^https://' then raise exception 'nx_bad_url'; end if;
  if coalesce(p_sha256, '') !~* '^[0-9a-f]{64}$' then raise exception 'nx_bad_sha'; end if;
  if exists (select 1 from public.app_releases where version = p_version) then raise exception 'nx_exists'; end if;
  insert into public.app_releases (version, changelog, download_url, sha256)
  values (p_version, coalesce(p_changelog, ''), p_url, lower(trim(p_sha256)));
end $$;
grant execute on function public.admin_publish_release(text, text, text, text, text) to anon, authenticated;
