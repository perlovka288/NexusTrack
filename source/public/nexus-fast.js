'use strict';
// NEXUS: быстрые карточки. Список рисуется сразу и лёгким, а данные страницы игры подгружаются заранее,
// пока курсор над карточкой (или в момент нажатия), поэтому страница игры открывается почти мгновенно.
(() => {
  const warmed = new Set(); let timer = 0, last = '';
  function warm(id) {
    if (!id || warmed.has(id) || warmed.size > 80) return; warmed.add(id);
    try {
      if (typeof isSteam === 'function' && isSteam(id)) {
        if (typeof details === 'function') details(id);                        // описание, скриншоты, разработчик (результат кэшируется)
        const im = new Image(); im.decoding = 'async'; im.src = CDN + id + '/library_hero.jpg';   // баннер страницы игры
      } else if (typeof extInfo === 'function' && typeof info !== 'undefined' && !info[id]) extInfo(id);
    } catch {}
  }
  const cardOf = e => (e.target && e.target.closest) ? e.target.closest('.gc[data-id]') : null;
  document.addEventListener('pointerover', e => {
    const gc = cardOf(e); if (!gc) return; const id = gc.dataset.id; if (id === last) return; last = id;
    clearTimeout(timer); timer = setTimeout(() => warm(id), 140);        // небольшая задержка, чтобы не грузить всё подряд при пролёте мыши
  }, {passive: true});
  document.addEventListener('pointerout', e => { if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest('.gc')) { clearTimeout(timer); last = ''; } }, {passive: true});
  document.addEventListener('pointerdown', e => { const gc = cardOf(e); if (gc) warm(gc.dataset.id); }, {passive: true, capture: true});
})();
