'use strict';
// Окно обновления NEXUS: показывает версию и список изменений, по кнопке скачивает и применяет обновление.
(() => {
  const $ = id => document.getElementById(id), st = $('st'), go = $('go'), later = $('later');
  const say = (t, err) => { st.textContent = t || ''; st.className = 'st' + (err ? ' err' : ''); };
  const mb = n => (n / 1048576).toFixed(1) + ' МБ';
  if (!window.nxUpdate) { say('Окно доступно только в приложении NEXUS.', true); go.disabled = later.disabled = true; return; }
  nxUpdate.info().then(i => {
    $('nv').textContent = 'v' + i.version; $('cv').textContent = 'v' + i.current; $('log').textContent = i.changelog;
    if (i.downgrade) { document.querySelector('.tag').textContent = 'Другая версия'; document.querySelector('h1').firstChild.textContent = 'Установить NEXUS '; document.title = 'Смена версии NEXUS'; }
  }).catch(e => say(e.message, true));
  nxUpdate.onProgress(p => {
    $('bar').style.display = 'block';
    const pct = p.total ? Math.min(100, p.received / p.total * 100) : 0;
    $('fill').style.width = pct + '%';
    say(p.total ? `Скачивание: ${mb(p.received)} из ${mb(p.total)}` : `Скачивание: ${mb(p.received)}`);
  });
  later.onclick = () => nxUpdate.later().catch(() => {});
  go.onclick = async () => {
    go.disabled = later.disabled = true; say('Подключение…'); $('bar').style.display = 'block';
    try { await nxUpdate.start(); say('Устанавливаю и перезапускаю NEXUS…'); }
    catch (e) { say(e.message, true); go.disabled = later.disabled = false; $('bar').style.display = 'none'; }
  };
})();
