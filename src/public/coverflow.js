'use strict';
/*
 * NEXUS coverflow carousel.
 * Vanilla-JS port of the React <CoverflowCarousel /> component used in the
 * catalog: same ring folding, tilt/depth ramp, drag inertia and keyboard
 * controls. The live app has no React/Tailwind build step, so this file is the
 * runtime implementation; the original .tsx source lives in ui-kit/.
 */
(function () {
  const CHEV_L = '<path d="m15 18-6-6 6-6"/>';
  const CHEV_R = '<path d="m9 18 6-6-6-6"/>';
  const icon = p => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const reduceMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const split = v => String(v || '').split(/\s+/).filter(Boolean);

  function create(host, options) {
    if (!host || !options || !Array.isArray(options.slides) || !options.slides.length) return null;

    const o = Object.assign({
      rotate: 44,
      depth: 0.6,
      perspective: 3,
      falloff: 0.56,
      fade: 0.1,
      cardWidth: 'clamp(148px, 22vw, 260px)',
      gap: 0.05,
      loop: true,
      showCaption: false,
      showPagination: false,
      showNavigation: false,
      label: 'Карусель',
      className: '',
      cardClassName: '',
      padding: '',
    }, options);

    const slides = o.slides;
    const count = slides.length;

    host.innerHTML = '';
    host.classList.add('nxcf');
    split(o.className).forEach(c => host.classList.add(c));
    host.style.setProperty('--cf-card', o.cardWidth);
    host.style.setProperty('--cf-persp', String(o.perspective));
    if (o.padding) host.style.setProperty('--cf-pad', o.padding);
    host.setAttribute('role', 'region');
    host.setAttribute('aria-roledescription', 'carousel');
    host.setAttribute('aria-label', o.label);

    const viewport = document.createElement('div');
    viewport.className = 'nxcf-viewport';

    const frame = document.createElement('div');
    frame.className = 'nxcf-frame';
    frame.tabIndex = 0;

    const stage = document.createElement('div');
    stage.className = 'nxcf-stage';
    frame.appendChild(stage);
    viewport.appendChild(frame);

    const cardEls = [];
    slides.forEach((slide, index) => {
      const tpl = document.createElement('template');
      tpl.innerHTML = String(slide.html || '').trim();
      let card = tpl.content.firstElementChild;
      if (!card) {
        card = document.createElement('div');
        card.className = 'cf-shot';
        card.innerHTML = `<img src="${slide.src || ''}" alt="${slide.alt || ''}" draggable="false">`;
      }
      card.classList.add('nxcf-card');
      split(o.cardClassName).forEach(c => card.classList.add(c));
      // Link cards must keep their link role; a group role would make the
      // game card unreachable with a screen reader.
      const isLink = card.tagName === 'A';
      const name = slide.title || card.getAttribute('aria-label') || '';
      card.setAttribute('aria-label', (index + 1) + ' из ' + count + (name ? ': ' + name : ''));
      if (!isLink) {
        card.setAttribute('role', 'group');
        card.setAttribute('aria-roledescription', 'slide');
      }
      card.draggable = false;
      stage.appendChild(card);
      cardEls.push(card);
    });

    if (o.showNavigation) {
      const prev = document.createElement('button');
      prev.type = 'button';
      prev.className = 'nxcf-nav prev';
      prev.setAttribute('aria-label', 'Предыдущий слайд');
      prev.innerHTML = icon(CHEV_L);
      prev.addEventListener('click', () => nudge(-1));

      const next = document.createElement('button');
      next.type = 'button';
      next.className = 'nxcf-nav next';
      next.setAttribute('aria-label', 'Следующий слайд');
      next.innerHTML = icon(CHEV_R);
      next.addEventListener('click', () => nudge(1));

      viewport.appendChild(prev);
      viewport.appendChild(next);
    }

    host.appendChild(viewport);

    const caption = document.createElement('div');
    caption.className = 'nxcf-caption';
    caption.setAttribute('aria-live', 'polite');
    if (o.showCaption) host.appendChild(caption);

    const dots = document.createElement('div');
    dots.className = 'nxcf-dots';
    if (o.showPagination) host.appendChild(dots);

    let pos = 0;
    let target = 0;
    let width = 0;
    let raf = null;
    let selected = -1;
    let drag = null;
    let suppressClick = false;

    const indexAt = p => ((Math.round(p) % count) + count) % count;
    const clamp = p => o.loop ? p : Math.max(0, Math.min(count - 1, p));

    function paint() {
      if (!width) return;
      cardEls.forEach((card, index) => {
        let offset = index - pos;
        if (o.loop && count > 1) {
          offset = ((offset % count) + count) % count;
          if (offset > count / 2) offset -= count;
        }
        const distance = Math.abs(offset);
        const ramp = Math.pow(distance, o.falloff);
        const tilt = Math.min(o.rotate * ramp, 82) * Math.sign(offset);
        const pitch = width * (1 + o.gap);
        card.style.transform = `translateX(calc(-50% + ${offset * pitch}px)) translateZ(${-o.depth * width * ramp}px) rotateY(${-tilt}deg)`;
        const edge = o.loop && count > 1 ? Math.min(1, Math.max(0, count / 2 - distance)) : 1;
        card.style.opacity = String(Math.max(0, 1 - o.fade * distance) * edge);
        card.style.zIndex = String(100 - Math.round(distance));
      });
    }

    function renderCaption() {
      if (!o.showCaption) return;
      const s = slides[selected];
      caption.innerHTML = '';
      if (!s || !s.title) { caption.style.display = 'none'; return; }
      caption.style.display = '';
      const t = document.createElement('p');
      t.className = 'nxcf-cap-title';
      t.textContent = s.title;
      caption.appendChild(t);
      if (s.subtitle) {
        const sub = document.createElement('p');
        sub.className = 'nxcf-cap-sub';
        sub.textContent = s.subtitle;
        caption.appendChild(sub);
      }
      if (s.meta && s.meta.length) {
        const dl = document.createElement('dl');
        dl.className = 'nxcf-meta';
        s.meta.forEach(row => {
          if (!row || row.value == null || row.value === '') return;
          const item = document.createElement('div');
          const dt = document.createElement('dt');
          dt.textContent = row.label;
          const dd = document.createElement('dd');
          dd.textContent = row.value;
          item.appendChild(dt);
          item.appendChild(dd);
          dl.appendChild(item);
        });
        if (dl.children.length) caption.appendChild(dl);
      }
      caption.classList.remove('anim');
      void caption.offsetWidth;
      caption.classList.add('anim');
    }

    function renderDots() {
      if (!o.showPagination) return;
      dots.innerHTML = '';
      if (count > 24) {
        const counter = document.createElement('span');
        counter.className = 'nxcf-count';
        counter.textContent = (selected + 1) + ' / ' + count;
        dots.appendChild(counter);
        return;
      }
      for (let i = 0; i < count; i++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'nxcf-dot' + (i === selected ? ' on' : '');
        b.setAttribute('aria-label', 'Слайд ' + (i + 1));
        b.setAttribute('aria-current', i === selected ? 'true' : 'false');
        b.addEventListener('click', () => goTo(i));
        dots.appendChild(b);
      }
    }

    function setSelected(index) {
      if (index === selected) return;
      selected = index;
      cardEls.forEach((card, i) => {
        card.classList.toggle('is-active', i === index);
        const focusables = card.querySelectorAll('a,button,input,select,textarea');
        focusables.forEach(x => {
          if (i === index) x.removeAttribute('tabindex');
          else x.setAttribute('tabindex', '-1');
        });
      });
      renderCaption();
      renderDots();
    }

    function settle(t) {
      if (raf !== null) cancelAnimationFrame(raf);
      target = t;
      setSelected(indexAt(t));
      if (reduceMotion()) {
        pos = t;
        paint();
        raf = null;
        return;
      }
      const step = () => {
        const remaining = t - pos;
        if (Math.abs(remaining) < 0.0004) {
          pos = t;
          paint();
          raf = null;
          return;
        }
        pos += remaining * 0.16;
        paint();
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }

    function goTo(index) {
      const t = o.loop ? index + Math.round((target - index) / count) * count : index;
      settle(clamp(t));
    }

    function nudge(by) {
      settle(clamp(Math.round(target) + by));
    }

    function measure() {
      const card = cardEls[0];
      if (!card) return;
      const w = card.offsetWidth;
      if (!w) return;
      const h = card.offsetHeight;
      if (w !== width) {
        width = w;
        paint();
      }
      if (h) {
        const px = h + 'px';
        if (stage.style.height !== px) stage.style.height = px;
      }
    }

    function onDragMove(e) {
      if (!drag || drag.id !== e.pointerId) return;
      const pitch = width * (1 + o.gap);
      if (!pitch) return;
      const now = performance.now();
      const previous = pos;
      pos = clamp(drag.pos - (e.clientX - drag.x) / pitch);
      drag.v = ((pos - previous) / Math.max(now - drag.t, 1)) * 1000;
      drag.t = now;
      const index = indexAt(pos);
      if (index !== selected) setSelected(index);
      paint();
    }

    function endDrag(e) {
      const d = drag;
      if (!d || d.id !== e.pointerId) return;
      drag = null;
      frame.classList.remove('dragging');
      window.removeEventListener('pointermove', onDragMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      const carried = Math.max(-2, Math.min(2, d.v * 0.18));
      settle(clamp(Math.round(pos + carried)));
      if (Math.abs(e.clientX - d.x) > 6) suppressClick = true;
    }

    // Without pointer capture the window can lose the pointerup when the
    // cursor is released outside the app. End the drag on blur so the ring
    // does not keep following the mouse.
    function cancelDrag(){
      if (!drag) return;
      const d = drag;
      endDrag({pointerId: d.id, clientX: d.x, clientY: d.y});
      suppressClick = true;
    }
    window.addEventListener('blur', cancelDrag);

    frame.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      if (e.target.closest('button,input,select,textarea')) return;
      if (raf !== null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
      target = pos;
      suppressClick = false;
      // Do NOT call setPointerCapture here. Pointer capture retargets the
      // following click to the frame, so a click on the card link never
      // reaches the link and the game page never opens. Window listeners
      // keep the drag working outside the frame and leave the click target
      // intact.
      drag = { id: e.pointerId, x: e.clientX, pos: pos, v: 0, t: performance.now() };
      frame.classList.add('dragging');
      window.addEventListener('pointermove', onDragMove);
      window.addEventListener('pointerup', endDrag);
      window.addEventListener('pointercancel', endDrag);
    });

    frame.addEventListener('click', e => {
      if (suppressClick) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.target.closest('button,input,select,textarea')) return;
      let card = e.target.closest('.nxcf-card');
      // Safety net: if a browser still retargets the click to the frame,
      // recover the card under the pointer instead of ignoring the click.
      if (!card) {
        const under = document.elementFromPoint(e.clientX, e.clientY);
        if (under && under.closest('button,input,select,textarea')) return;
        card = under && under.closest('.nxcf-card');
      }
      if (!card) return;
      const index = cardEls.indexOf(card);
      if (index < 0) return;
      if (index !== selected) {
        e.preventDefault();
        e.stopPropagation();
        goTo(index);
        return;
      }
      // Centred card: if the click target is the frame/stage rather than the
      // link itself, follow the link explicitly.
      if (e.target === frame || e.target === stage) {
        const link = card.matches('a[href]') ? card : card.querySelector('a[href]');
        if (link) {
          e.preventDefault();
          const href = link.getAttribute('href');
          if (href) {
            if (href.charAt(0) === '#') location.hash = href;
            else location.href = href;
          }
        }
      }
    }, true);

    frame.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        nudge(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        nudge(1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        goTo(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        goTo(count - 1);
      }
    });

    frame.addEventListener('dragstart', e => e.preventDefault());

    let observer = null;
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(measure);
      observer.observe(frame);
    }

    // First paint after the browser has laid the host out.
    requestAnimationFrame(() => {
      measure();
      setSelected(indexAt(pos));
      paint();
    });

    return {
      goTo: goTo,
      next: () => nudge(1),
      prev: () => nudge(-1),
      refresh: measure,
      destroy() {
        if (raf !== null) cancelAnimationFrame(raf);
        if (observer) observer.disconnect();
      },
    };
  }

  window.NexusCoverflow = { create: create };
})();
