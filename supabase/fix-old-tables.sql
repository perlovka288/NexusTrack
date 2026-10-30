-- NEXUS: починка старых таблиц Supabase. Выполните ОДИН раз в SQL Editor.
-- Лечит ошибки вида «column ... does not exist» (таблицы были созданы раньше текущей схемы,
-- а `create table if not exists` существующие таблицы не обновляет). Данные не удаляются.

alter table public.user_sessions add column if not exists app_version text not null default '';
alter table public.user_sessions add column if not exists first_seen  timestamptz not null default now();
alter table public.user_sessions add column if not exists last_seen   timestamptz not null default now();

alter table public.admins add column if not exists failed_attempts int not null default 0;
alter table public.admins add column if not exists locked_until    timestamptz;
alter table public.admins add column if not exists created_at      timestamptz not null default now();

alter table public.app_settings add column if not exists updated_at timestamptz not null default now();

alter table public.app_releases add column if not exists changelog    text not null default '';
alter table public.app_releases add column if not exists download_url text;
alter table public.app_releases add column if not exists sha256       text;
alter table public.app_releases add column if not exists created_at   timestamptz not null default now();

-- какие колонки теперь есть в app_releases (для проверки)
select column_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'app_releases' order by ordinal_position;
