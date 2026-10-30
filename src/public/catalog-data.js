'use strict';
// NEXUS: справочники каталога. Один файл и для браузера, и для сервера (Node).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexusData = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // [appid, название] — встроенный каталог популярных игр Steam
  const FEATURED0 = [
  [570,"Dota 2"],[730,"Counter-Strike 2"],[1091500,"Cyberpunk 2077"],[292030,"The Witcher 3: Wild Hunt"],[271590,"Grand Theft Auto V"],
  [1245620,"Elden Ring"],[1086940,"Baldur's Gate 3"],[2050650,"Resident Evil 4"],[1196590,"Resident Evil Village"],[883710,"Resident Evil 2"],
  [952060,"Resident Evil 3"],[1174180,"Red Dead Redemption 2"],[377160,"Fallout 4"],[22380,"Fallout: New Vegas"],[1151340,"Fallout 76"],
  [374320,"Dark Souls III"],[570940,"Dark Souls: Remastered"],[335300,"Dark Souls II: SotFS"],[1687950,"Persona 5 Royal"],[1113000,"Persona 4 Golden"],
  [2161700,"Persona 3 Reload"],[1172470,"Apex Legends"],[252490,"Rust"],[578080,"PUBG: BATTLEGROUNDS"],[440,"Team Fortress 2"],
  [550,"Left 4 Dead 2"],[620,"Portal 2"],[220,"Half-Life 2"],[546560,"Half-Life: Alyx"],[10,"Counter-Strike 1.6"],
  [105600,"Terraria"],[413150,"Stardew Valley"],[489830,"Skyrim Special Edition"],[1145360,"Hades"],[1145350,"Hades II"],
  [367520,"Hollow Knight"],[1030300,"Hollow Knight: Silksong"],[268910,"Cuphead"],[814380,"Sekiro: Shadows Die Twice"],[582010,"Monster Hunter: World"],
  [2246340,"Monster Hunter Wilds"],[553850,"Helldivers 2"],[1623730,"Palworld"],[1966720,"Lethal Company"],[990080,"Hogwarts Legacy"],
  [1716740,"Starfield"],[1190460,"Death Stranding"],[870780,"Control"],[782330,"DOOM Eternal"],[379720,"DOOM"],
  [1328670,"Mass Effect Legendary Edition"],[2208920,"Assassin's Creed Valhalla"],[812140,"Assassin's Creed Odyssey"],[552520,"Far Cry 5"],[2369390,"Far Cry 6"],
  [1172620,"Sea of Thieves"],[892970,"Valheim"],[264710,"Subnautica"],[526870,"Satisfactory"],[427520,"Factorio"],
  [255710,"Cities: Skylines"],[289070,"Sid Meier's Civilization VI"],[1142710,"Total War: WARHAMMER III"],[813780,"Age of Empires II: DE"],[394360,"Hearts of Iron IV"],
  [236850,"Europa Universalis IV"],[1158310,"Crusader Kings III"],[281990,"Stellaris"],[252950,"Rocket League"],[1097150,"Fall Guys"],
  [945360,"Among Us"],[739630,"Phasmophobia"],[548430,"Deep Rock Galactic"],[632360,"Risk of Rain 2"],[1794680,"Vampire Survivors"],
  [646570,"Slay the Spire"],[632470,"Disco Elysium"],[435150,"Divinity: Original Sin 2"],[379430,"Kingdom Come: Deliverance"],[261550,"Mount & Blade II: Bannerlord"],
  [397540,"Borderlands 3"],[49520,"Borderlands 2"],[203160,"Tomb Raider (2013)"],[750920,"Shadow of the Tomb Raider"],[412020,"Metro Exodus"],
  [208650,"Batman: Arkham Knight"],[1971870,"Mortal Kombat 1"],[1778820,"TEKKEN 8"],[1364780,"Street Fighter 6"],[2138710,"Sifu"],
  [524220,"NieR: Automata"],[601150,"Devil May Cry 5"],[1593500,"God of War"],[1151640,"Horizon Zero Dawn"],[1817070,"Marvel's Spider-Man Remastered"],
  [1888930,"The Last of Us Part I"],[2215430,"Ghost of Tsushima"],[2358720,"Black Myth: Wukong"],[1627720,"Lies of P"],[1888160,"Armored Core VI"],
  [1868140,"Dave the Diver"],[1313140,"Cult of the Lamb"],[504230,"Celeste"],[391540,"Undertale"],[1057090,"Ori and the Will of the Wisps"],
  [1426210,"It Takes Two"],[728880,"Overcooked! 2"],[230410,"Warframe"],[1085660,"Destiny 2"],[238960,"Path of Exile"],
  [1599340,"Lost Ark"],[2767030,"Marvel Rivals"],[2357570,"Overwatch 2"],[381210,"Dead by Daylight"],[359550,"Rainbow Six Siege"],
  [1517290,"Battlefield 2042"],[1272080,"PAYDAY 3"],[218620,"PAYDAY 2"],[2124490,"Silent Hill 2"],[534380,"Dying Light 2"],
  [239140,"Dying Light"],[1259420,"Days Gone"],[108600,"Project Zomboid"],[251570,"7 Days to Die"],[346110,"ARK: Survival Evolved"],
  [1326470,"Sons of the Forest"],[668580,"Atomic Heart"],[1643320,"S.T.A.L.K.E.R. 2"],[1659040,"HITMAN World of Assassination"],[2622380,"Elden Ring Nightreign"],
  [2379780,"Balatro"],[1903340,"Clair Obscur: Expedition 33"],[3527290,"PEAK"],[1030840,"Mafia: Definitive Edition"]
  ];

  const FEATURED = FEATURED0.map(([i, n]) => [String(i), n]);

  // Подборки для каруселей каталога (id игр из списка выше). Неразобранное попадает в «Ещё».
  const CATS = [
  ['Экшен и приключения',[1091500,271590,1174180,1190460,870780,1593500,1151640,1817070,1888930,2215430,2358720,1259420,208650,203160,750920,2138710,524220,601150,1659040,1030840]],
  ['Ролевые игры',[292030,1245620,1086940,489830,377160,22380,632470,435150,379430,261550,1687950,1113000,2161700,1903340,1328670,2208920,812140,1716740,990080,1643320,238960,1599340,1151340]],
  ['Шутеры',[730,1172470,578080,440,550,10,359550,1517290,2767030,2357570,782330,379720,553850,552520,2369390,397540,49520,412020,1272080,218620,668580,1085660,230410]],
  ['Хорроры и выживание',[2050650,1196590,883710,952060,2124490,739630,1966720,381210,534380,239140,108600,251570,346110,1326470,252490,892970,264710,1623730]],
  ['Стратегии и симуляторы',[255710,289070,1142710,813780,394360,236850,1158310,281990,526870,427520,646570,2379780,1794680]],
  ['Инди и кооператив',[105600,413150,1145360,1145350,391540,1057090,1426210,728880,945360,1097150,252950,548430,632360,1868140,1313140,1172620,3527290]],
  ['Valve',[570,620,220,546560]]
  ];

  // платформы: конкретные консоли, а не общие названия. rawg: id платформ в RAWG (параметр platforms), names: как консоль называется в данных RAWG, fb: запасные id на случай,
  // если сервер не получил список платформ у RAWG. group: раздел в панелях фильтров. emu: id эмуляторов (lib/emulators.js)
  const GROUPS = [{id: 'ps', label: 'PlayStation'}, {id: 'nintendo', label: 'Nintendo'}, {id: 'xboxpc', label: 'Xbox и PC'}, {id: 'other', label: 'Другое'}];
  const PLATFORMS = [
    {id: 'ps1', label: 'PS1', group: 'ps', icon: 'pad', fb: '27', names: ['PlayStation']},
    {id: 'ps2', label: 'PS2', group: 'ps', icon: 'pad', fb: '15', names: ['PlayStation 2']},
    {id: 'ps3', label: 'PS3', group: 'ps', icon: 'pad', fb: '16', names: ['PlayStation 3']},
    {id: 'ps4', label: 'PS4', group: 'ps', icon: 'pad', fb: '18', names: ['PlayStation 4']},
    {id: 'ps5', label: 'PS5', group: 'ps', icon: 'pad', fb: '187', names: ['PlayStation 5']},
    {id: 'psp', label: 'PSP', group: 'ps', icon: 'handheld', fb: '17', names: ['PSP']},
    {id: 'vita', label: 'PS Vita', group: 'ps', icon: 'handheld', fb: '19', names: ['PS Vita']},
    {id: 'switch', label: 'Nintendo Switch', group: 'nintendo', icon: 'handheld', fb: '7', names: ['Nintendo Switch']},
    {id: 'switch2', label: 'Nintendo Switch 2', group: 'nintendo', icon: 'handheld', fb: '7', names: ['Nintendo Switch 2'], since: '2025-06-05'},
    {id: 'wii', label: 'Wii', group: 'nintendo', icon: 'pad', fb: '11', names: ['Wii']},
    {id: 'wiiu', label: 'Wii U', group: 'nintendo', icon: 'pad', fb: '10', names: ['Wii U']},
    {id: 'gc', label: 'GameCube', group: 'nintendo', icon: 'pad', fb: '105', names: ['GameCube']},
    {id: 'n64', label: 'N64', group: 'nintendo', icon: 'pad', fb: '83', names: ['Nintendo 64']},
    {id: 'snes', label: 'SNES', group: 'nintendo', icon: 'pad', fb: '79', names: ['SNES']},
    {id: 'nes', label: 'NES', group: 'nintendo', icon: 'pad', fb: '49', names: ['NES']},
    {id: 'gb', label: 'Game Boy / GBA', group: 'nintendo', icon: 'handheld', fb: '26,43,24', names: ['Game Boy', 'Game Boy Color', 'Game Boy Advance']},
    {id: 'ds', label: 'Nintendo DS / 3DS', group: 'nintendo', icon: 'handheld', fb: '9,13,8', names: ['Nintendo DS', 'Nintendo DSi', 'Nintendo 3DS']},
    {id: 'pc', label: 'PC', group: 'xboxpc', icon: 'monitor', fb: '4', names: ['PC']},
    {id: 'xog', label: 'Xbox', group: 'xboxpc', icon: 'pad', fb: '80', names: ['Xbox']},
    {id: 'x360', label: 'Xbox 360', group: 'xboxpc', icon: 'pad', fb: '14', names: ['Xbox 360']},
    {id: 'xone', label: 'Xbox One', group: 'xboxpc', icon: 'pad', fb: '1', names: ['Xbox One']},
    {id: 'xsx', label: 'Xbox Series X/S', group: 'xboxpc', icon: 'pad', fb: '186', names: ['Xbox Series S/X']},
    {id: 'mac', label: 'macOS', group: 'other', icon: 'laptop', fb: '5', names: ['macOS']},
    {id: 'linux', label: 'Linux', group: 'other', icon: 'terminal', fb: '6', names: ['Linux']},
    {id: 'mobile', label: 'Телефон и планшет', group: 'other', icon: 'phone', fb: '3,21', names: ['iOS', 'Android']},
    {id: 'deck', label: 'Steam Deck', group: 'other', icon: 'handheld', fb: '', names: []},
    {id: 'other', label: 'Другое', group: 'other', icon: 'pad', fb: '', names: []}
  ];
  const PLATFORM_BY_ID = Object.fromEntries(PLATFORMS.map(p => [p.id, p]));
  // старые общие значения (до разделения по консолям) переводим в ближайшую конкретную платформу
  const LEGACY_PLAT = {ps: 'ps4', xbox: 'xone', nintendo: 'switch'};
  const migratePlat = id => LEGACY_PLAT[id] || id;
  // платформа из названия RAWG («PlayStation 5», «Xbox Series S/X», «Wii U», «Game Boy Advance»…) в конкретный id
  function platId(name) {
    const n = String(name || '').toLowerCase().trim();
    if (!n) return 'other';
    if (PLATFORM_BY_ID[n]) return n;
    if (/steam ?deck/.test(n)) return 'deck';
    if (/playstation ?5|^ps ?5\b/.test(n)) return 'ps5';
    if (/playstation ?4|^ps ?4\b/.test(n)) return 'ps4';
    if (/playstation ?3|^ps ?3\b/.test(n)) return 'ps3';
    if (/playstation ?2|^ps ?2\b/.test(n)) return 'ps2';
    if (/vita/.test(n)) return 'vita';
    if (/\bpsp\b|playstation portable/.test(n)) return 'psp';
    if (/^playstation$|^ps ?1$|^psx$|^psone$|playstation 1\b/.test(n)) return 'ps1';
    if (/playstation/.test(n)) return 'ps4';
    if (/xbox series|series [sx]/.test(n)) return 'xsx';
    if (/xbox one/.test(n)) return 'xone';
    if (/xbox 360|x360/.test(n)) return 'x360';
    if (/^xbox$|original xbox/.test(n)) return 'xog';
    if (/xbox/.test(n)) return 'xone';
    if (/switch ?2/.test(n)) return 'switch2';
    if (/switch/.test(n)) return 'switch';
    if (/wii ?u/.test(n)) return 'wiiu';
    if (/\bwii\b/.test(n)) return 'wii';
    if (/game ?cube|\bngc\b/.test(n)) return 'gc';
    if (/nintendo 64|\bn64\b/.test(n)) return 'n64';
    if (/super nintendo|\bsnes\b|super famicom/.test(n)) return 'snes';
    if (/^nes$|nintendo entertainment|famicom/.test(n)) return 'nes';
    if (/game ?boy|\bgba\b|\bgbc\b/.test(n)) return 'gb';
    if (/3ds|nintendo ds|\bnds\b|\bdsi\b/.test(n)) return 'ds';
    if (/nintendo/.test(n)) return 'switch';
    if (/\bmac|apple/.test(n)) return 'mac';
    if (/linux/.test(n)) return 'linux';
    if (/android|\bios\b|iphone|ipad/.test(n)) return 'mobile';
    if (/^pc$|windows/.test(n)) return 'pc';
    return 'other';
  }
  const platLabel = id => (PLATFORM_BY_ID[id] || {label: id}).label;
  // порядок сортировки по платформам: сначала раздел, затем консоль внутри раздела
  const PLAT_ORDER = Object.fromEntries(PLATFORMS.map((p, i) => [p.id, i]));
  const platRank = ids => { const r = (ids || []).map(p => PLAT_ORDER[p]).filter(x => x != null); return r.length ? Math.min(...r) : 999; };

  // жанры RAWG: slug, подпись, английское название (так оно приходит в данных)
  const GENRES = [
    ['action', 'Экшен', 'Action'], ['indie', 'Инди', 'Indie'], ['adventure', 'Приключения', 'Adventure'], ['role-playing-games-rpg', 'RPG', 'RPG'], ['strategy', 'Стратегии', 'Strategy'],
    ['shooter', 'Шутеры', 'Shooter'], ['casual', 'Казуальные', 'Casual'], ['simulation', 'Симуляторы', 'Simulation'], ['puzzle', 'Головоломки', 'Puzzle'], ['arcade', 'Аркады', 'Arcade'],
    ['platformer', 'Платформеры', 'Platformer'], ['racing', 'Гонки', 'Racing'], ['massively-multiplayer', 'MMO', 'Massively Multiplayer'], ['sports', 'Спорт', 'Sports'], ['fighting', 'Файтинги', 'Fighting'],
    ['family', 'Семейные', 'Family'], ['board-games', 'Настольные', 'Board Games'], ['educational', 'Образовательные', 'Educational'], ['card', 'Карточные', 'Card']
  ];
  const GENRE_RU = Object.fromEntries(GENRES.map(g => [g[2], g[1]]));
  const GENRE_SLUG = Object.fromEntries(GENRES.map(g => [g[2], g[0]]));

  // Нормализованные теги RAWG. Один русский тег интерфейса = группа служебных тегов RAWG.
  // В UI не должно быть визуальных/субъективных ярлыков и языковых дублей.
  const TAG_MAP = {
    'Кооператив': ['co-op', 'online-co-op', 'local-co-op', 'cooperative', 'co-op-campaign'],
    'Локальный / разделённый экран': ['local-co-op', 'split-screen', 'shared-and-split-screen'],
    'Мультиплеер (PvP / Онлайн)': ['multiplayer', 'online-multiplayer', 'pvp'],
    'Выживание': ['survival', 'open-world-survival-craft'],
    'Хоррор': ['horror', 'survival-horror', 'psychological-horror'],
    'Открытый мир': ['open-world'],
    'Стелс': ['stealth']
  };
  const TAG_GROUPS = [
    {key: 'coop', label: 'Кооператив', slugs: TAG_MAP['Кооператив'], exclude: ['competitive', 'esports', 'pvp-only']},
    {key: 'local-coop', label: 'Локальный / разделённый экран', slugs: TAG_MAP['Локальный / разделённый экран']},
    {key: 'multiplayer', label: 'Мультиплеер (PvP / Онлайн)', slugs: TAG_MAP['Мультиплеер (PvP / Онлайн)']},
    {key: 'survival', label: 'Выживание', slugs: TAG_MAP['Выживание']},
    {key: 'horror', label: 'Хоррор', slugs: TAG_MAP['Хоррор']},
    {key: 'open-world', label: 'Открытый мир', slugs: TAG_MAP['Открытый мир']},
    {key: 'stealth', label: 'Стелс', slugs: TAG_MAP['Стелс']}
  ];
  // теги, которые не показываем в интерфейсе: субъективные оценки, визуальные ярлыки и служебные пометки
  const TAG_HIDE = new Set(['gore', 'violent', 'difficult', 'comedy', 'funny', 'classic', 'great-soundtrack', 'competitive', 'esports', 'pvp-only']);
  const TAG_RU = {
    'singleplayer': 'Одиночная игра', 'story-rich': 'Сюжетная', 'atmospheric': 'Атмосферная', 'open-world': 'Открытый мир', 'exploration': 'Исследование',
    'fantasy': 'Фэнтези', 'sci-fi': 'Научная фантастика', 'horror': 'Хоррор', 'survival': 'Выживание', 'stealth': 'Стелс', 'zombies': 'Зомби',
    'first-person': 'От первого лица', 'third-person': 'От третьего лица', '2d': '2D', '3d': '3D', 'pixel-graphics': 'Пиксельная графика',
    'sandbox': 'Песочница', 'female-protagonist': 'Женщина-протагонист', 'magic': 'Магия', 'post-apocalyptic': 'Постапокалипсис', 'cyberpunk': 'Киберпанк',
    'space': 'Космос', 'relaxing': 'Расслабляющая', 'choices-matter': 'Выбор влияет на сюжет', 'metroidvania': 'Метроидвания', 'roguelike': 'Рогалик',
    'rogue-lite': 'Рогалайк', 'turn-based': 'Пошаговая', 'tactical': 'Тактика', 'fast-paced': 'Динамичная', 'anime': 'Аниме', 'retro': 'Ретро',
    'crafting': 'Крафт', 'building': 'Строительство', 'base-building': 'Строительство базы', 'psychological-horror': 'Психологический хоррор',
    'mystery': 'Детектив и тайны', 'detective': 'Детектив', 'puzzle-platformer': 'Пазл-платформер', 'team-based': 'Командная',
    'character-customization': 'Кастомизация героя', 'multiple-endings': 'Несколько концовок', 'nonlinear': 'Нелинейная', 'physics': 'Физика',
    'minimalist': 'Минимализм', 'realistic': 'Реализм', 'war': 'Война', 'fps': 'FPS', 'rpg': 'RPG', 'shooter': 'Шутер',
    'local-multiplayer': 'Локальный мультиплеер', 'action-adventure': 'Экшен-приключение', 'hack-and-slash': 'Слэшер',
    'open-world-survival-craft': 'Выживание и крафт', 'souls-like': 'Souls-like', 'soulslike': 'Souls-like', 'vr': 'VR', 'mmo': 'MMO',
    'co-op': 'Кооператив', 'online-co-op': 'Кооператив', 'local-co-op': 'Кооператив', 'cooperative': 'Кооператив', 'co-op-campaign': 'Кооператив',
    'split-screen': 'Локальный / разделённый экран', 'shared-and-split-screen': 'Локальный / разделённый экран',
    'multiplayer': 'Мультиплеер (PvP / Онлайн)', 'online-multiplayer': 'Мультиплеер (PvP / Онлайн)', 'pvp': 'Мультиплеер (PvP / Онлайн)',
    'survival-horror': 'Хоррор'
  };
  // служебные теги магазина: не несут смысла для фильтров и рекомендаций
  const TAG_NOISE = new Set([...TAG_HIDE, 'steam-achievements', 'full-controller-support', 'partial-controller-support', 'steam-cloud', 'steam-trading-cards', 'steam-leaderboards', 'steam-workshop', 'controller', 'includes-level-editor', 'cross-platform-multiplayer', 'valve-anti-cheat-enabled', 'remote-play-on-tv', 'remote-play-on-phone', 'remote-play-on-tablet', 'remote-play-together', 'steam-turn-notifications', 'commentary-available', 'captions-available', 'stats', 'in-app-purchases', 'includes-source-sdk', 'family-sharing', 'online-multi-player']);
  const TAG_SINGLE = ['singleplayer', 'story-rich', 'atmospheric', 'exploration', 'fantasy', 'sci-fi', 'first-person', 'third-person', '2d', '3d', 'pixel-graphics', 'zombies', 'sandbox', 'female-protagonist', 'post-apocalyptic', 'cyberpunk', 'space', 'relaxing', 'choices-matter', 'metroidvania', 'roguelike', 'rogue-lite', 'turn-based', 'tactical', 'fast-paced', 'anime', 'retro', 'crafting', 'building', 'base-building', 'mystery', 'detective', 'puzzle-platformer', 'team-based', 'character-customization', 'multiple-endings', 'nonlinear', 'physics', 'minimalist', 'realistic', 'war', 'fps', 'rpg', 'shooter', 'local-multiplayer', 'action-adventure', 'hack-and-slash', 'souls-like', 'vr', 'mmo'];
  // запасной список тегов, если сервер не смог получить его из RAWG
  const TAGS_FALLBACK = [...TAG_GROUPS.map(g => g.key), ...TAG_SINGLE];

  const TAG_BY_KEY = new Map(TAG_GROUPS.map(g => [g.key, g]));
  const TAG_BY_SLUG = new Map();
  for (const g of TAG_GROUPS) for (const s of g.slugs) if (!TAG_BY_SLUG.has(s)) TAG_BY_SLUG.set(s, g);
  // ключ группы для любого варианта: key, русская подпись или служебный slug
  function tagKeyOf(v) {
    const s = String(v || '').trim();
    if (!s) return '';
    const low = s.toLowerCase();
    const g = TAG_GROUPS.find(x => x.key === low || x.label.toLowerCase() === low) || TAG_BY_SLUG.get(low);
    return g ? g.key : low;
  }
  // русский UI-тег/ключ/служебный slug → массив тегов RAWG (без дублей)
  function tagSlugs(v) {
    const vals = Array.isArray(v) ? v : String(v || '').split(',');
    const out = [];
    for (const raw of vals) {
      const s = String(raw || '').trim();
      if (!s) continue;
      const low = s.toLowerCase();
      const g = TAG_GROUPS.find(x => x.key === low || x.label.toLowerCase() === low) || TAG_BY_SLUG.get(low);
      if (g) out.push(...g.slugs);
      else out.push(low);
    }
    return [...new Set(out.filter(x => x && !TAG_HIDE.has(x)))];
  }
  function tagLabel(v) {
    const k = tagKeyOf(v);
    return (TAG_BY_KEY.get(k) || {}).label || TAG_RU[v] || TAG_RU[k] || String(v || k).replace(/-/g, ' ');
  }
  function tagMatches(selected, rawTags) {
    const tags = new Set((rawTags || []).map(t => String(t || '').toLowerCase()));
    return (selected || []).some(v => {
      const g = TAG_BY_KEY.get(tagKeyOf(v));
      return g ? g.slugs.some(s => tags.has(s)) : tags.has(String(v || '').toLowerCase());
    });
  }

  return {FEATURED, CATS, GROUPS, PLATFORMS, PLATFORM_BY_ID, LEGACY_PLAT, migratePlat, platId, platLabel, platRank, GENRES, GENRE_RU, GENRE_SLUG, TAG_MAP, TAG_GROUPS, TAG_HIDE, TAG_RU, TAG_NOISE, TAG_SINGLE, TAGS_FALLBACK, tagKeyOf, tagSlugs, tagLabel, tagMatches};
});
