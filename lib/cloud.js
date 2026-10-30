'use strict';
// Облако NEXUS (Supabase): счётчик установок, вход админов, выбор API, OTA-релизы.
// Работает только в основном процессе Electron: интерфейс обращается сюда через IPC (см. main.js),
// поэтому админ-функции недоступны ни обычным пользователям, ни мобильному веб-доступу.
const {createClient} = require('@supabase/supabase-js');
const Store = require('electron-store');
const {randomUUID} = require('crypto');
let fs; try { fs = require('original-fs'); } catch { fs = require('fs'); }   // original-fs: файлы .asar читаем как обычные
const https = require('https');

const SUPABASE_URL = 'https://xkslwlopnwmtozqfkngb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_td1DE9VGtsEnSDRBDy13dw_ddpLJz3c';
const PROVIDERS = ['igdb', 'rawg', 'steam'];
const VER_RE = /^\d+\.\d+\.\d+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {auth: {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false}});

let store = null, session = null, provider = [], bootstrapError = '';

// ----- device_id (UUID v4) в electron-store -----
function deviceId() {
  store = store || new Store({name: 'nexus-device'});
  let id = store.get('device_id');
  if (!UUID_RE.test(String(id || ''))) { id = randomUUID(); store.set('device_id', id); }
  return id;
}

// ----- русские сообщения для кодов ошибок базы -----
const MSG = {
  nx_unauthorized: 'Сессия истекла. Войдите заново.',
  nx_forbidden: 'Недостаточно прав для этого действия.',
  nx_exists: 'Такая запись уже существует.',
  nx_bad_sha: 'Нужен корректный SHA-256 файла (64 символа).',
  nx_bad_username: 'Логин: 3–32 символа, только латиница, цифры и _ . -',
  nx_bad_password: 'Пароль должен быть от 8 до 128 символов.',
  nx_bad_role: 'Недопустимая роль.',
  nx_bad_provider: 'Недопустимый провайдер.',
  nx_bad_version: 'Версия должна быть в формате 1.2.3',
  nx_bad_url: 'Ссылка на файл должна начинаться с https://',
  nx_no_release: 'Такой версии нет в списке релизов.',
  nx_bad_ext: 'Поддерживаются файлы .asar, .zip и .exe.',
  nx_self_delete: 'Нельзя удалить самого себя.',
  nx_last_super: 'Нельзя удалить последнего главного администратора.',
  nx_wrong_old: 'Текущий пароль указан неверно.',
  nx_default_password_not_set: 'Главный администратор ещё не создан: задайте пароль в supabase/schema.sql (функция nexus_bootstrap_admin) и выполните скрипт заново.'
};
function friendly(err) {
  const raw = String((err && err.message) || err || '');
  for (const k of Object.keys(MSG)) if (raw.includes(k)) return MSG[k];
  if (/fetch failed|network|ENOTFOUND|ETIMEDOUT|ECONN/i.test(raw)) return 'Нет связи с сервером. Проверьте интернет.';
  if (/Could not find the function|PGRST202/i.test(raw)) {
    const fn = (/function public\.(\w+)/i.exec(raw) || [])[1] || '';
    if (/^admin_(release_ticket|set_active_release|delete_release)$/.test(fn)) return 'В Supabase не выполнен скрипт supabase/add-release-upload.sql.';
    if (fn === 'admin_login_exists') return 'В Supabase не выполнен скрипт supabase/add-login-check.sql.';
    return 'В Supabase не выполнен нужный скрипт (' + (fn || 'schema.sql') + '). Выполните supabase/schema.sql и остальные файлы из папки supabase.';
  }
  return 'Ошибка сервера: ' + raw.slice(0, 160);
}
async function rpc(fn, args) {
  let r;
  try { r = await sb.rpc(fn, args || {}); } catch (e) { throw new Error(friendly(e)); }
  if (r.error) throw new Error(friendly(r.error));
  return r.data;
}

// ----- аналитика: upsert в user_sessions -----
async function touchSession(appVersion) {
  const ping = await sb.rpc('nexus_ping', {p_device: deviceId(), p_version: String(appVersion || '').slice(0, 32)});
  if (!ping.error) return;
  if (!/nexus_ping|schema cache|could not find/i.test(String(ping.error.message || '') + String(ping.error.code || ''))) throw new Error(friendly(ping.error));
  const {error} = await sb.from('user_sessions').upsert(
    {device_id: deviceId(), app_version: String(appVersion || ''), last_seen: new Date().toISOString()},
    {onConflict: 'device_id'});
  if (error) throw new Error(friendly(error));
}
let timer = null;
function startSession(appVersion) {
  const tick = () => touchSession(appVersion).catch(() => {});
  tick();
  clearInterval(timer);
  timer = setInterval(tick, 30 * 60 * 1000);   // приложение живёт в трее днями: обновляем last_seen, чтобы «активные за 24 ч» были верными
  timer.unref?.();
}

// ----- главный админ kostlim создаётся автоматически -----
async function ensureDefaultAdmin() {
  try { await rpc('nexus_bootstrap_admin'); bootstrapError = ''; }
  catch (e) { bootstrapError = e.message; throw e; }
}

// ----- вход / роли -----
const view = () => session ? {loggedIn: true, username: session.username, role: session.role} : {loggedIn: false};
const need = (superOnly) => {
  if (!session) throw new Error(MSG.nx_unauthorized);
  if (superOnly && session.role !== 'superadmin') throw new Error(MSG.nx_forbidden);
  return session.token;
};
async function login(username, password) {
  username = String(username || '').trim().slice(0, 64); password = String(password || '').slice(0, 128);
  if (!username || !password) throw new Error('Введите логин и пароль.');
  if (bootstrapError) { try { await ensureDefaultAdmin(); } catch {} }   // вдруг скрипт в Supabase уже обновили
  const r = await rpc('admin_login', {p_username: username, p_password: password});
  if (r && r.error === 'locked') throw new Error(`Слишком много попыток. Повторите через ${r.minutes} мин.`);
  if (!r || r.error || !r.token) throw new Error(bootstrapError || 'Неверный логин или пароль.');
  session = {token: r.token, username: r.username, role: r.role === 'superadmin' ? 'superadmin' : 'admin'};
  persist();
  return view();
}
async function logout() {
  const t = session && session.token; session = null; persist();
  if (t) { try { await sb.rpc('admin_logout', {p_token: t}); } catch {} }
  return view();
}
const isSuper = () => !!session && session.role === 'superadmin';

// ----- сессия переживает перезапуск (на срок жизни токена в базе), чтобы пароль не вводить при каждом запуске -----
const SESSION_MAX_MS = 11 * 3600 * 1000;
let restored = false;
function persist() {
  try { store = store || new Store({name: 'nexus-device'}); if (session) store.set('adminSession', {...session, at: Date.now()}); else store.delete('adminSession'); } catch {}
}
async function restore() {
  if (session || restored) return view();
  restored = true;
  let s = null;
  try { store = store || new Store({name: 'nexus-device'}); s = store.get('adminSession'); } catch {}
  if (!s || !s.token || !s.username || Date.now() - Number(s.at || 0) > SESSION_MAX_MS) { try { store.delete('adminSession'); } catch {} return view(); }
  try {
    await rpc('admin_stats', {p_token: s.token});   // дешёвая проверка, что токен ещё жив
    session = {token: s.token, username: s.username, role: s.role === 'superadmin' ? 'superadmin' : 'admin'};
  } catch (e) {
    if (e.message === MSG.nx_unauthorized) { try { store.delete('adminSession'); } catch {} }
    else restored = false;   // нет сети: попробуем в следующий раз
  }
  return view();
}

// ----- есть ли такой логин среди админов (для показа пункта меню). Права при этом НЕ выдаются: нужен пароль -----
async function isAdminLogin(login) {
  login = String(login || '').trim().slice(0, 64);
  if (!/^[A-Za-z0-9_.-]{3,64}$/.test(login)) return false;
  let cache = {};
  try { store = store || new Store({name: 'nexus-device'}); cache = store.get('adminLogins') || {}; } catch {}
  const key = login.toLowerCase();
  try {
    const ok = (await rpc('admin_login_exists', {p_username: login})) === true;
    if (ok) cache[key] = 1; else delete cache[key];
    try { store.set('adminLogins', cache); } catch {}
    return ok;
  } catch { return !!cache[key]; }   // нет сети или скрипт ещё не выполнен: берём последний известный ответ
}

// ----- статистика, API, админы, релизы -----
const stats = async () => rpc('admin_stats', {p_token: need(false)});
const changePassword = async (oldPass, newPass) => rpc('admin_change_password', {p_token: need(false), p_old: String(oldPass || ''), p_new: String(newPass || '')});
const listAdmins = async () => rpc('admin_list_admins', {p_token: need(true)});
const createAdmin = async (username, password, role) => rpc('admin_create_admin', {p_token: need(true), p_username: String(username || '').trim(), p_password: String(password || ''), p_role: role === 'superadmin' ? 'superadmin' : 'admin'});
const deleteAdmin = async id => rpc('admin_delete_admin', {p_token: need(true), p_id: String(id || '')});
const publishRelease = async (r) => {
  const sha = String(r.sha256 || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error('Укажите SHA-256 файла (64 символа). Без него приложение не установит обновление.');
  return rpc('admin_publish_release', {p_token: need(true), p_version: String(r.version || '').trim(), p_changelog: String(r.changelog || '').slice(0, 5000), p_url: String(r.url || '').trim(), p_sha256: sha});
};

// Хранится строкой: «v2:igdb,steam» (несколько источников). Старый формат: одно слово (igdb означал IGDB + Steam).
function parseProviders(v) {
  v = String(v == null ? '' : v).trim();
  if (v.startsWith('v2:')) return [...new Set(v.slice(3).split(',').map(x => x.trim()).filter(x => PROVIDERS.includes(x)))];
  if (v === 'igdb') return ['igdb', 'steam'];
  return PROVIDERS.includes(v) ? [v] : [];
}
async function refreshProvider() {
  try {
    const {data, error} = await sb.from('app_settings').select('value').eq('key', 'active_provider').maybeSingle();
    if (!error) provider = parseProviders(data && data.value);
  } catch {}
  return provider;
}
async function setProvider(list) {
  list = [...new Set((Array.isArray(list) ? list : [list]).map(String))];
  if (!list.length || list.some(x => !PROVIDERS.includes(x))) throw new Error(MSG.nx_bad_provider);
  await rpc('admin_set_provider', {p_token: need(false), p_provider: 'v2:' + PROVIDERS.filter(x => list.includes(x)).join(',')});
  provider = PROVIDERS.filter(x => list.includes(x)); return provider;
}
const cachedProvider = () => provider;

async function listReleases(limit = 10) {
  const {data, error} = await sb.from('app_releases').select('version,changelog,download_url,sha256,created_at').order('created_at', {ascending: false}).limit(limit);
  if (error) throw new Error(friendly(error));
  return data || [];
}
// версия, которую админ выдал всем вручную ('' = автоматически самая новая)
async function activeVersion() {
  try {
    const {data, error} = await sb.from('app_settings').select('value').eq('key', 'active_release').maybeSingle();
    if (!error && data && VER_RE.test(String(data.value || ''))) return data.value;
  } catch {}
  return '';
}

// ----- сравнение версий и поиск релиза, который нужно раздавать -----
function cmp(a, b) {
  const p = v => String(v || '').replace(/^v/i, '').split('.').map(x => parseInt(x, 10) || 0);
  const A = p(a), B = p(b);
  for (let i = 0; i < Math.max(A.length, B.length, 3); i++) { const d = (A[i] || 0) - (B[i] || 0); if (d) return d < 0 ? -1 : 1; }
  return 0;
}
const usable = r => VER_RE.test(r.version) && /^https:\/\//i.test(r.download_url) && /^[0-9a-f]{64}$/i.test(r.sha256 || '');
// Если админ выбрал версию вручную, раздаём именно её (в том числе более старую: откат). Иначе самую новую.
async function latestRelease() {
  const all = (await listReleases(50)).filter(usable);
  const pin = await activeVersion();
  if (pin) { const r = all.find(x => x.version === pin); if (r) return {...r, pinned: true}; }
  return all.sort((a, b) => cmp(b.version, a.version))[0] || null;
}

// ----- загрузка файла релиза в Supabase Storage (бакет releases) -----
// Админ получает одноразовый «билет» на имя файла: без него загрузка в бакет закрыта, а перезаписать чужой файл нельзя.
const STORAGE_PREFIX = SUPABASE_URL + '/storage/v1/object/public/releases/';
async function uploadRelease(file, version, ext, onProgress) {
  const t = need(true);
  const name = await rpc('admin_release_ticket', {p_token: t, p_version: version, p_ext: ext});
  if (!/^[A-Za-z0-9._-]{5,120}$/.test(String(name || ''))) throw new Error('Сервер вернул неверное имя файла.');
  const size = fs.statSync(file).size;
  if (!size) throw new Error('Файл пустой.');
  const mime = ext === 'zip' ? 'application/zip' : 'application/octet-stream';
  await new Promise((ok, no) => {
    const u = new URL(SUPABASE_URL + '/storage/v1/object/releases/' + name);
    const req = https.request({method: 'POST', hostname: u.hostname, path: u.pathname, headers: {
      apikey: SUPABASE_ANON_KEY, authorization: 'Bearer ' + SUPABASE_ANON_KEY, 'content-type': mime, 'content-length': size, 'cache-control': '3600', 'x-upsert': 'false'}}, res => {
      let body = ''; res.on('data', c => { body += c; if (body.length > 4000) body = body.slice(0, 4000); });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) return ok();
        if (res.statusCode === 413 || /exceeded the maximum|too large/i.test(body)) return no(new Error('Файл больше лимита Supabase Storage (на бесплатном тарифе 50 МБ). Загрузите его на GitHub Releases и вставьте ссылку в разделе «Вручную по ссылке».'));
        if (res.statusCode === 400 || res.statusCode === 403 || res.statusCode === 404) return no(new Error('Хранилище не готово: выполните в Supabase SQL Editor файл supabase/add-release-upload.sql. (' + res.statusCode + ')'));
        no(new Error('Хранилище ответило ошибкой ' + res.statusCode));
      });
    });
    req.on('error', e => no(new Error(friendly(e))));
    req.setTimeout(10 * 60 * 1000, () => req.destroy(new Error('Превышено время загрузки.')));
    let sent = 0, last = 0; const rs = fs.createReadStream(file, {highWaterMark: 256 * 1024});
    rs.on('data', c => { sent += c.length; const now = Date.now(); if (onProgress && now - last > 120) { last = now; onProgress({received: sent, total: size}); } });
    rs.on('error', e => req.destroy(e)); rs.on('end', () => onProgress && onProgress({received: size, total: size}));
    rs.pipe(req);
  });
  return STORAGE_PREFIX + name;
}
const setActiveRelease = async version => rpc('admin_set_active_release', {p_token: need(true), p_version: String(version || '')});
const deleteRelease = async version => rpc('admin_delete_release', {p_token: need(true), p_version: String(version || '')});

function flag(key, val) {
  try { store = store || new Store({name: 'nexus-device'}); if (val === undefined) return store.get('flag.' + key); if (val === null) store.delete('flag.' + key); else store.set('flag.' + key, val); } catch {}
}
module.exports = {flag, PROVIDERS, deviceId, touchSession, startSession, ensureDefaultAdmin, login, logout, state: view, restore, isAdminLogin, isSuper,
  stats, changePassword, listAdmins, createAdmin, deleteAdmin, publishRelease, listReleases, latestRelease, activeVersion, uploadRelease, setActiveRelease, deleteRelease,
  refreshProvider, setProvider, cachedProvider, cmp, bootstrapError: () => bootstrapError};
