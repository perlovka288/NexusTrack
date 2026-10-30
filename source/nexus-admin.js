'use strict';
// NEXUS: админ-панель. Живёт только в приложении (мост window.nxAdmin даёт Electron), в браузере и на телефоне не появляется.
// Для обычных пользователей нет ни кнопки, ни пункта меню, ни горячих клавиш: единственный вход это пункт «Админ-панель» в меню профиля,
// а он виден только если логин профиля есть в списке админов.
// Права проверяются в основном процессе и в самой базе (Supabase), интерфейс лишь скрывает ненужные разделы.
(() => {
  if (!window.nxAdmin) return;
  const A = window.nxAdmin;
  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const ROLE = {superadmin: 'Главный', admin: 'Админ'};
  const PROV = {igdb: {name: 'IGDB', note: 'Основной каталог и поиск игр'}, rawg: {name: 'RAWG', note: 'Второй каталог (запасной или вместе с IGDB)'}, steam: {name: 'Steam', note: 'Поиск по магазину Steam'}};
  let root = null, me = {loggedIn: false}, tab = 'stats', allowed = '', lastLogin = null, lastOk = false;
  const fmtDate = d => { try { return new Date(d).toLocaleString('ru-RU', {dateStyle: 'medium', timeStyle: 'short'}); } catch { return ''; } };
  const num = n => Number(n || 0).toLocaleString('ru-RU');

  function close() { if (root) { root.remove(); root = null; document.removeEventListener('keydown', onKey, true); } }
  function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
  async function open() {
    if (root) return;
    root = document.createElement('div'); root.className = 'nxa'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Админ-панель');
    root.addEventListener('mousedown', e => { if (e.target === root) close(); });
    document.body.appendChild(root); document.addEventListener('keydown', onKey, true);
    try { me = await A.state(); } catch { me = {loggedIn: false}; }
    render();
  }
  const card = inner => { root.innerHTML = `<div class="nxa-card">${inner}</div>`; return root.firstChild; };
  const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } finally { if (btn.isConnected) btn.disabled = false; } };
  const msg = (el, text, ok) => { el.textContent = text || ''; el.className = 'nxa-msg' + (text ? (ok ? ' ok' : ' err') : ''); };

  // ---------- вход ----------
  function render() { if (!root) return; if (!me.loggedIn) return loginView(); panelView(); }
  function loginView() {
    const c = card(`<button class="nxa-x" type="button" aria-label="Закрыть">×</button>
      <h2>Вход для администраторов</h2><p class="nxa-sub">Доступно только администраторам NEXUS</p>
      <form id="nxa-login" autocomplete="off">
        <label>Логин<input name="u" type="text" autocomplete="username" spellcheck="false" maxlength="64" required></label>
        <label>Пароль<input name="p" type="password" autocomplete="current-password" maxlength="128" required></label>
        <div class="nxa-msg" id="nxa-lmsg"></div>
        <button class="nxa-btn pri" type="submit">Войти</button>
      </form>`);
    c.querySelector('.nxa-x').onclick = close;
    const f = c.querySelector('form'), m = c.querySelector('#nxa-lmsg');
    if (allowed) { f.elements.u.value = allowed; f.elements.p.focus(); } else f.elements.u.focus();   // логин из профиля подставляется сам
    f.onsubmit = async e => {
      e.preventDefault();
      await busy(f.querySelector('button'), async () => {
        msg(m, 'Проверяю…', true);
        try { me = await A.login(f.elements.u.value, f.elements.p.value); tab = 'stats'; render(); }
        catch (err) { msg(m, err.message); f.elements.p.value = ''; f.elements.p.focus(); }
      });
    };
  }

  // ---------- каркас панели ----------
  const isSuper = () => me.role === 'superadmin';
  function tabs() { return [['stats', 'Статистика'], ['api', 'API'], ...(isSuper() ? [['admins', 'Администраторы'], ['updates', 'Обновления']] : [])]; }
  function panelView() {
    if (!tabs().some(t => t[0] === tab) && tab !== 'password') tab = 'stats';   // обычному админу скрытые разделы недоступны
    const c = card(`<div class="nxa-head">
        <div><h2>Админ-панель</h2><div class="nxa-who"><b>${E(me.username)}</b><span class="nxa-role ${E(me.role)}">${E(ROLE[me.role] || me.role)}</span></div></div>
        <div class="nxa-headbtns"><button class="nxa-btn" id="nxa-pw" type="button">Сменить пароль</button><button class="nxa-btn" id="nxa-out" type="button">Выйти</button><button class="nxa-x" type="button" aria-label="Закрыть">×</button></div>
      </div>
      <div class="nxa-tabs" role="tablist">${tabs().map(([k, t]) => `<button type="button" role="tab" class="${k === tab ? 'on' : ''}" data-t="${k}">${E(t)}</button>`).join('')}</div>
      <div class="nxa-body" id="nxa-body"></div>`);
    c.querySelector('.nxa-x').onclick = close;
    c.querySelector('#nxa-out').onclick = async () => { try { me = await A.logout(); } catch { me = {loggedIn: false}; } render(); };
    c.querySelector('#nxa-pw').onclick = () => { tab = 'password'; panelView(); };
    c.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; panelView(); });
    const body = c.querySelector('#nxa-body');
    ({stats: statsTab, api: apiTab, admins: adminsTab, updates: updatesTab, password: passwordTab}[tab] || statsTab)(body);
  }
  // сессия истекла на сервере: возвращаем форму входа
  const guard = err => { if (/Сессия истекла/.test(err.message)) { me = {loggedIn: false}; render(); return true; } return false; };

  // ---------- статистика ----------
  async function statsTab(b) {
    b.innerHTML = '<p class="nxa-sub">Загрузка…</p>';
    try {
      const s = await A.stats();
      b.innerHTML = `<div class="nxa-stats">
          <div class="nxa-stat"><span>Всего установок</span><b>${num(s.total)}</b></div>
          <div class="nxa-stat"><span>Активных за 24 часа</span><b>${num(s.active_24h)}</b></div>
          <div class="nxa-stat"><span>Активных за 7 дней</span><b>${num(s.active_7d)}</b></div></div>
        <h3>Версии</h3>${(s.versions || []).length ? `<table class="nxa-tbl"><tbody>${s.versions.map(v => `<tr><td>${E(v.version || '—')}</td><td class="r">${num(v.cnt)}</td></tr>`).join('')}</tbody></table>` : '<p class="nxa-sub">Данных пока нет.</p>'}
        <div class="nxa-row" style="margin-top:12px"><button class="nxa-btn" id="nxa-refresh" type="button">Обновить статистику</button>${isSuper() ? '<button class="nxa-btn pri" id="nxa-goupd" type="button">Отправить обновление всем</button>' : ''}</div>`;
      b.querySelector('#nxa-refresh').onclick = () => statsTab(b);
      const go = b.querySelector('#nxa-goupd'); if (go) go.onclick = () => { tab = 'updates'; panelView(); };
    } catch (err) { if (!guard(err)) b.innerHTML = `<div class="nxa-msg err">${E(err.message)}</div>`; }
  }

  // ---------- переключение API (можно выбрать несколько) ----------
  async function apiTab(b) {
    b.innerHTML = '<p class="nxa-sub">Загрузка…</p>';
    try {
      const {provider, providers} = await A.getProvider();
      const isDefault = !provider.length, current = isDefault ? ['igdb', 'steam'] : provider.slice();   // «не выбрано» работает как IGDB + Steam
      const pick = new Set(current), same = () => pick.size === current.length && current.every(x => pick.has(x));
      const names = l => l.map(x => (PROV[x] || {}).name || x).join(' + ');
      b.innerHTML = `<p class="nxa-sub">${isDefault ? 'Провайдер не выбран: работает IGDB + Steam.' : 'Активно: <b>' + E(names(provider)) + '</b>.'} Можно выбрать несколько: поиск объединит результаты, дубли склеятся.</p>
        <div class="nxa-prov" role="group">${providers.map(p => `<button type="button" role="checkbox" aria-checked="${pick.has(p)}" class="${pick.has(p) ? 'on' : ''}" data-p="${E(p)}"><b>${E(PROV[p].name)}</b><span>${E(PROV[p].note)}</span></button>`).join('')}</div>
        <div class="nxa-msg" id="nxa-pm"></div><button class="nxa-btn pri" id="nxa-save" type="button" disabled>Применить для всех</button>`;
      const save = b.querySelector('#nxa-save'), m = b.querySelector('#nxa-pm');
      b.querySelectorAll('[data-p]').forEach(x => x.onclick = () => {
        const k = x.dataset.p;
        if (pick.has(k)) { if (pick.size === 1) return msg(m, 'Нужно оставить хотя бы один источник.'); pick.delete(k); } else pick.add(k);
        x.classList.toggle('on', pick.has(k)); x.setAttribute('aria-checked', pick.has(k));
        save.disabled = same(); msg(m, '');
      });
      save.onclick = () => busy(save, async () => {
        try { await A.setProvider(providers.filter(p => pick.has(p))); msg(m, 'Сохранено. Приложения подхватят выбор в течение 10 минут.', true); setTimeout(() => tab === 'api' && root && apiTab(b), 900); }
        catch (err) { if (!guard(err)) msg(m, err.message); }
      });
    } catch (err) { if (!guard(err)) b.innerHTML = `<div class="nxa-msg err">${E(err.message)}</div>`; }
  }

  // ---------- администраторы (только superadmin) ----------
  async function adminsTab(b) {
    b.innerHTML = '<p class="nxa-sub">Загрузка…</p>';
    try {
      const list = await A.listAdmins(); let role = 'admin';
      b.innerHTML = `<table class="nxa-tbl"><tbody>${list.map(a => `<tr><td>${E(a.username)}</td><td><span class="nxa-role ${E(a.role)}">${E(ROLE[a.role] || a.role)}</span></td><td class="r">${a.username === me.username ? '<span class="nxa-sub">это вы</span>' : `<button class="nxa-btn sm danger" type="button" data-del="${E(a.id)}" data-name="${E(a.username)}">Удалить</button>`}</td></tr>`).join('')}</tbody></table>
        <h3>Добавить администратора</h3>
        <form id="nxa-add" autocomplete="off">
          <div class="nxa-two"><label>Логин<input name="u" type="text" maxlength="32" spellcheck="false" autocomplete="off" required></label>
          <label>Пароль (от 8 символов)<input name="p" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></label></div>
          <div class="nxa-lbl">Роль</div>
          <div class="nxa-seg" role="radiogroup" aria-label="Роль"><button type="button" role="radio" data-r="superadmin" aria-checked="false">Главный (superadmin)</button><button type="button" role="radio" data-r="admin" aria-checked="true" class="on">Админ (admin)</button></div>
          <div class="nxa-msg" id="nxa-am"></div><button class="nxa-btn pri" type="submit">Добавить</button>
        </form>`;
      const f = b.querySelector('#nxa-add'), m = b.querySelector('#nxa-am');
      f.querySelectorAll('[data-r]').forEach(x => x.onclick = () => { role = x.dataset.r; f.querySelectorAll('[data-r]').forEach(y => { y.classList.toggle('on', y === x); y.setAttribute('aria-checked', y === x); }); });
      f.onsubmit = e => { e.preventDefault(); busy(f.querySelector('button[type=submit]'), async () => {
        try { await A.createAdmin(f.elements.u.value, f.elements.p.value, role); adminsTab(b); } catch (err) { if (!guard(err)) msg(m, err.message); }
      }); };
      b.querySelectorAll('[data-del]').forEach(x => x.onclick = () => {
        if (!confirm(`Удалить администратора ${x.dataset.name}?`)) return;
        busy(x, async () => { try { await A.deleteAdmin(x.dataset.del); adminsTab(b); } catch (err) { if (!guard(err)) alert(err.message); } });
      });
    } catch (err) { if (!guard(err)) b.innerHTML = `<div class="nxa-msg err">${E(err.message)}</div>`; }
  }

  // ---------- OTA-обновления (только superadmin) ----------
  const vcmp = (a, b) => { const p = v => String(v).split('.').map(x => parseInt(x, 10) || 0); const A = p(a), B = p(b); for (let i = 0; i < 3; i++) { const d = (A[i] || 0) - (B[i] || 0); if (d) return d < 0 ? -1 : 1; } return 0; };
  const mbs = n => (n / 1048576).toFixed(1) + ' МБ';
  const KIND = {asar: 'app.asar (код, интерфейс, ресурсы, библиотеки)', zip: 'ZIP (файлы поверх папки приложения)', exe: 'EXE (установщик)'};
  let flash = '';
  A.onProgress(p => {
    const el = root && root.querySelector('#nxa-prog'); if (!el) return;
    const bar = el.querySelector('i'), t = el.querySelector('span');
    el.hidden = false;
    if (p.stage === 'build') { t.textContent = 'Собираю app.asar из ваших файлов…'; bar.style.width = '0'; }
    else if (p.stage === 'hash') { t.textContent = 'Считаю контрольную сумму…'; bar.style.width = '0'; }
    else if (p.stage === 'upload') { t.textContent = `Загружаю: ${mbs(p.received)} из ${mbs(p.total)}`; bar.style.width = (p.total ? Math.min(100, p.received / p.total * 100) : 0) + '%'; }
    else if (p.stage === 'publish') { t.textContent = 'Публикую релиз…'; bar.style.width = '100%'; }
  });

  async function updatesTab(b) {
    b.innerHTML = '<p class="nxa-sub">Загрузка…</p>';
    try {
      const {releases, active} = await A.listReleases();
      const top = releases.slice().sort((x, y) => vcmp(y.version, x.version))[0];
      const shown = active || (top && top.version) || '';
      const note = flash; flash = '';
      const sorted = releases.slice().sort((x, y) => vcmp(y.version, x.version));
      b.innerHTML = `${note ? `<div class="nxa-msg ok">${E(note)}</div>` : ''}
        <h3 style="margin-top:0">1. Отправить новую версию со своего компьютера</h3>
        <p class="nxa-sub">Нажмите кнопку и выберите <b>папку с файлами приложения</b> (где лежат package.json и main.js, у вас это <b>source</b>) или готовый файл <b>app.asar</b>. NEXUS сам всё соберёт, проверит и загрузит. GitHub не нужен.</p>
        <div class="nxa-row"><button class="nxa-btn pri" id="nxa-pf" type="button">Выбрать папку с файлами</button><button class="nxa-btn" id="nxa-pa" type="button">Выбрать файл (app.asar / zip / exe)</button></div>
        <div id="nxa-prep"></div>
        <h3>2. Выбрать, какую версию получат все</h3>
        <p class="nxa-sub">${shown ? `Сейчас всем выдаётся <b>v${E(shown)}</b>${active ? '' : ' (автоматически самая новая)'}.` : 'Релизов пока нет.'} Выберите версию из списка и нажмите «Отправить всем»: у кого стоит другая, появится окно «Обновить сейчас» (для старой версии это откат).</p>
        ${sorted.length ? `<div class="nxa-pickver"><select id="nxa-sel" aria-label="Версия">${sorted.map(r => `<option value="${E(r.version)}"${r.version === shown ? ' selected' : ''}>v${E(r.version)}  ·  ${E(fmtDate(r.created_at))}${r.version === shown ? '  ·  сейчас у всех' : ''}</option>`).join('')}</select>
          <button class="nxa-btn pri" id="nxa-send" type="button">Отправить всем</button><button class="nxa-btn danger" id="nxa-rm" type="button">Удалить</button></div>
          <p class="nxa-sub" id="nxa-chlog"></p>` : ''}
        ${active ? '<button class="nxa-btn" id="nxa-auto" type="button" style="margin-top:6px">Вернуть авто: всегда самая новая</button>' : ''}
        <div class="nxa-msg" id="nxa-lm"></div>
        <details class="nxa-more"><summary>Вручную по ссылке (если файл больше 50 МБ)</summary>
          <form id="nxa-rel" autocomplete="off">
            <div class="nxa-two"><label>Версия<input name="v" type="text" placeholder="например, 3.3.8" pattern="\\d+\\.\\d+\\.\\d+" required></label>
            <label>SHA-256 файла<input name="h" type="text" placeholder="64 hex-символа" spellcheck="false" maxlength="64" pattern="[0-9a-fA-F]{64}" required></label></div>
            <label>Ссылка на файл (https; .asar, .zip или .exe)<input name="u" type="url" placeholder="https://…/app.asar" required></label>
            <label>Список изменений<textarea name="c" rows="3" maxlength="5000"></textarea></label>
            <p class="nxa-sub">Хэш: PowerShell → <code>Get-FileHash app.asar -Algorithm SHA256</code>.</p><div class="nxa-msg" id="nxa-rm2"></div><button class="nxa-btn pri" type="submit">Опубликовать и выдать всем</button>
          </form></details>`;
      const lm = b.querySelector('#nxa-lm'), prep = b.querySelector('#nxa-prep');
      const reload = () => updatesTab(b);

      // выбор папки / файла
      const pick = mode => async ev => {
        const btn = ev.currentTarget; msg(lm, '');
        await busy(btn, async () => {
          try {
            prep.innerHTML = '<div class="nxa-bar" id="nxa-prog"><span>Готовлю…</span><div><i></i></div></div>';
            const r = await A.pickRelease(mode);
            if (!r) { prep.innerHTML = ''; return; }
            showPrep(r);
          } catch (err) { prep.innerHTML = ''; if (!guard(err)) msg(lm, err.message); }
        });
      };
      b.querySelector('#nxa-pf').onclick = pick('folder');
      b.querySelector('#nxa-pa').onclick = pick('file');

      function showPrep(r) {
        prep.innerHTML = `<div class="nxa-prep">
          <div class="nxa-kv"><span>Источник</span><b>${E(r.from)}</b></div>
          <div class="nxa-kv"><span>Тип</span><b>${E(KIND[r.kind] || r.kind)}</b></div>
          <div class="nxa-kv"><span>Версия</span>${r.needVersion ? '<input id="nxa-ver" type="text" placeholder="например, 3.3.15" pattern="\\d+\\.\\d+\\.\\d+" maxlength="20">' : `<b>v${E(r.version)}</b>`}</div>
          <div class="nxa-kv"><span>Размер</span><b>${E(mbs(r.size))}</b></div>
          <div class="nxa-kv"><span>SHA-256</span><code>${E(r.sha256.slice(0, 16))}…</code></div>
          ${r.notes.map(n => `<p class="nxa-note${n.startsWith('⚠') ? ' warn' : ''}">${E(n)}</p>`).join('')}
          <label>Что нового (увидят пользователи в окне обновления)<textarea id="nxa-chg" rows="3" maxlength="5000" placeholder="Например: исправлены ошибки, добавлен новый каталог"></textarea></label>
          <label class="nxa-chk"><input type="checkbox" id="nxa-act" checked> Сразу выдать всем</label>
          <div class="nxa-bar" id="nxa-prog" hidden><span></span><div><i></i></div></div>
          <div class="nxa-msg" id="nxa-um"></div>
          <div class="nxa-row"><button class="nxa-btn pri" id="nxa-go" type="button"${r.duplicate ? ' disabled' : ''}>Загрузить и опубликовать</button><button class="nxa-btn" id="nxa-no" type="button">Отмена</button></div></div>`;
        const um = prep.querySelector('#nxa-um'), go = prep.querySelector('#nxa-go');
        prep.querySelector('#nxa-no').onclick = async () => { try { await A.cancelRelease(); } catch {} prep.innerHTML = ''; };
        go.onclick = () => busy(go, async () => {
          const ver = r.needVersion ? prep.querySelector('#nxa-ver').value.trim() : r.version, act = prep.querySelector('#nxa-act').checked;
          if (!/^\d+\.\d+\.\d+$/.test(ver)) return msg(um, 'Укажите версию в формате 1.2.3');
          if (!confirm(act ? `Опубликовать v${ver} и выдать ВСЕМ пользователям?` : `Опубликовать v${ver} (без выдачи всем)?`)) return;
          try {
            msg(um, '');
            const res = await A.uploadRelease({version: ver, changelog: prep.querySelector('#nxa-chg').value, activate: act});
            flash = res.activated ? `Готово: v${res.version} загружена и выдаётся всем. Окно обновления появится у пользователей в течение 20 минут.` : `Готово: v${res.version} загружена. Чтобы разослать её, нажмите «Выдать всем» в списке.`;
            reload();
          } catch (err) { if (!guard(err)) msg(um, err.message); }
        });
      }

      // выбор версии, которую получают все; удаление
      const sel = b.querySelector('#nxa-sel');
      if (sel) {
        const showLog = () => { const r = releases.find(x => x.version === sel.value); b.querySelector('#nxa-chlog').textContent = r && r.changelog ? 'Что нового: ' + r.changelog : ''; };
        sel.onchange = showLog; showLog();
        const send = b.querySelector('#nxa-send');
        send.onclick = () => {
          const v = sel.value, back = top && vcmp(v, top.version) < 0;
          if (v === shown) return msg(lm, `v${v} уже выдаётся всем.`, true);
          if (!confirm(back ? `Откатить ВСЕХ пользователей на v${v}? У тех, у кого версия новее, появится окно установки этой версии.` : `Отправить v${v} всем пользователям?`)) return;
          busy(send, async () => { try { await A.activateRelease(v); flash = `Готово: всем отправлена v${v}. Окно «Обновить сейчас» появится у пользователей в течение 20 минут.`; reload(); } catch (err) { if (!guard(err)) msg(lm, err.message); } });
        };
        const del = b.querySelector('#nxa-rm');
        del.onclick = () => {
          const v = sel.value;
          if (!confirm(`Убрать v${v} из списка релизов? Пользователям она больше предлагаться не будет.`)) return;
          busy(del, async () => { try { await A.deleteRelease(v); flash = `v${v} удалена из списка.`; reload(); } catch (err) { if (!guard(err)) msg(lm, err.message); } });
        };
      }
      const auto = b.querySelector('#nxa-auto');
      if (auto) auto.onclick = () => busy(auto, async () => { try { await A.activateRelease(''); flash = 'Включён автоматический режим: выдаётся самая новая версия.'; reload(); } catch (err) { if (!guard(err)) msg(lm, err.message); } });

      // запасной путь: по готовой ссылке
      const f = b.querySelector('#nxa-rel'), m = b.querySelector('#nxa-rm2');
      f.onsubmit = e => { e.preventDefault(); busy(f.querySelector('button[type=submit]'), async () => {
        try { await A.publishRelease({version: f.elements.v.value, changelog: f.elements.c.value, url: f.elements.u.value, sha256: f.elements.h.value, activate: true}); flash = `Готово: v${f.elements.v.value.trim()} опубликована и выдаётся всем.`; reload(); }
        catch (err) { if (!guard(err)) msg(m, err.message); }
      }); };
    } catch (err) { if (!guard(err)) b.innerHTML = `<div class="nxa-msg err">${E(err.message)}</div>`; }
  }

  // ---------- смена пароля ----------
  function passwordTab(b) {
    b.innerHTML = `<form id="nxa-pwf" autocomplete="off"><label>Текущий пароль<input name="o" type="password" autocomplete="current-password" required></label>
      <div class="nxa-two"><label>Новый пароль (от 8 символов)<input name="n" type="password" minlength="8" autocomplete="new-password" required></label>
      <label>Повторите новый пароль<input name="r" type="password" minlength="8" autocomplete="new-password" required></label></div>
      <div class="nxa-msg" id="nxa-wm"></div><button class="nxa-btn pri" type="submit">Сменить пароль</button></form>`;
    const f = b.querySelector('form'), m = b.querySelector('#nxa-wm');
    f.onsubmit = e => { e.preventDefault(); if (f.elements.n.value !== f.elements.r.value) return msg(m, 'Новые пароли не совпадают.');
      busy(f.querySelector('button'), async () => { try { await A.changePassword(f.elements.o.value, f.elements.n.value); f.reset(); msg(m, 'Пароль изменён.', true); } catch (err) { if (!guard(err)) msg(m, err.message); } }); };
  }

  // ---------- пункт «Админ-панель» в меню профиля: виден только если логин профиля есть среди админов ----------
  async function check(force) {
    let login = '';
    try { const r = await fetch('/api/profile', {cache: 'no-store'}); login = String((await r.json()).login || '').trim(); } catch {}
    if (!force && login === lastLogin) return lastOk;
    let ok = false;
    if (login) { try { ok = !!(await A.canShow(login)); } catch {} }
    lastLogin = login; lastOk = ok; allowed = ok ? login : '';
    return ok;
  }
  window.nxAdminUI = {open: () => { if (allowed) open(); }, check, recheck: () => check(true), visible: () => !!allowed};
  setTimeout(() => check().catch(() => {}), 1500);

})();
