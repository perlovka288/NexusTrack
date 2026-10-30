-- NEXUS 3.3.15: выбор нескольких API в админке (например, IGDB + Steam или IGDB + RAWG).
-- Выполните ОДИН раз в Supabase -> SQL Editor. Повторный запуск безопасен.
-- Предварительно должен быть выполнен supabase/fix-app-settings.sql (колонка value = text).
-- Значение хранится строкой «v2:igdb,steam». Старый формат (одно слово) приложение тоже понимает.
create or replace function public.admin_set_provider(p_token text, p_provider text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._nx_admin(p_token);
  if p_provider !~ '^(igdb|rawg|steam)$'
     and p_provider !~ '^v2:(igdb|rawg|steam)(,(igdb|rawg|steam)){0,2}$' then
    raise exception 'nx_bad_provider';
  end if;
  insert into public.app_settings (key, value) values ('active_provider', p_provider)
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;
grant execute on function public.admin_set_provider(text, text) to anon, authenticated;
