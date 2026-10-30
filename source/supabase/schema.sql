-- =====================================================================
-- NEXUS: схема Supabase (аналитика, админы, настройки API, OTA-релизы)
-- Выполните целиком в Supabase → SQL Editor.
--
-- ВАЖНО: ПЕРЕД запуском замените 'CHANGE_ME_NOW' в функции
-- nexus_bootstrap_admin (ниже) на свой пароль для главного админа kostlim.
-- Пароль хранится только здесь, в приложение он не попадает.
-- После первого входа его можно сменить в админке («Сменить пароль»).
--
-- Модель безопасности: anon-ключ публичен (он вшит в приложение), поэтому
--  • таблицы admins / admin_sessions закрыты RLS полностью;
--  • все операции админов идут через SECURITY DEFINER функции, которые
--    проверяют токен сессии и роль прямо в базе;
--  • пароли хранятся как bcrypt (pgcrypto), в открытом виде не передаются в таблицы.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- user_sessions: счётчик установок ----------
create table if not exists public.user_sessions (
  device_id   uuid primary key,
  app_version text not null default '',
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);
alter table public.user_sessions enable row level security;

-- .upsert() из приложения: нужны insert + update + select (select нужен для ON CONFLICT).
drop policy if exists us_insert on public.user_sessions;
drop policy if exists us_update on public.user_sessions;
drop policy if exists us_select on public.user_sessions;
create policy us_insert on public.user_sessions for insert to anon, authenticated
  with check (char_length(app_version) <= 32);
create policy us_update on public.user_sessions for update to anon, authenticated
  using (true) with check (char_length(app_version) <= 32);
create policy us_select on public.user_sessions for select to anon, authenticated using (true);
create index if not exists user_sessions_last_seen_idx on public.user_sessions (last_seen);

-- ---------- admins ----------
create table if not exists public.admins (
  id              uuid primary key default gen_random_uuid(),
  username        text not null,
  password_hash   text not null,
  role            text not null check (role in ('superadmin', 'admin')),
  failed_attempts int  not null default 0,
  locked_until    timestamptz,
  created_at      timestamptz not null default now()
);
create unique index if not exists admins_username_lower_idx on public.admins (lower(username));
alter table public.admins enable row level security;            -- политик нет: anon доступа не имеет
revoke all on public.admins from anon, authenticated;

create table if not exists public.admin_sessions (
  token      text primary key,
  admin_id   uuid not null references public.admins (id) on delete cascade,
  expires_at timestamptz not null
);
alter table public.admin_sessions enable row level security;
revoke all on public.admin_sessions from anon, authenticated;

-- ---------- app_settings ----------
create table if not exists public.app_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists as_read_provider on public.app_settings;
create policy as_read_provider on public.app_settings for select to anon, authenticated
  using (key = 'active_provider');
revoke insert, update, delete on public.app_settings from anon, authenticated;

-- ---------- app_releases ----------
create table if not exists public.app_releases (
  id           bigint generated always as identity primary key,
  version      text not null unique check (version ~ '^\d+\.\d+\.\d+$'),
  changelog    text not null default '',
  download_url text not null check (download_url ~* '^https://'),
  sha256       text check (sha256 is null or sha256 ~* '^[0-9a-f]{64}$'),
  created_at   timestamptz not null default now()
);
alter table public.app_releases enable row level security;
drop policy if exists ar_read on public.app_releases;
create policy ar_read on public.app_releases for select to anon, authenticated using (true);
revoke insert, update, delete on public.app_releases from anon, authenticated;

-- =====================================================================
-- Внутренний помощник: админ по токену (из anon недоступен)
-- =====================================================================
create or replace function public._nx_admin(p_token text, p_need_super boolean default false)
returns public.admins
language plpgsql security definer set search_path = public, extensions as $$
declare a public.admins;
begin
  select ad.* into a
    from public.admin_sessions s join public.admins ad on ad.id = s.admin_id
   where s.token = p_token and s.expires_at > now();
  if not found then raise exception 'nx_unauthorized' using errcode = '42501'; end if;
  if p_need_super and a.role <> 'superadmin' then raise exception 'nx_forbidden' using errcode = '42501'; end if;
  return a;
end $$;
revoke all on function public._nx_admin(text, boolean) from public, anon, authenticated;

-- =====================================================================
-- Автосоздание главного админа kostlim (вызывается приложением при старте)
-- =====================================================================
create or replace function public.nexus_bootstrap_admin()
returns json
language plpgsql security definer set search_path = public, extensions as $$
declare v_pass constant text := 'CHANGE_ME_NOW';          -- <<< ЗАМЕНИТЕ ПЕРЕД ЗАПУСКОМ
begin
  if exists (select 1 from public.admins where lower(username) = 'kostlim') then
    return json_build_object('created', false);
  end if;
  if v_pass = 'CHANGE_ME_NOW' then
    raise exception 'nx_default_password_not_set';
  end if;
  insert into public.admins (username, password_hash, role)
  values ('kostlim', extensions.crypt(v_pass, extensions.gen_salt('bf', 10)), 'superadmin');
  return json_build_object('created', true);
end $$;
grant execute on function public.nexus_bootstrap_admin() to anon, authenticated;

-- =====================================================================
-- Вход / выход
-- =====================================================================
create or replace function public.admin_login(p_username text, p_password text)
returns json
language plpgsql security definer set search_path = public, extensions as $$
declare a public.admins; t text;
begin
  select * into a from public.admins where lower(username) = lower(coalesce(p_username, ''));
  if found and a.locked_until is not null and a.locked_until > now() then
    return json_build_object('error', 'locked',
      'minutes', greatest(1, ceil(extract(epoch from (a.locked_until - now())) / 60)::int));
  end if;
  if not found or a.password_hash <> extensions.crypt(coalesce(p_password, ''), a.password_hash) then
    if found then   -- 5 неверных попыток подряд → блокировка на 5 минут
      update public.admins
         set failed_attempts = case when failed_attempts + 1 >= 5 then 0 else failed_attempts + 1 end,
             locked_until    = case when failed_attempts + 1 >= 5 then now() + interval '5 minutes' else null end
       where id = a.id;
    end if;
    return json_build_object('error', 'invalid');
  end if;
  update public.admins set failed_attempts = 0, locked_until = null where id = a.id;
  delete from public.admin_sessions where expires_at < now();
  t := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.admin_sessions (token, admin_id, expires_at) values (t, a.id, now() + interval '12 hours');
  return json_build_object('token', t, 'username', a.username, 'role', a.role);
end $$;
grant execute on function public.admin_login(text, text) to anon, authenticated;

create or replace function public.admin_logout(p_token text)
returns void
language sql security definer set search_path = public as $$
  delete from public.admin_sessions where token = p_token;
$$;
grant execute on function public.admin_logout(text) to anon, authenticated;

-- =====================================================================
-- Статистика и API-провайдер (любой админ)
-- =====================================================================
create or replace function public.admin_stats(p_token text)
returns json
language plpgsql security definer set search_path = public as $$
begin
  perform public._nx_admin(p_token);
  return json_build_object(
    'total',      (select count(*) from public.user_sessions),
    'active_24h', (select count(*) from public.user_sessions where last_seen > now() - interval '24 hours'),
    'active_7d',  (select count(*) from public.user_sessions where last_seen > now() - interval '7 days'),
    'versions',   coalesce((select json_agg(v order by v.cnt desc) from (
                     select app_version as version, count(*) as cnt
                       from public.user_sessions group by app_version order by cnt desc limit 8) v), '[]'::json)
  );
end $$;
grant execute on function public.admin_stats(text) to anon, authenticated;

create or replace function public.admin_set_provider(p_token text, p_provider text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._nx_admin(p_token);
  if p_provider not in ('igdb', 'rawg', 'steam') then raise exception 'nx_bad_provider'; end if;
  insert into public.app_settings (key, value) values ('active_provider', p_provider)
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;
grant execute on function public.admin_set_provider(text, text) to anon, authenticated;

-- =====================================================================
-- Управление админами и смена пароля
-- =====================================================================
create or replace function public.admin_list_admins(p_token text)
returns json
language plpgsql security definer set search_path = public as $$
begin
  perform public._nx_admin(p_token, true);
  return coalesce((select json_agg(json_build_object('id', id, 'username', username, 'role', role, 'created_at', created_at)
                                   order by created_at) from public.admins), '[]'::json);
end $$;
grant execute on function public.admin_list_admins(text) to anon, authenticated;

create or replace function public.admin_create_admin(p_token text, p_username text, p_password text, p_role text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._nx_admin(p_token, true);
  if p_username !~ '^[A-Za-z0-9_.-]{3,32}$' then raise exception 'nx_bad_username'; end if;
  if char_length(coalesce(p_password, '')) < 8 or char_length(p_password) > 128 then raise exception 'nx_bad_password'; end if;
  if p_role not in ('superadmin', 'admin') then raise exception 'nx_bad_role'; end if;
  if exists (select 1 from public.admins where lower(username) = lower(p_username)) then raise exception 'nx_exists'; end if;
  insert into public.admins (username, password_hash, role)
  values (p_username, extensions.crypt(p_password, extensions.gen_salt('bf', 10)), p_role);
end $$;
grant execute on function public.admin_create_admin(text, text, text, text) to anon, authenticated;

create or replace function public.admin_delete_admin(p_token text, p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare me public.admins; target public.admins;
begin
  me := public._nx_admin(p_token, true);
  select * into target from public.admins where id = p_id;
  if not found then return; end if;
  if target.id = me.id then raise exception 'nx_self_delete'; end if;
  if target.role = 'superadmin' and (select count(*) from public.admins where role = 'superadmin') <= 1 then
    raise exception 'nx_last_super';
  end if;
  delete from public.admins where id = p_id;
end $$;
grant execute on function public.admin_delete_admin(text, uuid) to anon, authenticated;

create or replace function public.admin_change_password(p_token text, p_old text, p_new text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare a public.admins;
begin
  a := public._nx_admin(p_token);
  if a.password_hash <> extensions.crypt(coalesce(p_old, ''), a.password_hash) then raise exception 'nx_wrong_old'; end if;
  if char_length(coalesce(p_new, '')) < 8 or char_length(p_new) > 128 then raise exception 'nx_bad_password'; end if;
  update public.admins set password_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)) where id = a.id;
end $$;
grant execute on function public.admin_change_password(text, text, text) to anon, authenticated;

-- =====================================================================
-- OTA-релизы (только superadmin)
-- =====================================================================
create or replace function public.admin_publish_release(p_token text, p_version text, p_changelog text, p_url text, p_sha256 text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._nx_admin(p_token, true);
  if p_version !~ '^\d+\.\d+\.\d+$' then raise exception 'nx_bad_version'; end if;
  if p_url !~* '^https://' then raise exception 'nx_bad_url'; end if;
  if exists (select 1 from public.app_releases where version = p_version) then raise exception 'nx_exists'; end if;
  insert into public.app_releases (version, changelog, download_url, sha256)
  values (p_version, coalesce(p_changelog, ''), p_url, nullif(lower(trim(coalesce(p_sha256, ''))), ''));
end $$;
grant execute on function public.admin_publish_release(text, text, text, text, text) to anon, authenticated;

-- =====================================================================
-- Проверка логина профиля (для показа пункта «Админ-панель» в меню).
-- Возвращает только true/false; права не выдаёт: для входа по-прежнему нужен пароль.
-- =====================================================================
create or replace function public.admin_login_exists(p_username text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where lower(username) = lower(coalesce(p_username, '')));
$$;
grant execute on function public.admin_login_exists(text) to anon, authenticated;
