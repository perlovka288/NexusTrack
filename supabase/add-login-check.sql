-- NEXUS: добавка к схеме. Выполните ОДИН раз в Supabase -> SQL Editor (весь schema.sql заново запускать не нужно).
-- Нужна, чтобы пункт «Админ-панель» появлялся в меню профиля, когда логин профиля совпадает с логином админа.
-- Возвращает только true/false и прав не выдаёт: для входа по-прежнему нужен пароль.
create or replace function public.admin_login_exists(p_username text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where lower(username) = lower(coalesce(p_username, '')));
$$;
grant execute on function public.admin_login_exists(text) to anon, authenticated;
