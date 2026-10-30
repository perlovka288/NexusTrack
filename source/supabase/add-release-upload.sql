-- NEXUS 3.3.14: загрузка обновлений прямо из админки (без GitHub) и выбор выдаваемой версии.
-- Выполните ОДИН раз в Supabase -> SQL Editor. Повторный запуск безопасен.
--
-- Безопасность:
--  * бакет releases публичный только на чтение файлов по прямой ссылке (приложению так проще скачивать);
--  * загрузка в бакет возможна ТОЛЬКО по одноразовому «билету», который выдаёт главный админ (по токену сессии);
--  * перезаписывать и удалять файлы с публичным ключом нельзя, листинг файлов закрыт;
--  * подмена файла всё равно не пройдёт: приложение сверяет SHA-256, записанный в app_releases (его пишет только главный админ).

-- ---------- бакет ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('releases', 'releases', true, 52428800)            -- 50 МБ: лимит бесплатного тарифа Supabase
on conflict (id) do update set public = true, file_size_limit = 52428800;

-- ---------- билеты на загрузку ----------
create table if not exists public.release_tickets (
  name       text primary key,
  expires_at timestamptz not null
);
alter table public.release_tickets enable row level security;
revoke all on public.release_tickets from anon, authenticated;

create or replace function public.nx_upload_ok(p_name text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.release_tickets where name = p_name and expires_at > now());
$$;
revoke all on function public.nx_upload_ok(text) from public;
grant execute on function public.nx_upload_ok(text) to anon, authenticated;

drop policy if exists nx_release_upload on storage.objects;
create policy nx_release_upload on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'releases' and public.nx_upload_ok(name));
-- политик select/update/delete для бакета нет: публичным ключом файлы не перечислить, не заменить и не удалить

create or replace function public.admin_release_ticket(p_token text, p_version text, p_ext text)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare n text;
begin
  perform public._nx_admin(p_token, true);
  if p_version !~ '^\d+\.\d+\.\d+$' then raise exception 'nx_bad_version'; end if;
  if lower(coalesce(p_ext, '')) not in ('asar', 'zip', 'exe') then raise exception 'nx_bad_ext'; end if;
  delete from public.release_tickets where expires_at < now();
  n := 'nexus-' || p_version || '-' || encode(extensions.gen_random_bytes(6), 'hex') || '.' || lower(p_ext);
  insert into public.release_tickets (name, expires_at) values (n, now() + interval '20 minutes');
  return n;
end $$;
grant execute on function public.admin_release_ticket(text, text, text) to anon, authenticated;

-- ---------- какую версию выдавать всем ----------
-- Пустая строка = автоматически самая новая. Конкретная версия (в том числе старая) = откат.
drop policy if exists as_read_provider on public.app_settings;
create policy as_read_provider on public.app_settings for select to anon, authenticated
  using (key in ('active_provider', 'active_release'));

create or replace function public.admin_set_active_release(p_token text, p_version text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._nx_admin(p_token, true);
  if coalesce(p_version, '') = '' then
    delete from public.app_settings where key = 'active_release';
    return;
  end if;
  if p_version !~ '^\d+\.\d+\.\d+$' then raise exception 'nx_bad_version'; end if;
  if not exists (select 1 from public.app_releases where version = p_version) then raise exception 'nx_no_release'; end if;
  insert into public.app_settings (key, value) values ('active_release', p_version)
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;
grant execute on function public.admin_set_active_release(text, text) to anon, authenticated;

-- ---------- удаление релиза из списка (файл в хранилище остаётся) ----------
create or replace function public.admin_delete_release(p_token text, p_version text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._nx_admin(p_token, true);
  delete from public.app_releases where version = p_version;
  delete from public.app_settings where key = 'active_release' and value = p_version;
end $$;
grant execute on function public.admin_delete_release(text, text) to anon, authenticated;
