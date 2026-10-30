'use strict';
// NEXUS: поиск по названиям игр. Один модуль и для браузера, и для Node (сервер, тесты).
// Что умеет:
//  • нормализация: регистр, ё/е, диакритика, дефисы и двоеточия, римские цифры (II = 2), «halflife» = «half-life»;
//  • ранжирование: точное название всегда первое, дальше начало названия, слова подряд, слова в любом порядке, нечёткий поиск;
//  • нечёткий поиск (fuzzy): опечатки в словах (расстояние Дамерау-Левенштейна), поиск по началу слова при наборе;
//  • отсев мусора: саундтреки, DLC, наборы, демо и всё, что слабо похоже на запрос;
//  • сокращения (gta, cs, rdr2, tlou…), русские названия и неверная раскладка клавиатуры;
//  • очистка «папочных» названий пиратских версий: [FitGirl Repack], v1.2.3, CODEX, MULTi10 и т. п.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexusSearch = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const ROMAN = {ii: '2', iii: '3', iv: '4', vi: '6', vii: '7', viii: '8', ix: '9', xi: '11', xii: '12', xiii: '13', xiv: '14', xv: '15', xvi: '16', xvii: '17', xviii: '18', xix: '19', xx: '20'};
  const EDITION = /\b(remastered|remaster|definitive|ultimate|complete|enhanced|special|deluxe|gold|platinum|anniversary|legendary|collectors?|directors? cut|game of the year|goty|edition|collection|hd|remake|redux|reloaded|classic|digital|standard|premium|royal|legacy|next gen|expanded)\b/g;
  const JUNK = /\b(soundtrack|ost|original score|artbook|art book|season pass|expansion pass|dlc|bundle|demo|playtest|dedicated server|sdk|mod tools|wallpaper|upgrade pack|cosmetics?|costume pack|trailer|supporter pack|pre ?order|digital deluxe upgrade|server)\b/;
  const STOP_LEAD = /^(the|a|an)\s+/;

  // сокращения → полное название (ключ — слитная форма без пробелов)
  const ALIASES = {
    gta: 'grand theft auto', gta3: 'grand theft auto 3', gtavc: 'grand theft auto vice city', gtasa: 'grand theft auto san andreas', gta4: 'grand theft auto iv', gta5: 'grand theft auto v', gtav: 'grand theft auto v', gtaonline: 'grand theft auto online',
    cs: 'counter strike', cs16: 'counter strike 1.6', cs2: 'counter strike 2', csgo: 'counter strike global offensive', cod: 'call of duty', mw2: 'modern warfare 2', mw3: 'modern warfare 3', bo2: 'black ops 2', bf: 'battlefield', bf4: 'battlefield 4',
    rdr: 'red dead redemption', rdr2: 'red dead redemption 2', tlou: 'the last of us', botw: 'breath of the wild', totk: 'tears of the kingdom', ds: 'dark souls', ds1: 'dark souls', ds2: 'dark souls ii', ds3: 'dark souls iii',
    ac: 'assassins creed', ac2: 'assassins creed ii', fc: 'far cry', fc3: 'far cry 3', fc5: 'far cry 5', re: 'resident evil', re2: 'resident evil 2', re4: 'resident evil 4', re7: 'resident evil 7', re8: 'resident evil village',
    ff: 'final fantasy', ff7: 'final fantasy vii', ff10: 'final fantasy x', ff15: 'final fantasy xv', nfs: 'need for speed', mk: 'mortal kombat', mk11: 'mortal kombat 11', wow: 'world of warcraft', lol: 'league of legends',
    pubg: 'playerunknowns battlegrounds', hl: 'half life', hl2: 'half life 2', l4d: 'left 4 dead', l4d2: 'left 4 dead 2', tf2: 'team fortress 2', bg3: 'baldurs gate 3', poe: 'path of exile', nms: 'no mans sky',
    sc2: 'starcraft ii', hk: 'hollow knight', dmc: 'devil may cry', dmc5: 'devil may cry 5', sh2: 'silent hill 2', mgs: 'metal gear solid', tr: 'tomb raider', tr2: 'tomb raider ii', kotor: 'star wars knights of the old republic',
    tw3: 'the witcher 3 wild hunt', w3: 'witcher 3', cp77: 'cyberpunk 2077', bl2: 'borderlands 2', bl3: 'borderlands 3', pvz: 'plants vs zombies', eu4: 'europa universalis iv', ck3: 'crusader kings iii', hoi4: 'hearts of iron iv',
    civ: 'civilization', civ6: 'sid meiers civilization vi', aoe: 'age of empires', aoe2: 'age of empires ii', tes: 'the elder scrolls', fo4: 'fallout 4', fnv: 'fallout new vegas', rimworld: 'rimworld', stalker: 'stalker', rdr1: 'red dead redemption',
    // русские названия и транслит
    'ведьмак': 'witcher', 'ведьмак3': 'witcher 3', 'гта': 'grand theft auto', 'гта5': 'grand theft auto v', 'сталкер': 'stalker', 'метро': 'metro', 'скайрим': 'skyrim', 'халфлайф': 'half life', 'контрстрайк': 'counter strike',
    'ксго': 'counter strike global offensive', 'дота': 'dota 2', 'дота2': 'dota 2', 'майнкрафт': 'minecraft', 'киберпанк': 'cyberpunk 2077', 'фоллаут': 'fallout', 'даркселс': 'dark souls', 'темныедуши': 'dark souls',
    'резидентивил': 'resident evil', 'обительзла': 'resident evil', 'ассасин': 'assassins creed', 'ассасинкрид': 'assassins creed', 'террария': 'terraria', 'симс': 'the sims', 'цивилизация': 'civilization', 'мафия': 'mafia',
    'мортлкомбат': 'mortal kombat', 'морталкомбат': 'mortal kombat', 'фифа': 'fifa', 'гарри поттер': 'harry potter', 'томбрейдер': 'tomb raider', 'лара крофт': 'tomb raider', 'тётрис': 'tetris', 'ведьмак дикая охота': 'the witcher 3 wild hunt'
  };

  // русская раскладка → английская (на случай набора в неправильной раскладке)
  const RU = 'йцукенгшщзхъфывапролджэячсмитьбю', EN = 'qwertyuiop[]asdfghjkl;\'zxcvbnm,.';
  const LAYOUT = {}; for (let i = 0; i < RU.length; i++) LAYOUT[RU[i]] = EN[i];
  const fromRuLayout = s => s.toLowerCase().replace(/[а-я]/g, c => LAYOUT[c] || c).replace(/[\[\];',.]/g, m => ({'[': '', ']': '', ';': '', "'": '', ',': '', '.': ''}[m]));

  // --- кросс-локализация: русские названия ↔ английские ---
  // слова и фразы, которые в русской локализации переведены (всё остальное транслитерируется)
  const RU_EN = {
    'ведьмак': 'witcher', 'дикая охота': 'wild hunt', 'бог войны': 'god of war', 'рагнарек': 'ragnarok', 'темные души': 'dark souls', 'кольцо элден': 'elden ring', 'элден ринг': 'elden ring',
    'одни из нас': 'the last of us', 'последние из нас': 'the last of us', 'часть': 'part', 'обитель зла': 'resident evil', 'резидент ивил': 'resident evil', 'человек паук': 'spider man',
    'мстители': 'avengers', 'мертвый космос': 'dead space', 'мертвый остров': 'dead island', 'ходячие мертвецы': 'walking dead', 'бесконечное лето': 'everlasting summer', 'дом': 'house',
    'игра престолов': 'game of thrones', 'властелин колец': 'lord of the rings', 'звездные войны': 'star wars', 'звездный': 'star', 'мир': 'world', 'война': 'war', 'войны': 'war', 'новый': 'new',
    'призрак цусимы': 'ghost of tsushima', 'призрак': 'ghost', 'тень': 'shadow', 'тени': 'shadows', 'убийца': 'assassin', 'кредо убийцы': 'assassins creed', 'ассасин крид': 'assassins creed',
    'тихий холм': 'silent hill', 'метро исход': 'metro exodus', 'исход': 'exodus', 'последний': 'last', 'последняя': 'last', 'выживание': 'survival', 'дикий запад': 'wild west', 'красный мертвец': 'red dead',
    'искупление': 'redemption', 'ограбление': 'heist', 'кража': 'theft', 'большая кража авто': 'grand theft auto', 'гта': 'grand theft auto', 'вор': 'thief', 'охотник': 'hunter', 'монстр': 'monster',
    'монстров': 'monster', 'мир монстров': 'monster hunter world', 'путь изгнания': 'path of exile', 'кибер': 'cyber', 'киберпанк': 'cyberpunk', 'эпоха': 'age', 'империй': 'empires', 'цивилизация': 'civilization',
    'сталкер': 'stalker', 'тень чернобыля': 'shadow of chernobyl', 'чистое небо': 'clear sky', 'зов припяти': 'call of pripyat', 'долгая темная': 'long dark', 'ядро': 'core', 'портал': 'portal',
    'полураспад': 'half life', 'халф лайф': 'half life', 'контр страйк': 'counter strike', 'мафия': 'mafia', 'принц персии': 'prince of persia', 'хитман': 'hitman', 'убийца 47': 'hitman 47',
    'сумерки': 'twilight', 'невидимка': 'invisible', 'дракон': 'dragon', 'драконов': 'dragons', 'век драконов': 'dragon age', 'инквизиция': 'inquisition', 'масс эффект': 'mass effect', 'массэффект': 'mass effect',
    'вторая': 'ii', 'третья': 'iii', 'второй': 'ii', 'третий': 'iii', 'рыцарь': 'knight', 'рыцари': 'knights', 'король': 'king', 'королевство': 'kingdom', 'приди': 'come', 'избавление': 'deliverance',
    'нужен для скорости': 'need for speed', 'жажда скорости': 'need for speed', 'тропа': 'trail', 'гонки': 'racing', 'футбол': 'football', 'фифа': 'fifa', 'майнкрафт': 'minecraft', 'террария': 'terraria',
    'симс': 'the sims', 'тетрис': 'tetris', 'пустошь': 'wasteland', 'фоллаут': 'fallout', 'свитки': 'scrolls', 'древние свитки': 'elder scrolls', 'скайрим': 'skyrim', 'обливион': 'oblivion', 'морровинд': 'morrowind'
  };
  const RU_KEYS = Object.keys(RU_EN).map(k => k.split(' ')).sort((a, b) => b.length - a.length);
  const CYR = {а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'};
  const translit = w => w.replace(/[а-я]/g, c => CYR[c] != null ? CYR[c] : c);

  // латинский транслит русских названий: «vedmak» → witcher, «bog voyny» → god of war.
  // Таблица собирается из русских словарей, поэтому покрывает все известные переводы.
  const LAT = {};
  const latKey = s => translit(fold(s)).split(/[^a-z0-9]+/).filter(Boolean).join('');
  function addLat(src, en) { const k = latKey(src); if (k && en && !LAT[k]) LAT[k] = en; }
  for (const k of Object.keys(RU_EN)) addLat(k, RU_EN[k]);
  for (const k of Object.keys(ALIASES)) if (/[а-яё]/.test(k)) addLat(k, ALIASES[k]);
  // «Одни из нас™: Часть I» → «the last of us part i»; незнакомые слова — по звучанию («хелло нейбор» → «hello neibor»)
  function ruToEn(s) {
    const ws = String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е').replace(/[™®©]/g, ' ').split(/[^a-zа-я0-9]+/).filter(Boolean), out = [];
    for (let i = 0; i < ws.length;) {
      let hit = null;
      for (const k of RU_KEYS) if (k.length <= ws.length - i && k.every((w, j) => ws[i + j] === w)) { hit = k; break; }
      if (hit) { out.push(RU_EN[hit.join(' ')]); i += hit.length; } else { out.push(/[а-я]/.test(ws[i]) ? translit(ws[i]) : ws[i]); i++; }
    }
    return out.join(' ');
  }

  // --- нормализация ---
  function fold(s) {
    s = String(s == null ? '' : s).toLowerCase()
      .replace(/[À-ɏ]/g, ch => ch.normalize('NFD').replace(/[̀-ͯ]/g, ''))   // диакритика только у латиницы (не трогаем «й»)
      .replace(/ё/g, 'е').replace(/[™®©]/g, ' ').replace(/&/g, ' and ').replace(/[’'`´]/g, '');
    return s;
  }
  function words(s) { return fold(s).split(/[^a-z0-9а-я]+/).filter(Boolean).map(w => ROMAN[w] || w); }
  function prep(name, noAlt) {
    const raw = String(name == null ? '' : name);
    const noParen = raw.replace(/\s*[\(\[][^\)\]]*[\)\]]/g, ' ');
    const tokens = words(raw), coreTokens = words(noParen);
    if (coreTokens.length && /^(the|a|an)$/.test(coreTokens[0]) && coreTokens.length > 1) coreTokens.shift();
    const edLess = words(noParen.replace(EDITION, ' ')).filter((w, i, a) => !(i === 0 && /^(the|a|an)$/.test(w) && a.length > 1));
    const P = {raw, tokens, compact: tokens.join(''), core: coreTokens.join(''), coreTokens, edition: edLess.join(''), junk: JUNK.test(fold(raw))};
    if (!noAlt && /[а-яё]/i.test(raw)) { const en = ruToEn(raw); if (en) P.alts = [prep(en, true)]; }   // русское название ищется и по английскому чтению
    return P;
  }

  // --- расстояние Дамерау-Левенштейна (OSA) с ранним выходом ---
  function distance(a, b, max) {
    if (a === b) return 0;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    let p2 = new Array(lb + 1), p1 = new Array(lb + 1), cur = new Array(lb + 1);
    for (let j = 0; j <= lb; j++) p1[j] = j;
    for (let i = 1; i <= la; i++) {
      cur[0] = i; let rowMin = cur[0];
      for (let j = 1; j <= lb; j++) {
        const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        let v = Math.min(p1[j] + 1, cur[j - 1] + 1, p1[j - 1] + cost);
        if (i > 1 && j > 1 && a.charCodeAt(i - 1) === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) v = Math.min(v, p2[j - 2] + 1);
        cur[j] = v; if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      const t = p2; p2 = p1; p1 = cur; cur = t;
    }
    return p1[lb];
  }
  const maxEdits = n => n <= 3 ? 0 : n <= 5 ? 1 : n <= 9 ? 2 : 3;

  // насколько слово запроса q похоже на слово названия c (0..1)
  function tokenMatch(q, c, partial) {
    if (q === c) return 1;
    if (/^\d+$/.test(q) || /^\d+$/.test(c)) return 0;                      // числа сравниваем только точно
    if (partial && q.length >= 2 && c.startsWith(q)) return 0.9;           // «half li» → «half life»
    if (q.length >= 3 && c.startsWith(q) && c.length - q.length <= 4) return 0.84;
    const me = maxEdits(Math.min(q.length, c.length));
    if (me) {
      const d = distance(q, c, me);
      if (d <= me) return Math.max(0.6, 0.9 - 0.14 * d);
      if (partial && c.length > q.length) { const d2 = distance(q, c.slice(0, q.length), maxEdits(q.length)); if (d2 <= maxEdits(q.length) && q.length >= 4) return 0.72; }
    }
    if (partial && q.length === 3 && c.length > 3 && q[0] === c[0]) {           // «ded» → «dead» (опечатка в коротком недописанном слове)
      if (distance(q, c.slice(0, 3), 1) <= 1 || distance(q, c.slice(0, 4), 1) <= 1) return 0.7;
    }
    return 0;
  }

  // --- сравнение запроса (подготовленного) и названия (подготовленного) ---
  function scoreOne(Q, C) {
    const qc = Q.compact; if (!qc || !C.compact) return 0;
    if (C.compact === qc) return 1000;                                      // точное название — всегда первое
    if (C.core === Q.core) return 990;                                      // «DOOM (2016)» и «The Witcher 3» против «DOOM» и «Witcher 3»
    if (C.edition && C.edition === Q.edition && Q.edition) return 975;     // «Skyrim» = «Skyrim Special Edition»
    let s = 0;
    const qt = Q.tokens, ct = C.coreTokens.length ? C.coreTokens : C.tokens;
    // начало названия: слова запроса — это первые слова названия (последнее может быть недописано)
    if (qt.length <= ct.length && qt.every((w, i) => ct[i] === w || (i === qt.length - 1 && ct[i] && ct[i].startsWith(w) && w.length >= 2))) {
      const extra = C.compact.length - qc.length; s = Math.max(s, 940 - Math.min(110, extra * 3));
    } else if (C.core.startsWith(Q.core) && Q.core.length >= 3) { s = Math.max(s, 925 - Math.min(110, (C.core.length - Q.core.length) * 3)); }   // «halflife» → «half life 2»
    // слова запроса идут подряд внутри названия
    if (s < 800 && qt.length) {
      outer: for (let i = 0; i + qt.length <= ct.length; i++) {
        for (let j = 0; j < qt.length; j++) if (!(ct[i + j] === qt[j] || (j === qt.length - 1 && ct[i + j].startsWith(qt[j]) && qt[j].length >= 2))) continue outer;
        s = Math.max(s, 830 - Math.min(100, (C.compact.length - qc.length) * 2)); break;
      }
    }
    if (s >= 800) return s;
    // слова в любом порядке + нечёткое совпадение слов
    let wSum = 0, mSum = 0, hit = 0; const used = new Set(); let inOrder = true, last = -1;
    for (let i = 0; i < qt.length; i++) {
      const q = qt[i], w = q.length + 1; wSum += w;
      let best = 0, bj = -1;
      for (let j = 0; j < ct.length; j++) { if (used.has(j)) continue; const m = tokenMatch(q, ct[j], i === qt.length - 1); if (m > best) { best = m; bj = j; if (m === 1) break; } }
      if (bj >= 0) { used.add(bj); if (bj < last) inOrder = false; last = bj; if (best >= 0.84) hit++; }
      mSum += w * best;
    }
    const cov = wSum ? mSum / wSum : 0;
    if (cov >= 0.72) {
      s = 330 + Math.round(380 * cov * (inOrder ? 1 : 0.94));
      if (hit === qt.length) s = Math.max(s, 700 + Math.round(60 * cov) - Math.min(60, Math.max(0, ct.length - qt.length) * 6));
    }
    // слитное написание: «halflife2» против «half life 2»
    if (!s && qc.length >= 5) { const d = distance(qc, C.compact.slice(0, qc.length + 2), maxEdits(qc.length)); if (d <= maxEdits(qc.length) && d > 0) s = 520 - d * 40; }
    return s;
  }

  // варианты запроса: сам запрос, сокращение, русская раскладка
  function variants(query) {
    const q0 = prep(query), out = [{Q: q0, w: 1}];
    if (!q0.compact) return out;
    const compactKey = q0.tokens.join('');
    const add = (str, w) => { const p = prep(str); if (p.compact && !out.some(v => v.Q.compact === p.compact)) out.push({Q: p, w}); };
    if (ALIASES[compactKey]) add(ALIASES[compactKey], 0.97);
    else if (q0.tokens.length > 1 && ALIASES[q0.tokens[0]]) add(ALIASES[q0.tokens[0]] + ' ' + q0.tokens.slice(1).join(' '), 0.96);
    if (/[а-я]/.test(fold(query))) {
      const en = ruToEn(query); if (en) add(en, 0.93);
      const sw = fromRuLayout(fold(query));
      if (sw && /[a-z]/.test(sw)) { add(sw, 0.9); const sk = prep(sw).tokens.join(''); if (ALIASES[sk]) add(ALIASES[sk], 0.88); }
    } else {
      // латинский транслит: «vedmak» → witcher, «bog voyny» → god of war, «odni iz nas» → the last of us
      if (LAT[compactKey]) add(LAT[compactKey], 0.94);
      else if (q0.tokens.length > 1 && LAT[q0.tokens[0]]) add(LAT[q0.tokens[0]] + ' ' + q0.tokens.slice(1).join(' '), 0.92);
      else if (q0.tokens.length > 1) { const rest = latKey(q0.tokens.slice(1).join(' ')); if (LAT[rest]) add(q0.tokens[0] + ' ' + LAT[rest], 0.9); }
    }
    return out;
  }

  // оценка одного названия; opts.candidate — уже подготовленный prep(name)
  function score(query, name, opts) {
    const C = (opts && opts.candidate) || prep(name), vs = (opts && opts.variants) || variants(query);
    let best = 0;
    const cands = [[C, 1]].concat((C.alts || []).map(a => [a, 0.95]));
    for (const {Q, w} of vs) for (const [CC, cw] of cands) {
      let s = scoreOne(Q, CC);
      if (s && s < 1000) {
        const qn = Q.tokens.filter(t => /^\d+$/.test(t));
        if (qn.length && !qn.every(n => CC.tokens.includes(n))) s = Math.min(s, 380);             // «Half-Life 2» ≠ «Half-Life»
      }
      const ww = w * cw;
      s = s >= 1000 ? 1000 - (ww < 1 ? Math.round((1 - ww) * 100) : 0) : Math.round(s * ww);
      if (s > best) best = s;
    }
    if (best && best < 1000 && C.junk && !JUNK.test(fold(query))) best -= 600;                    // саундтреки, DLC, наборы: уходят из выдачи, если их не искали
    return Math.max(0, best);
  }

  const nameOf = i => typeof i === 'string' ? i : Array.isArray(i) ? i[1] : i && i.name;
  const MIN_SCORE = 330;
  // Популярные совпадения по началу названия. Для короткого запроса («hal», «gta», «вед») известность важнее длины:
  // сначала идут игры, название которых начинается с введённых букв, и только потом — остальные совпадения.
  // Точное название всегда остаётся первым, чтобы не ломать обычное ранжирование.
  function prefix(query, items, opts) {
    opts = opts || {};
    const raw = String(query == null ? '' : query).trim(), Q = prep(raw), qc = Q.compact;
    if (!qc) return items.slice();
    const get = opts.get || nameOf, pop = opts.pop || (() => 0), limit = opts.limit || 0;
    const qt = Q.tokens, out = [];
    for (const it of items) {
      const name = String(get(it) == null ? '' : get(it)), C = prep(name);
      if (!C.compact) continue;
      const ct = C.coreTokens.length ? C.coreTokens : C.tokens;
      let s = 0;
      if (C.compact === qc) s = 3000;
      else if (C.core === qc) s = 2900;
      else if (C.core.startsWith(qc) || C.compact.startsWith(qc)) s = 2000 - Math.min(300, C.compact.length - qc.length);
      else if (qt.length && ct.length && ct[0].startsWith(qt[0])) s = 1400 - Math.min(300, C.compact.length - qc.length);
      else {
        // каждая часть запроса — начало отдельного слова, по порядку: «hal li» → Half-Life
        let pos = 0, ok = true;
        for (const q of qt) {
          const at = ct.findIndex((w, i) => i >= pos && w.startsWith(q));
          if (at < 0) { ok = false; break; }
          pos = at + 1;
        }
        if (ok) s = 1000 - Math.min(200, C.compact.length - qc.length);
      }
      if (!s) continue;
      if (C.junk && !JUNK.test(fold(raw))) continue;               // саундтреки и DLC не подмешиваются к обычному запросу
      out.push({it, s, p: +pop(it) || 0, len: C.compact.length, name});
    }
    out.sort((a, b) => (b.s >= 2900) - (a.s >= 2900) || (b.p - a.p) || (b.s - a.s) || (a.len - b.len) || a.name.localeCompare(b.name));
    const res = out.map(o => o.it);
    return limit ? res.slice(0, limit) : res;
  }
  // ранжирование списка; get(item) → название; pop(item) → 0..1 популярность (разрешает ничьи)
  function rank(query, items, opts) {
    opts = opts || {};
    const q = String(query == null ? '' : query).trim(), get = opts.get || nameOf, pop = opts.pop || (() => 0), min = opts.min == null ? MIN_SCORE : opts.min;
    if (!q) return items.slice();
    const vs = variants(q), out = [];
    for (const it of items) {
      const name = get(it), C = prep(name); let s = score(q, name, {candidate: C, variants: vs});
      if (opts.names) for (const alt of opts.names(it) || []) if (alt && alt !== name) s = Math.max(s, Math.round(score(q, alt, {variants: vs}) * 0.97));
      if (s >= min) out.push({it, s, p: +pop(it) || 0, len: C.compact.length, name: String(name)});
    }
    out.sort((a, b) => (b.s - a.s) || (b.p - a.p) || (a.len - b.len) || a.name.localeCompare(b.name));
    // нашлось точное название (или то же с изданием): слабые «может быть» (другая часть серии, случайное сходство) только мусорят выдачу
    if (opts.strict !== false && out.length && out[0].s >= 975) { const cut = Math.max(min, 600); while (out.length > 1 && out[out.length - 1].s < cut) out.pop(); }
    return out.map(o => { if (opts.attach && o.it && typeof o.it === 'object' && !Array.isArray(o.it)) o.it._score = o.s; return o.it; });
  }

  // убрать дубли по названию: первый из списка главнее; одинаковые названия из одного источника с разными id не склеиваем
  const yearOf = o => { const m = String(o && o.released || '').match(/^(\d{4})/); return m ? m[1] : ''; };
  const yearsDiffer = (a, b) => yearOf(a) && yearOf(b) && yearOf(a) !== yearOf(b);
  function dedupe(items, opts) {
    opts = opts || {};
    const get = opts.get || nameOf, src = opts.src || (i => i.src || ''), id = opts.id || (i => i.id), merge = opts.merge !== false;
    const seen = new Map(), out = [];
    for (const it of items) {
      const key = prep(get(it)).core || prep(get(it)).compact;
      if (!key) continue;
      const list = seen.get(key) || [];
      const twin = list.find(o => id(o) === id(it) || (!yearsDiffer(o, it) && (src(o) !== src(it) || (yearOf(o) && yearOf(o) === yearOf(it)))));   // одно название и год = одна игра, из какого бы API она ни пришла
      if (twin) { if (merge && typeof twin === 'object') for (const k of Object.keys(it)) if ((twin[k] == null || twin[k] === '' || (Array.isArray(twin[k]) && !twin[k].length)) && it[k] != null && it[k] !== '' && k !== 'id' && k !== 'src') twin[k] = it[k]; continue; }
      list.push(it); seen.set(key, list); out.push(it);
    }
    return out;
  }

  // --- очистка названий из путей и имён файлов (пиратские версии, репаки) ---
  const TAGS = /\b(fitgirl|dodi|elamigos|xatab|r\.?g\.? mechanics|mechanics|repack|repacks|rip|codex|skidrow|plaza|reloaded|razor1911|cpy|tenoke|goldberg|darksiders|flt|hoodlum|prophet|doge|empress|rune|gog|drm ?free|multi ?\d*|mult\d*|rus|eng|ru|en|pl|x64|x86|win64|win32|64 ?bit|32 ?bit|portable|setup|installer|crack|cracked|nodvd|nocd|proper|incl\w*|all dlcs?|early access|online ?fix|steam ?rip|unlocked|pre ?installed|preinstalled|lan|offline|final|release|retail|iso|dvd\d*|cd\d*|v\d+|vr only)\b/gi;
  function cleanName(s) {
    s = String(s == null ? '' : s).replace(/\.(exe|lnk|bat|rar|zip|7z|iso|bin)$/i, '').replace(/_+/g, ' ');
    s = s.replace(/\b([A-Za-z])\.(?=[A-Za-z]\.)/g, '$1').replace(/\b([A-Za-z])\.(?=\s|$)/g, '$1');                // S.T.A.L.K.E.R. → STALKER
    s = s.replace(/[\[\(\{][^\]\)\}]*[\]\)\}]/g, ' ');                                                        // [FitGirl Repack], (v1.0), {Update 5}
    s = s.replace(/\b(v|ver|version|build|update|patch|hotfix|rev|r)[\s._-]*\d[\w.\-]*/gi, ' ');
    s = s.replace(/[\s._-]\d+(\.\d+){1,}\b.*$/g, ' ');                                                         // хвост «1.2.3.4»
    s = s.replace(/\s*[-–—]\s*(codex|skidrow|plaza|reloaded|razor1911|cpy|tenoke|goldberg|flt|hoodlum|prophet|doge|empress|rune|gog|fitgirl|dodi)\b.*$/i, ' ');
    s = s.replace(/([a-zа-яё])([A-ZА-ЯЁ])/g, '$1 $2').replace(/([a-zа-яё])(\d)/gi, '$1 $2');                  // TheWitcher3 → The Witcher 3
    s = s.replace(/[_.]+/g, ' ').replace(TAGS, ' ').replace(/[-–—]+\s*$/g, ' ').replace(/^\s*[-–—]+/g, ' ');
    return s.replace(/\s+/g, ' ').trim();
  }

  return {ruToEn, translit, fold, words, prep, distance, tokenMatch, variants, score, rank, prefix, dedupe, cleanName, key: s => prep(s).core || prep(s).compact, MIN_SCORE, ALIASES, fromRuLayout};
});
