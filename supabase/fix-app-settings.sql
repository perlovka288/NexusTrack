-- NEXUS: исправление ошибки «column "value" is of type jsonb but expression is of type text».
-- Таблица app_settings была создана раньше с колонкой value типа jsonb. Приводим её к text; уже сохранённые значения не теряются.
-- Выполните ОДИН раз в Supabase -> SQL Editor. Повторный запуск безопасен.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'app_settings' and column_name = 'value' and data_type = 'jsonb') then
    alter table public.app_settings alter column value type text using (value #>> '{}');
  end if;
end $$;
