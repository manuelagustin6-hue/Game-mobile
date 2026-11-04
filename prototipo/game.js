// "Jugada Maestra": interfaz, escena 3D (Scene3D + Players3D) y progreso del jugador.
(function () {
  'use strict';
  const E = window.Engine;
  const LEVELS = window.LEVELS;
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- Datos
  const COUNTRIES = [
    { code: 'AR', name: 'Argentina', flag: '🇦🇷', colors: ['#74ACDF', '#FFFFFF'] },
    { code: 'BO', name: 'Bolivia', flag: '🇧🇴', colors: ['#0B8A3E', '#FFFFFF'] },
    { code: 'BR', name: 'Brasil', flag: '🇧🇷', colors: ['#FFDF00', '#009C3B'] },
    { code: 'CL', name: 'Chile', flag: '🇨🇱', colors: ['#D52B1E', '#FFFFFF'] },
    { code: 'CO', name: 'Colombia', flag: '🇨🇴', colors: ['#FCD116', '#003893'] },
    { code: 'EC', name: 'Ecuador', flag: '🇪🇨', colors: ['#FFD100', '#034EA2'] },
    { code: 'ES', name: 'España', flag: '🇪🇸', colors: ['#C60B1E', '#FFC400'] },
    { code: 'US', name: 'Estados Unidos', flag: '🇺🇸', colors: ['#1F3C88', '#FFFFFF'] },
    { code: 'FR', name: 'Francia', flag: '🇫🇷', colors: ['#0055A4', '#FFFFFF'] },
    { code: 'IT', name: 'Italia', flag: '🇮🇹', colors: ['#0066CC', '#FFFFFF'] },
    { code: 'MX', name: 'México', flag: '🇲🇽', colors: ['#006847', '#FFFFFF'] },
    { code: 'PY', name: 'Paraguay', flag: '🇵🇾', colors: ['#D52B1E', '#FFFFFF'] },
    { code: 'PE', name: 'Perú', flag: '🇵🇪', colors: ['#FFFFFF', '#D91023'] },
    { code: 'PR', name: 'Puerto Rico', flag: '🇵🇷', colors: ['#ED0000', '#FFFFFF'] },
    { code: 'DO', name: 'República Dominicana', flag: '🇩🇴', colors: ['#002D62', '#CE1126'] },
    { code: 'UY', name: 'Uruguay', flag: '🇺🇾', colors: ['#5CBFEB', '#111111'] },
    { code: 'VE', name: 'Venezuela', flag: '🇻🇪', colors: ['#7A1F3D', '#FFFFFF'] },
  ];

  // Clubes ficticios. La liga (país) se asigna al fichar.
  const CLUBS = [
    { id: 'halcones', name: 'Halcones', colors: ['#B3202A', '#F5F0E6'] },
    { id: 'toros', name: 'Toros', colors: ['#1C1C1C', '#E8B04B'] },
    { id: 'condores', name: 'Cóndores', colors: ['#3A2E73', '#FFFFFF'] },
    { id: 'tiburones', name: 'Tiburones', colors: ['#0E6E8C', '#FFFFFF'] },
    { id: 'lobos', name: 'Lobos', colors: ['#5B6770', '#FFFFFF'] },
    { id: 'pumas', name: 'Pumas', colors: ['#E07A1F', '#1C1C1C'] },
    { id: 'aguilas', name: 'Águilas', colors: ['#8C1D40', '#F2C14E'] },
    { id: 'delfines', name: 'Delfines', colors: ['#2AA3C9', '#0B2545'] },
    { id: 'linces', name: 'Linces', colors: ['#2F7D32', '#FFFFFF'] },
    { id: 'centellas', name: 'Centellas', colors: ['#F2C230', '#22223B'] },
    { id: 'gigantes', name: 'Gigantes', colors: ['#14325C', '#E3A72F'] },
    { id: 'jaguares', name: 'Jaguares', colors: ['#6B3E26', '#F1E3C8'] },
  ];

  const LIFE_MAX = 5;
  const LIFE_MS = 15 * 60 * 1000; // una vida cada 15 minutos
  const HINT_COST = 30;
  const AD_EVERY = 3;              // anuncio cada 3 niveles ganados
  const AD_SECONDS = 5;
  const SEASON_SIZE = 6;
  const KEY = 'jugada-maestra-v1';

  // ---------------------------------------------------------------- Progreso guardado
  const DEFAULTS = {
    country: null, club1: null, club2: null,
    unlocked: 0, stars: [], coins: 60,
    lives: LIFE_MAX, lifeTs: Date.now(),
    premium: false, sinceAd: 0, called: {},
    me: null, skills: { tiro: 0, pase: 0, manejo: 0 },
  };
  let S = load();
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return Object.assign({}, DEFAULTS, JSON.parse(raw));
    } catch (e) { /* sin almacenamiento: se juega igual */ }
    return Object.assign({}, DEFAULTS);
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* nada */ } }

  const country = (code) => COUNTRIES.find((c) => c.code === code) || COUNTRIES[0];
  const club = (id) => CLUBS.find((c) => c.id === id) || CLUBS[0];
  const seasonOf = (i) => Math.floor(i / SEASON_SIZE) + 1;

  // Equipo propio para un nivel: club de la temporada o selección.
  function myTeam(i) {
    const lv = LEVELS[i];
    if (lv.stage === 'seleccion') {
      const c = country(S.country);
      return { name: c.name, sub: 'Selección', colors: c.colors, flag: c.flag };
    }
    const ref = seasonOf(i) === 1 ? S.club1 : (S.club2 || S.club1);
    const k = club(ref.id), c = country(ref.country);
    return { name: k.name, sub: 'Liga de ' + c.name, colors: k.colors, flag: c.flag };
  }

  function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function colorGap(a, b) { const x = hexRgb(a), y = hexRgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); }

  // Rival de un nivel, con colores que se distingan de los tuyos.
  function rivalTeam(i) {
    const lv = LEVELS[i];
    const mine = myTeam(i);
    if (lv.stage === 'seleccion') {
      const start = (i * 7 + 3) % COUNTRIES.length;
      for (let k = 0; k < COUNTRIES.length; k++) {
        const c = COUNTRIES[(start + k) % COUNTRIES.length];
        if (c.code !== S.country && colorGap(c.colors[0], mine.colors[0]) > 160) {
          return { name: c.name, sub: 'Selección', colors: c.colors, flag: c.flag };
        }
      }
    }
    const own = (seasonOf(i) === 1 ? S.club1 : (S.club2 || S.club1)).id;
    const start = (i * 5 + 2) % CLUBS.length;
    for (let k = 0; k < CLUBS.length; k++) {
      const c = CLUBS[(start + k) % CLUBS.length];
      if (c.id !== own && colorGap(c.colors[0], mine.colors[0]) > 160) {
        return { name: c.name, sub: 'Rival', colors: c.colors };
      }
    }
    return { name: 'Rival', sub: '', colors: ['#222222', '#FFFFFF'] };
  }

  const crest = (colors, sm) =>
    `<span class="crest${sm ? ' sm' : ''}" style="background:linear-gradient(135deg, ${colors[0]} 50%, ${colors[1]} 50%)"></span>`;

  // ---------------------------------------------------------------- Vidas
  function tickLives() {
    const now = Date.now();
    if (S.lives >= LIFE_MAX) { S.lifeTs = now; return; }
    const gained = Math.floor((now - S.lifeTs) / LIFE_MS);
    if (gained > 0) {
      S.lives = Math.min(LIFE_MAX, S.lives + gained);
      S.lifeTs = S.lives >= LIFE_MAX ? now : S.lifeTs + gained * LIFE_MS;
      save();
    }
  }
  function loseLife() {
    if (S.premium) return;
    if (S.lives >= LIFE_MAX) S.lifeTs = Date.now();
    S.lives = Math.max(0, S.lives - 1);
    save();
  }
  function lifeText() {
    if (S.premium) return '<span class="heart">♥</span> ∞';
    let html = `<span class="heart">♥</span> ${S.lives}`;
    if (S.lives < LIFE_MAX) {
      const left = Math.max(0, LIFE_MS - (Date.now() - S.lifeTs));
      const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
      html += ` <small>${m}:${String(s).padStart(2, '0')}</small>`;
    }
    return html;
  }
  function refreshHud() {
    tickLives();
    const lt = lifeText(), ct = `<span class="coin"></span> ${S.coins}`;
    $('home-lives').innerHTML = lt; $('game-lives').innerHTML = lt;
    $('home-coins').innerHTML = ct; $('game-coins').innerHTML = ct;
  }
  setInterval(refreshHud, 1000);

  // ---------------------------------------------------------------- Pantallas y ventanas
  let current = 'home';
  function show(name) {
    current = name;
    ['home', 'levels', 'game'].forEach((n) => { $('scr-' + n).hidden = n !== name; });
    if (name === 'home') { enterHome(); renderHome(); }
    if (name === 'levels') renderLevels();
    if (name === 'game') enterGame();
    refreshHud();
  }

  function modal(html, binds) {
    const sheet = $('sheet');
    sheet.innerHTML = html;
    $('modal').hidden = false;
    Object.keys(binds || {}).forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.onclick = binds[id];
    });
    const first = sheet.querySelector('button');
    if (first) first.focus({ preventScroll: true });
  }
  function closeModal() { $('modal').hidden = true; $('sheet').innerHTML = ''; }

  // Anuncio simulado. rewarded = el jugador recibe algo al terminar.
  function showAd(rewarded, onDone) {
    const ad = $('ad');
    let left = AD_SECONDS;
    ad.innerHTML = `
      <span class="tag">Anuncio de prueba</span>
      <div class="box">Aquí se mostrará un anuncio real</div>
      <p style="max-width:300px">${rewarded ? 'Al terminar recibes tu recompensa.' : 'Con Premium no ves estos anuncios.'}</p>
      <span class="count" id="ad-count">Puedes cerrar en ${left} s</span>
      <button class="btn alt small" id="ad-close" hidden>${rewarded ? 'Recibir recompensa' : 'Cerrar'}</button>`;
    ad.hidden = false;
    const timer = setInterval(() => {
      left--;
      if (left > 0) { $('ad-count').textContent = `Puedes cerrar en ${left} s`; return; }
      clearInterval(timer);
      $('ad-count').hidden = true;
      const b = $('ad-close');
      b.hidden = false;
      b.focus();
      b.onclick = () => { ad.hidden = true; ad.innerHTML = ''; onDone && onDone(); };
    }, 1000);
  }

  // ---------------------------------------------------------------- Elegir nacionalidad
  function chooseCountry(firstTime, onDone) {
    let sel = S.country || 'AR';
    const render = () => {
      modal(`
        <span class="eyebrow">${firstTime ? 'Bienvenido' : 'Mi equipo'}</span>
        <h2>¿De dónde eres?</h2>
        <p>Tu nacionalidad define la selección que te convoca. Empiezas en un club de tu país.</p>
        <div class="country-grid">
          ${COUNTRIES.map((c) => `<button class="country${c.code === sel ? ' sel' : ''}" data-c="${c.code}"><span class="flag">${c.flag}</span><span>${c.name}</span></button>`).join('')}
        </div>
        <div class="actions"><button class="btn" id="m-ok">Confirmar: ${country(sel).name}</button>
        ${firstTime ? '' : '<button class="btn alt" id="m-cancel">Cancelar</button>'}</div>`,
      {
        'm-ok': () => {
          const changed = S.country !== sel;
          S.country = sel;
          if (!S.club1) {
            const idx = COUNTRIES.findIndex((c) => c.code === sel);
            S.club1 = { id: CLUBS[idx % CLUBS.length].id, country: sel };
          }
          if (changed) S.called = {};
          save(); closeModal(); onDone && onDone();
        },
        'm-cancel': closeModal,
      });
      $('sheet').querySelectorAll('.country').forEach((b) => {
        b.onclick = () => { sel = b.dataset.c; const top = $('sheet').scrollTop; render(); $('sheet').scrollTop = top; };
      });
    };
    render();
  }

  // ---------------------------------------------------------------- Inicio
  function renderHome() {
    buildHero();
    if (!S.country || !S.me) { $('home-team').innerHTML = ''; return; }
    const i = Math.min(S.unlocked, LEVELS.length - 1);
    const t = myTeam(LEVELS[i].stage === 'seleccion' ? Math.max(0, i - 1) : i);
    $('home-team').innerHTML = `<canvas class="mini" id="home-me"></canvas>
      <div class="meta"><div class="label">Tu jugador · Media ${rating()}</div><div class="name">${esc(S.me.name)} <span style="color:var(--muted)">#${S.me.num}</span></div>
      <div class="label" style="text-transform:none;letter-spacing:0">${t.flag} ${t.name} · ${t.sub}</div></div>`;
    P3.renderPortrait($('home-me'), starLook(t.colors), 'idle');
    $('btn-play').textContent = S.unlocked >= LEVELS.length ? 'Jugar de nuevo' : `Jugar nivel ${i + 1}`;
  }

  function premiumModal() {
    modal(`
      <span class="eyebrow">Premium</span>
      <h2>Juega sin cortes</h2>
      <ul class="perks">
        <li>Sin anuncios entre niveles</li>
        <li>Vidas infinitas</li>
        <li>300 monedas de regalo para ayudas</li>
        <li>Camisetas y canchas exclusivas (próximamente)</li>
      </ul>
      <div class="price">2,99 USD <small>pago único · precio de ejemplo</small></div>
      <div class="actions">
        <button class="btn gold" id="m-buy">${S.premium ? 'Desactivar premium de prueba' : 'Activar premium de prueba'}</button>
        <button class="btn alt" id="m-close">Volver</button>
      </div>
      <p class="note">Esto es una simulación: no se cobra nada. En la versión final la compra se hace con la App Store.</p>`,
    {
      'm-buy': () => {
        S.premium = !S.premium;
        if (S.premium && !S.giftGiven) { S.coins += 300; S.giftGiven = true; }
        save(); refreshHud(); premiumModal();
      },
      'm-close': closeModal,
    });
  }

  // ---------------------------------------------------------------- Niveles
  function totalStars() { return S.stars.reduce((a, b) => a + (b || 0), 0); }
  function renderLevels() {
    $('levels-stars').innerHTML = `<span style="color:var(--gold)">★</span> ${totalStars()} / ${LEVELS.length * 3}`;
    const seasons = Math.ceil(LEVELS.length / SEASON_SIZE);
    let html = '';
    for (let s = 1; s <= seasons; s++) {
      const ref = s === 1 ? S.club1 : S.club2;
      const title = ref ? club(ref.id).name : 'Nuevo club';
      const sub = ref ? `Liga de ${country(ref.country).name}` : 'Se define al fichar';
      const colors = ref ? club(ref.id).colors : ['#33466B', '#22335A'];
      html += `<div class="season"><h3>${crest(colors, true)} Temporada ${s} · ${title}</h3><p>${sub}</p><div class="grid">`;
      for (let i = (s - 1) * SEASON_SIZE; i < Math.min(LEVELS.length, s * SEASON_SIZE); i++) {
        const locked = i > S.unlocked;
        const st = S.stars[i] || 0;
        const stars = [1, 2, 3].map((k) => `<span class="${k <= st ? '' : 'off'}">★</span>`).join('');
        html += `<button class="lvl${locked ? ' locked' : ''}${i === S.unlocked ? ' current' : ''}${LEVELS[i].stage === 'seleccion' ? ' nat' : ''}" data-i="${i}" ${locked ? 'aria-disabled="true"' : ''}>
          <span class="num">${locked ? '🔒' : i + 1}</span><span class="st">${stars}</span></button>`;
      }
      html += '</div></div>';
    }
    $('levels-list').innerHTML = html;
    $('levels-list').querySelectorAll('.lvl').forEach((b) => {
      b.onclick = () => { const i = +b.dataset.i; if (i <= S.unlocked) startLevel(i); };
    });
  }

  // ---------------------------------------------------------------- Personajes
  // Las listas de aspecto (pieles, pelos, peinados, cuerpos, accesorios) las define el módulo 3D.
  const { SKINS, HAIRS, STYLES, STYLE_NAMES, BODIES, BODY_NAMES, ACCESSORIES, ACCESSORY_NAMES } = window.Players3D;
  const NUMS = [4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 21];
  const SURNAMES = ['Ramos', 'Silva', 'Costa', 'Díaz', 'Medina', 'Rojas', 'Vega', 'Ortiz', 'Castro', 'Luna', 'Torres', 'Navarro', 'Molina', 'Suárez', 'Herrera', 'Paz'];
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  // Aspecto fijo de cada jugador de un equipo: siempre el mismo para ese equipo.
  function lookFor(team, i) {
    const base = hash(team.name);
    const h = hash(team.name + '#' + i);
    return {
      colors: team.colors,
      skin: SKINS[h % SKINS.length],
      hair: HAIRS[(h >>> 4) % HAIRS.length],
      style: STYLES[(h >>> 8) % STYLES.length],
      beard: (h >>> 12) % 4 === 0,
      h: 0.95 + ((h >>> 14) % 10) / 100,
      body: BODIES[(h >>> 16) % BODIES.length],
      accessory: (h >>> 18) % 10 < 6 ? 'ninguno' : ACCESSORIES[1 + (h >>> 22) % (ACCESSORIES.length - 1)],
      num: NUMS[((base >>> 3) + i * 5) % NUMS.length],
      name: SURNAMES[((base >>> 7) + i * 7) % SURNAMES.length],
      phase: (h % 100) / 37,
    };
  }

  // ---------------------------------------------------------------- Tu jugador estrella
  const SKILLS = [
    { id: 'tiro', name: 'Tiro', help: 'Tiras desde más lejos que la línea de triple.' },
    { id: 'pase', name: 'Pase', help: 'Tus pases viajan más rápido.' },
    { id: 'manejo', name: 'Manejo', help: 'Conduces la pelota más distancia por movimiento.' },
  ];
  const SKILL_MAX = 3;
  const SKILL_COST = [80, 160, 260];
  function skills() { return Object.assign({ tiro: 0, pase: 0, manejo: 0 }, S.skills || {}); }
  function starStats() {
    const k = skills();
    return {
      starRange: E.DEFAULT_RANGE + 14 * k.tiro,
      starPass: E.SPEED + 45 * k.pase,
      starDribble: E.DRIBBLE_MAX + 18 * k.manejo,
      starShot: k.tiro,
    };
  }
  function rating() {
    const k = skills();
    return Math.min(99, 62 + 3 * (k.tiro + k.pase + k.manejo) + Math.floor(totalStars() / 4));
  }
  // Aspecto de tu jugador: índices en las listas (los campos nuevos toman el valor por defecto en
  // partidas guardadas antes de que existieran).
  function defaultMe() { return { name: '', num: 10, skin: 2, hair: 0, hairColor: 0, beard: false, body: 1, accessory: 0 }; }
  function starLook(colors, m) {
    m = Object.assign(defaultMe(), m || S.me || {});
    return {
      colors,
      skin: SKINS[m.skin], hair: HAIRS[m.hairColor], style: STYLES[m.hair], beard: !!m.beard,
      body: BODIES[m.body] || BODIES[1], accessory: ACCESSORIES[m.accessory] || ACCESSORIES[0],
      h: 1.03, num: m.num, name: m.name || 'Tú', phase: 0, star: true,
    };
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  // Colores con los que se ve tu jugador fuera de la cancha (su club actual).
  function currentColors() {
    if (!S.club1) return ['#B3202A', '#F5F0E6'];
    const i = Math.min(S.unlocked, LEVELS.length - 1);
    return myTeam(LEVELS[i].stage === 'seleccion' ? Math.max(0, i - 1) : i).colors;
  }

  function createPlayer(firstTime, onDone) {
    const d = Object.assign(defaultMe(), S.me || {});
    const colors = currentColors();
    modal(`
      <span class="eyebrow">${firstTime ? 'Crea tu jugador' : 'Editar jugador'}</span>
      <h2>Tu jugador estrella</h2>
      <div class="creator">
        <canvas class="portrait" id="cr-prev"></canvas>
        <div class="fields">
          <label class="field" for="cr-name"><span>Nombre</span>
            <input id="cr-name" maxlength="14" autocomplete="off" placeholder="Tu nombre" value="${esc(d.name)}"></label>
          <div class="field"><span>Número</span>
            <div class="stepper"><button id="cr-minus" aria-label="Bajar número">−</button><b id="cr-num">${d.num}</b><button id="cr-plus" aria-label="Subir número">+</button></div></div>
        </div>
      </div>
      <div class="field"><span>Piel</span><div class="swatches" data-k="skin">
        ${SKINS.map((s, i) => `<button class="sw${i === d.skin ? ' sel' : ''}" data-v="${i}" style="background:${s}" aria-label="Tono de piel ${i + 1}"></button>`).join('')}</div></div>
      <div class="field"><span>Peinado</span><div class="chips" data-k="hair">
        ${STYLES.map((s, i) => `<button class="chip${i === d.hair ? ' sel' : ''}" data-v="${i}">${STYLE_NAMES[s]}</button>`).join('')}</div></div>
      <div class="field"><span>Color de pelo</span><div class="swatches" data-k="hairColor">
        ${HAIRS.map((s, i) => `<button class="sw${i === d.hairColor ? ' sel' : ''}" data-v="${i}" style="background:${s}" aria-label="Color de pelo ${i + 1}"></button>`).join('')}</div></div>
      <div class="field"><span>Barba</span><div class="chips" data-k="beard">
        <button class="chip${!d.beard ? ' sel' : ''}" data-v="0">No</button><button class="chip${d.beard ? ' sel' : ''}" data-v="1">Sí</button></div></div>
      <div class="field"><span>Cuerpo</span><div class="chips" data-k="body">
        ${BODIES.map((b, i) => `<button class="chip${i === d.body ? ' sel' : ''}" data-v="${i}">${BODY_NAMES[b]}</button>`).join('')}</div></div>
      <div class="field"><span>Accesorio</span><div class="chips" data-k="accessory">
        ${ACCESSORIES.map((a, i) => `<button class="chip${i === d.accessory ? ' sel' : ''}" data-v="${i}">${ACCESSORY_NAMES[a]}</button>`).join('')}</div></div>
      <p class="note bad-note" id="cr-err" hidden>Escribe un nombre para tu jugador.</p>
      <div class="actions"><button class="btn" id="cr-ok">${firstTime ? 'Empezar mi carrera' : 'Guardar'}</button>
        ${firstTime ? '' : '<button class="btn alt" id="cr-cancel">Cancelar</button>'}</div>`,
    {
      'cr-ok': () => {
        const name = $('cr-name').value.trim();
        if (!name) { $('cr-err').hidden = false; $('cr-name').focus(); return; }
        d.name = name;
        S.me = d; save(); closeModal(); onDone && onDone();
      },
      'cr-cancel': closeModal,
      'cr-minus': () => { d.num = (d.num + 99) % 100; $('cr-num').textContent = d.num; paint(); },
      'cr-plus': () => { d.num = (d.num + 1) % 100; $('cr-num').textContent = d.num; paint(); },
    });
    const paint = () => P3.renderPortrait($('cr-prev'), starLook(colors, d), 'dribble');
    $('sheet').querySelectorAll('[data-k]').forEach((box) => {
      const key = box.dataset.k;
      box.querySelectorAll('button').forEach((b) => {
        b.onclick = () => {
          const v = +b.dataset.v;
          d[key] = key === 'beard' ? v === 1 : v;
          box.querySelectorAll('button').forEach((o) => o.classList.toggle('sel', o === b));
          paint();
        };
      });
    });
    $('cr-name').oninput = () => { $('cr-err').hidden = true; };
    paint();
  }

  function playerModal() {
    const me = S.me, c = country(S.country);
    const k = skills();
    const k1 = club(S.club1.id);
    const k2 = S.club2 ? club(S.club2.id) : null;
    modal(`
      <span class="eyebrow">Mi jugador</span>
      <div class="me-head"><canvas class="portrait" id="me-portrait"></canvas>
        <div class="meta"><h2>${esc(me.name)}</h2>
          <div class="me-sub">#${me.num} · ${c.flag} ${c.name}</div>
          <div class="rating"><b>${rating()}</b><span>Media</span></div></div></div>
      <h3 class="sec">Entrenamiento</h3>
      ${SKILLS.map((sk) => {
        const lvl = k[sk.id], cost = SKILL_COST[lvl];
        return `<div class="skill"><div class="meta"><div class="name">${sk.name}
          <span class="pips">${[0, 1, 2].map((i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</span></div>
          <div class="league">${sk.help}</div></div>
          ${lvl >= SKILL_MAX ? '<span class="maxed">Máximo</span>'
            : `<button class="btn gold small" id="m-up-${sk.id}" ${S.coins < cost ? 'disabled' : ''}><span class="coin"></span> ${cost}</button>`}</div>`;
      }).join('')}
      <p class="note">Las mejoras solo valen para tu jugador. Ganas monedas al superar niveles.</p>
      <h3 class="sec">Carrera</h3>
      <div class="offer">${crest(k1.colors)}<div class="meta"><div class="name">${k1.name}</div><div class="league">Temporada 1 · Liga de ${country(S.club1.country).name}</div></div></div>
      ${k2 ? `<div class="offer">${crest(k2.colors)}<div class="meta"><div class="name">${k2.name}</div><div class="league">Temporada 2 · Liga de ${country(S.club2.country).name}</div></div></div>`
        : '<p class="note">Al terminar la temporada 1 recibes ofertas de clubes de otros países.</p>'}
      <div class="offer"><span class="flag" style="font-size:34px">${c.flag}</span><div class="meta"><div class="name">Selección de ${c.name}</div><div class="league">Te convoca en los niveles marcados como Selección</div></div></div>
      <div class="actions">
        <button class="btn" id="m-close">Listo</button>
        <button class="btn alt" id="m-look">Editar jugador</button>
        <button class="btn alt" id="m-country">Cambiar nacionalidad</button>
      </div>`,
    Object.assign({
      'm-close': closeModal,
      'm-look': () => createPlayer(false, () => { renderHome(); playerModal(); }),
      'm-country': () => chooseCountry(false, () => { renderHome(); playerModal(); }),
    }, Object.fromEntries(SKILLS.map((sk) => ['m-up-' + sk.id, () => {
      const lvl = skills()[sk.id], cost = SKILL_COST[lvl];
      if (lvl >= SKILL_MAX || S.coins < cost) return;
      S.coins -= cost;
      S.skills = Object.assign(skills(), { [sk.id]: lvl + 1 });
      save(); refreshHud(); renderHome(); playerModal();
    }]))));
    P3.renderPortrait($('me-portrait'), starLook(currentColors()), 'dribble');
  }

  // ---------------------------------------------------------------- Partida
  const G = {
    idx: 0, level: null, solution: null, mode: 'plan',
    st: null, anim: null, drag: null, charge: null, hint: false, hintCache: null,
    mine: null, rival: null, myLooks: [], rivalLooks: [],
    orbit: null,                 // gesto en curso que gira la cámara (arrastre fuera del poseedor)
  };

  function startLevel(i) {
    tickLives();
    if (!S.premium && S.lives <= 0) return noLives(() => startLevel(i));
    // Temporada 2 sin club: primero el fichaje
    if (seasonOf(i) >= 2 && !S.club2) return transferOffers(() => startLevel(i));
    const lv = LEVELS[i];
    if (lv.stage === 'seleccion' && !S.called[i]) {
      S.called[i] = true; save();
      return callUp(i, () => startLevel(i));
    }
    G.idx = i; G.level = Object.assign({}, lv, { starIdx: lv.star || 0 }, starStats()); G.solution = E.solve(lv);
    G.mine = myTeam(i); G.rival = rivalTeam(i);
    G.myLooks = lv.players.map((_, k) => {
      if (k === G.level.starIdx) return starLook(G.mine.colors);
      const lk = lookFor(G.mine, k);
      if (lk.num === S.me.num) lk.num = (lk.num + 20) % 100;
      return lk;
    });
    // Los pívots (tall) se ven más altos y fornidos que el resto del equipo rival; cuando hay uno,
    // los demás defensores no son fornidos ni tan altos, para que se lo distinga a simple vista
    const hasTall = (lv.defenders || []).some((d) => d.tall);
    G.rivalLooks = (lv.defenders || []).map((d, k) => {
      const lk = lookFor(G.rival, k);
      if (d.tall) { lk.body = 'fornido'; lk.h = 1.08; }
      else if (hasTall) { if (lk.body === 'fornido') lk.body = 'atletico'; lk.h = Math.min(lk.h, 1.01); }
      return lk;
    });
    G.hint = false;
    scene.setOrbit({ yaw: 0, pitch: 0, instant: true });
    buildCast();
    resetPlay();
    show('game');
    $('game-label').innerHTML = `Nivel ${i + 1} · ${lv.name}<small>${G.mine.name} vs ${G.rival.name}</small>`;
    levelCard();
  }

  function resetPlay() {
    G.st = E.initState(G.level);
    G.anim = null; G.drag = null; G.orbit = null; G.hintCache = null;
    stopCharge();
    G.mode = 'plan';
    clearFloat();
    planCamera(true);
    $('tipbar').textContent = G.level.tip;
    updateMoveBar();
    updateHintBtn();
  }

  const movesWord = (n) => (n === 1 ? 'movimiento' : 'movimientos');

  function updateMoveBar() {
    const min = G.solution.minMoves;
    $('movebar').innerHTML = `<span><b>${G.st.moves}</b> ${movesWord(G.st.moves)}</span>
      <span class="goal"><span style="color:var(--gold)">★★★</span> con ${min === 0 ? 'tiro directo' : min + ' ' + movesWord(min)}</span>`;
  }

  function levelCard() {
    const lv = G.level, min = G.solution.minMoves;
    const defs = lv.defenders || [], talls = defs.filter((d) => d.tall).length;
    modal(`
      <span class="eyebrow">Temporada ${seasonOf(G.idx)} · Nivel ${G.idx + 1}${lv.stage === 'seleccion' ? ' · Selección' : ''}</span>
      <h2>${lv.name}</h2>
      <div class="matchup">
        <div class="side">${crest(G.mine.colors, true)}<span>${G.mine.name}</span></div>
        <span class="vs">VS</span>
        <div class="side right"><span>${G.rival.name}</span>${crest(G.rival.colors, true)}</div>
      </div>
      <p>${lv.tip}</p>
      <p class="note">${(lv.holder || 0) === (lv.star || 0)
        ? `Empiezas tú con la pelota: <b style="color:var(--gold)">★ ${esc(S.me.name)}</b>.`
        : `La pelota la tiene <b>#${G.myLooks[lv.holder || 0].num} ${esc(G.myLooks[lv.holder || 0].name)}</b>. Tu jugador <b style="color:var(--gold)">★ ${esc(S.me.name)}</b> espera libre: búscalo para definir.`}</p>
      <div class="facts">
        <div class="fact"><b>${min === 0 ? 'Tiro directo' : min + ' ' + movesWord(min)}</b><span>para 3 estrellas</span></div>
        <div class="fact"><b>${defs.length - talls}</b><span>${defs.length - talls === 1 ? 'defensor' : 'defensores'}${talls ? ` · ${talls} ${talls === 1 ? 'pívot' : 'pívots'}` : ''}</span></div>
      </div>
      <ul class="howto">
        <li><b>Pase:</b> arrastra del jugador con la pelota a un compañero.</li>
        <li><b>Conducir:</b> arrastra a un espacio libre para avanzar unos pasos.</li>
        <li><b>Tiro:</b> traza la línea hacia el centro del aro; después mantén presionado para cargar fuerza y suelta en la zona verde.</li>
      </ul>
      <p class="note">Juegas un movimiento por vez. Los rivales solo se mueven mientras se ejecuta tu movimiento.</p>
      <div class="actions"><button class="btn" id="m-go">A jugar</button></div>`,
    { 'm-go': () => { closeModal(); G.mode = 'plan'; } });
  }

  // ¿El defensor más cercano al punto donde falló el último movimiento es un pívot?
  function tallCulprit() {
    const res = G.anim && G.anim.res;
    if (!res || res.ok || !res.failPos) return false;
    const defs = G.level.defenders || [];
    let best = null, bd = Infinity;
    defs.forEach((d) => {
      const p = E.defenderPos(d, res.leg.t1);
      const dd = E.dist(p.x, p.y, res.failPos.x, res.failPos.y);
      if (dd < bd) { bd = dd; best = d; }
    });
    return !!(best && best.tall);
  }

  function updateHintBtn() {
    const b = $('btn-hint');
    b.textContent = G.hint ? 'Ayuda activa' : `Ayuda · ${HINT_COST}`;
    b.disabled = G.hint;
  }

  function useHint() {
    if (G.hint || G.mode !== 'plan') return;
    if (S.coins >= HINT_COST) {
      S.coins -= HINT_COST; save(); refreshHud();
      G.hint = true; updateHintBtn(); hintText();
      return;
    }
    modal(`
      <span class="eyebrow">Ayuda</span>
      <h2>Te faltan monedas</h2>
      <p>La ayuda cuesta ${HINT_COST} monedas y tienes ${S.coins}. Mira un anuncio y te mostramos el mejor movimiento gratis.</p>
      <div class="actions"><button class="btn gold" id="m-ad">Ver anuncio</button><button class="btn alt" id="m-close">Volver</button></div>`,
    {
      'm-ad': () => { closeModal(); showAd(true, () => { G.hint = true; updateHintBtn(); hintText(); }); },
      'm-close': closeModal,
    });
  }

  // Mejor jugada desde la situación actual (se recalcula después de cada movimiento).
  function currentHint() {
    if (!G.hint) return null;
    if (!G.hintCache || G.hintCache.moves !== G.st.moves || G.hintCache.t !== G.st.t) {
      G.hintCache = { moves: G.st.moves, t: G.st.t, sol: E.solve(G.level, G.st) };
    }
    return G.hintCache.sol.best;
  }
  function hintText() {
    const best = currentHint();
    if (!G.hint) return;
    if (!best) $('tipbar').textContent = 'Desde aquí no hay una jugada de pases segura. Prueba conducir la pelota o reinicia el nivel.';
    else if (best.chain[1] === 'H') $('tipbar').textContent = 'Ayuda: tira al aro.';
    else $('tipbar').textContent = `Ayuda: pasa a ${G.myLooks[best.chain[1]].name} (#${G.myLooks[best.chain[1]].num}).`;
  }

  function askRestart() {
    if (G.mode !== 'plan' || !G.st.moves) return;
    if (S.premium) { resetPlay(); return; }
    modal(`
      <span class="eyebrow">Reiniciar</span>
      <h2>¿Empezar de nuevo?</h2>
      <p>Reiniciar una jugada empezada cuesta una vida. Te quedan ${S.lives}.</p>
      <div class="actions"><button class="btn" id="m-yes">Reiniciar (−1 vida)</button><button class="btn alt" id="m-no">Seguir jugando</button></div>`,
    {
      'm-yes': () => {
        closeModal(); loseLife(); refreshHud();
        if (S.lives <= 0) return noLives(() => resetPlay());
        const keep = G.hint; resetPlay(); G.hint = keep; updateHintBtn(); hintText();
      },
      'm-no': closeModal,
    });
  }

  function noLives(retry) {
    const left = Math.max(0, LIFE_MS - (Date.now() - S.lifeTs));
    const m = Math.ceil(left / 60000);
    modal(`
      <span class="eyebrow">Sin vidas</span>
      <h2>Toca descansar</h2>
      <p>Recuperas una vida cada 15 minutos. La próxima llega en ${m} min.</p>
      <div class="actions">
        <button class="btn gold" id="m-ad">Ver anuncio: +1 vida</button>
        <button class="btn" id="m-prem">Premium: vidas infinitas</button>
        <button class="btn alt" id="m-close">Volver</button>
      </div>`,
    {
      'm-ad': () => { closeModal(); showAd(true, () => { S.lives = Math.min(LIFE_MAX, S.lives + 1); save(); refreshHud(); retry && retry(); }); },
      'm-prem': premiumModal,
      'm-close': () => { closeModal(); if (current === 'game') show('levels'); },
    });
  }

  function callUp(i, onDone) {
    const c = country(S.country);
    const rival = rivalTeam(i);
    modal(`
      <span class="eyebrow">Convocatoria</span>
      <div style="font-size:64px;line-height:1">${c.flag}</div>
      <h2>${esc(S.me.name)}, te convocó la selección de ${c.name}</h2>
      <p>${i === LEVELS.length - 1 ? 'Juegas la final' : 'Juegas un partido internacional'} contra ${rival.name}. Defiendes la camiseta de tu país.</p>
      <div class="actions"><button class="btn" id="m-ok">Vestir la camiseta</button></div>`,
    { 'm-ok': () => { closeModal(); onDone(); } });
  }

  function transferOffers(onDone) {
    const own = S.club1.id;
    const pool = CLUBS.filter((c) => c.id !== own);
    const others = COUNTRIES.filter((c) => c.code !== S.country);
    const seed = COUNTRIES.findIndex((c) => c.code === S.country) + 1;
    const offers = [0, 1, 2].map((k) => ({
      club: pool[(seed * 3 + k * 4) % pool.length],
      country: others[(seed * 5 + k * 6) % others.length],
      bonus: [80, 120, 160][k],
    }));
    modal(`
      <span class="eyebrow">Fin de la temporada 1</span>
      <h2>Tres clubes quieren ficharte</h2>
      <p>Tu temporada llamó la atención, ${esc(S.me.name)}. Elige tu nuevo club: cada uno juega en otra liga y te paga una prima de fichaje en monedas.</p>
      ${offers.map((o, k) => `<button class="offer" id="m-o${k}">${crest(o.club.colors)}<div class="meta"><div class="name">${o.club.name}</div><div class="league">${o.country.flag} Liga de ${o.country.name}</div></div><span class="bonus">+${o.bonus}</span></button>`).join('')}`,
    Object.fromEntries(offers.map((o, k) => ['m-o' + k, () => {
      S.club2 = { id: o.club.id, country: o.country.code };
      S.coins += o.bonus; save(); refreshHud(); closeModal(); onDone();
    }])));
  }

  function finishLevel(ok, reason) {
    if (ok) {
      const moves = G.st.moves;
      const min = G.solution.minMoves;
      const st = E.stars(moves, min);
      const prev = S.stars[G.idx] || 0;
      const earned = Math.max(0, st - prev) * 10 + 5;
      S.stars[G.idx] = Math.max(prev, st);
      S.coins += earned;
      S.unlocked = Math.max(S.unlocked, G.idx + 1);
      S.sinceAd++;
      save(); refreshHud();
      const last = G.idx === LEVELS.length - 1;
      const msg = st === 3 ? '¡Jugada perfecta!' : st === 2 ? 'Bien jugado. Se puede con un movimiento menos.' : 'Entró, pero hay un camino más corto.';
      modal(`
        <span class="eyebrow">Nivel ${G.idx + 1} superado</span>
        <h2>${last ? '¡Campeones!' : 'Canasta'}</h2>
        <div class="big-stars">${[1, 2, 3].map((k) => `<span class="${k <= st ? 'on' : ''}">★</span>`).join('')}</div>
        <p style="text-align:center">${msg}</p>
        <div class="facts">
          <div class="fact"><b>${moves}</b><span>${movesWord(moves)} (mínimo ${min})</span></div>
          <div class="fact"><b>+${earned}</b><span>monedas</span></div>
        </div>
        ${last ? '<p>Ganaste la final con tu selección. Aquí termina el prototipo: la versión completa tendrá muchos más mundos.</p>' : ''}
        <div class="actions">
          ${last ? '' : '<button class="btn" id="m-next">Siguiente nivel</button>'}
          <button class="btn alt" id="m-retry">Repetir</button>
          <button class="btn alt" id="m-levels">Niveles</button>
        </div>`,
      {
        'm-next': () => { closeModal(); afterWin(() => startLevel(G.idx + 1)); },
        'm-retry': () => { closeModal(); afterWin(() => startLevel(G.idx)); },
        'm-levels': () => { closeModal(); afterWin(() => show('levels')); },
      });
    } else {
      loseLife();
      refreshHud();
      const texts = {
        intercepcion: ['Pelota robada', 'Un defensor cortó el pase. Fíjate hacia dónde se mueven los rivales.'],
        robo: ['Te la robaron', 'Condujiste demasiado cerca de un defensor.'],
        tapon: ['Tapón', 'Tenías un defensor encima. Tira desde donde estés libre.'],
        lejos: ['Muy lejos', 'Tiraste desde fuera de la línea de triple: la pelota no llega.'],
        desviado: ['Tiro desviado', 'La línea no pasó por el centro del aro y la pelota pegó en el costado. Apunta con más precisión.'],
        corto: ['Tiro corto', 'Te faltó fuerza. Suelta más arriba en la barra, dentro de la zona verde.'],
        largo: ['Tiro largo', 'Te pasaste de fuerza y la pelota pegó en el tablero. Suelta antes, dentro de la zona verde.'],
      };
      // Si el que robó o tapó fue el pívot, el mensaje lo dice: su alcance es mayor
      const tallTexts = {
        intercepcion: ['El pívot la robó', 'El pívot llega más lejos que un defensor común: el pase pasó cerca de sus brazos. Pasa lejos de él.'],
        robo: ['El pívot te la robó', 'Condujiste cerca del pívot, y sus brazos llegan más lejos que los de un defensor común.'],
        tapon: ['Tapón del pívot', 'El pívot tapa tiros desde más lejos que un defensor común. Aléjate de él antes de tirar.'],
      };
      const t = (tallCulprit() && tallTexts[reason]) || texts[reason] || ['Jugada fallida', 'Inténtalo de nuevo.'];
      modal(`
        <span class="eyebrow">Nivel ${G.idx + 1}</span>
        <h2>${t[0]}</h2>
        <p>${t[1]}</p>
        <p class="note">${S.premium ? 'Premium: no pierdes vidas.' : `Perdiste una vida. Te quedan ${S.lives}.`}</p>
        <div class="actions">
          <button class="btn" id="m-retry">Reintentar</button>
          <button class="btn alt" id="m-levels">Niveles</button>
        </div>`,
      {
        'm-retry': () => {
          closeModal();
          if (!S.premium && S.lives <= 0) return noLives(() => resetPlay());
          const keep = G.hint; resetPlay(); G.hint = keep; updateHintBtn(); hintText();
        },
        'm-levels': () => { closeModal(); show('levels'); },
      });
    }
  }

  // Anuncio entre niveles cada cierto número de victorias (no en Premium).
  function afterWin(next) {
    if (!S.premium && S.sinceAd >= AD_EVERY) {
      S.sinceAd = 0; save();
      showAd(false, next);
    } else next();
  }

  // ---------------------------------------------------------------- Mensajes sobre la cancha
  function floatMsg(text, kind) {
    clearFloat();
    const el = document.createElement('div');
    el.className = 'float-msg ' + (kind || '');
    el.textContent = text;
    el.id = 'float';
    $('stage').appendChild(el);
  }
  function clearFloat() { const f = $('float'); if (f) f.remove(); }

  // ---------------------------------------------------------------- Escena 3D
  // Un solo renderer para todo el juego: el canvas vive dentro de #stage durante la partida y se
  // muda a la portada (#hero-court) en el inicio. La escena, el estadio y la pelota se crean una vez.
  const cv = $('court');
  const stage = $('stage');
  const P3 = window.Players3D;
  const HOOP = E.HOOP, HOOP_H = Scene3D.HOOP_H;
  const scene = Scene3D.create({ canvas: cv });
  // ?calidad=media|baja permite probar en equipos lentos o sin GPU
  const qualityParam = new URLSearchParams(location.search).get('calidad');
  if (qualityParam) scene.setQuality(qualityParam);

  function resize() {
    const host = cv.parentElement;
    if (!host) return;
    const r = host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    scene.resize(r.width, r.height, window.devicePixelRatio || 1);
    // En la partida la interfaz va superpuesta al 3D: el encuadre deja libres las dos franjas
    const inGame = host === stage;
    scene.setInsets({ top: inGame ? $('game-top').offsetHeight : 0, bottom: inGame ? $('game-bottom').offsetHeight : 0 });
    // El encuadre depende del tamaño del área: se recalcula si se está planeando
    if (current === 'game' && G.st && (G.mode === 'plan' || G.mode === 'charge')) planCamera(true);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(stage);
  observer.observe($('hero-court'));
  observer.observe($('game-bottom'));
  window.addEventListener('resize', resize);

  // Mueve el canvas al contenedor de la pantalla activa (va primero para quedar debajo de la interfaz).
  function mountCanvas(host) {
    if (cv.parentElement !== host) host.prepend(cv);
    resize();
  }

  // Jugadores 3D vivos: los de la portada y los de la partida (propios y rivales).
  const cast = { hero: [], mine: [], rivals: [] };
  function disposeAll(list) { list.forEach((p) => p.dispose()); list.length = 0; }

  // Gira al jugador hacia un punto de la cancha con suavidad (sin saltos al cambiar de objetivo).
  function turnTo(p, x, y, dt) {
    const dx = (x - 180) - p.object.position.x, dz = (y - 300) - p.object.position.z;
    if (dx * dx + dz * dz < 1e-4) return;
    const goal = Math.atan2(dx, dz);
    let d = goal - p.facing;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    p.setFacing(p.facing + d * (1 - Math.exp(-dt * 10)));
  }

  // Centro de la pelota en la mano derecha de un jugador (coordenadas de cancha + altura).
  function handBall(p) {
    const h = p.handWorld('derecha');
    const c = scene.worldToCourt(h);
    return { x: c.x, y: c.y, h: Math.max(3.2, h.y - 3.2) };
  }
  const placeBall = (b) => scene.ball.set(b.x, b.y, b.h - 3.2, true);

  // ---------------------------------------------------------------- Portada
  const HERO_RIVAL = { name: 'Centellas', colors: ['#F2C230', '#22223B'] };
  const HERO_SPOTS = [[95, 320, 'dribble'], [255, 262, 'idle'], [175, 200, 'catch']];
  const HERO_RIVAL_SPOTS = [[178, 278], [120, 232]];
  let heroKey = '';
  function heroTeam() {
    return S.club1 ? myTeam(Math.min(S.unlocked, LEVELS.length - 1)) : { name: 'Halcones', colors: ['#B3202A', '#F5F0E6'] };
  }
  // Jugadores decorativos de la portada: tu jugador y compañeros con los colores del club actual.
  function buildHero() {
    const team = heroTeam();
    const looks = HERO_SPOTS.map((_, i) => (i === 0 && S.me ? starLook(team.colors) : lookFor(team, i)));
    const key = JSON.stringify(looks);
    if (key === heroKey) return;
    heroKey = key;
    disposeAll(cast.hero);
    looks.forEach((lk, i) => {
      const p = P3.create(lk);
      p.setCourtPosition(HERO_SPOTS[i][0], HERO_SPOTS[i][1]).setPose(HERO_SPOTS[i][2]);
      p.faceCourt(i === 0 ? 245 : HERO_SPOTS[0][0], i === 0 ? 266 : HERO_SPOTS[0][1]);
      p.setStar(false);
      cast.hero.push(p);
    });
    cast.hero[0].setRing('#FFC53D');
    HERO_RIVAL_SPOTS.forEach((s, i) => {
      const p = P3.create(lookFor(HERO_RIVAL, i), { rival: true });
      p.setCourtPosition(s[0], s[1]).setPose('guard').faceCourt(HERO_SPOTS[0][0], HERO_SPOTS[0][1]);
      cast.hero.push(p);
    });
    scene.setTeams([team.colors, HERO_RIVAL.colors]);
    if (current === 'home') cast.hero.forEach((p) => scene.add(p.object));
  }
  function enterHome() {
    mountCanvas($('hero-court'));
    cast.mine.concat(cast.rivals).forEach((p) => scene.remove(p.object));
    cast.hero.forEach((p) => scene.add(p.object));
    scene.overlay.clear();
    scene.overlay.line([{ x: HERO_SPOTS[0][0], y: HERO_SPOTS[0][1] }, { x: 245, y: 266 }], { color: '#FFFFFF', width: 3, arrow: true, alpha: 0.9 });
    scene.setCamera({ mode: 'cinematic', instant: true });
  }
  function heroFrame(now, dt) {
    cast.hero.forEach((p) => p.update(now));
    if (cast.hero.length) placeBall(handBall(cast.hero[0]));
    scene.update(now, dt);
    scene.render();
  }

  // ---------------------------------------------------------------- Partida: jugadores y cámara
  function buildCast() {
    disposeAll(cast.mine); disposeAll(cast.rivals);
    cast.hero.forEach((p) => scene.remove(p.object));
    G.myLooks.forEach((lk) => { const p = P3.create(lk); scene.add(p.object); cast.mine.push(p); });
    G.rivalLooks.forEach((lk) => { const p = P3.create(lk, { rival: true }); scene.add(p.object); cast.rivals.push(p); });
    scene.setTeams([G.mine.colors, G.rival.colors]);
    scene.overlay.clear();
  }
  function enterGame() { mountCanvas(stage); }

  // Puntos que la cámara debe encuadrar en modo plan: compañeros y defensores (el aro lo agrega
  // la escena).
  function framingPoints(gt) {
    const pts = [];
    G.st.pos.forEach((p, i) => { if (i !== G.st.holder) pts.push({ x: p[0], y: p[1] }); });
    (G.level.defenders || []).forEach((d) => pts.push(E.defenderPos(d, gt)));
    return pts;
  }
  function planCamera(instant) {
    const hp = G.st.pos[G.st.holder];
    scene.setCamera({ mode: 'holder', holder: { x: hp[0], y: hp[1] }, points: framingPoints(G.st.t), instant: !!instant });
  }
  // Arranca la animación de un movimiento ya resuelto por el motor.
  function startMove(res) {
    G.anim = { res, real0: performance.now(), done: false, release: null };
    G.mode = 'anim';
    G.drag = null;
    $('tipbar').textContent = '';
    // La cámara sigue la pelota sin perder de vista al que la jugó (queda entre los puntos a encuadrar)
    const hp = G.st.pos[G.st.holder];
    scene.setCamera({ mode: 'follow', target: { x: hp[0], y: hp[1], h: 30 }, points: framingPoints(G.st.t).concat([{ x: hp[0], y: hp[1] }]) });
  }

  // ---------------------------------------------------------------- Partida: overlays sobre el piso
  const defIndexNear = (q) => {
    let best = -1, bd = Infinity;
    (G.level.defenders || []).forEach((d, k) => {
      const p = E.defenderPos(d, G.st.t);
      const dd = E.dist(p.x, p.y, q.x, q.y);
      if (dd < bd) { bd = dd; best = k; }
    });
    return best;
  };
  const hoopTop = { x: HOOP.x, y: HOOP.y, h: HOOP_H };
  let overlayKey = '';
  function drawOverlay(now, gt, defPos) {
    const ov = scene.overlay;
    const planning = G.mode === 'plan' || G.mode === 'charge';
    if (!planning) { if (overlayKey) { ov.clear(); overlayKey = ''; } return; }
    const lv = G.level;
    const animated = G.hint || (lv.defenders || []).some((d) => d.path && d.speed);
    const key = [G.mode, JSON.stringify(G.drag), G.hint, G.st.holder, G.st.moves, animated ? Math.floor(now / 90) : 0].join('|');
    if (key === overlayKey) return;
    overlayKey = key;
    ov.clear();
    const hp = G.st.pos[G.st.holder];
    const a = { x: hp[0], y: hp[1] };

    // Alcance de robo de cada defensor (el del pívot es mayor) y, para los que se mueven, su ruta
    // con una flecha hacia donde van y una huella que anticipa
    (lv.defenders || []).forEach((d, k) => {
      ov.circle(defPos[k], E.defReach(d) + E.BALL_R, { color: '#F0565B', dashed: true, alpha: d.tall ? 0.75 : 0.6, width: d.tall ? 1.8 : 1.4 });
      if (!d.path) return;
      ov.line([[d.x, d.y]].concat(d.path), { color: '#FFFFFF', width: 2, dashed: true, alpha: 0.5 });
      const p0 = E.defenderPos(d, gt), p1 = E.defenderPos(d, gt + 0.08);
      const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      ov.line([p0, { x: p0.x + Math.cos(ang) * 34, y: p0.y + Math.sin(ang) * 34 }], { color: '#FFFFFF', width: 2.6, arrow: true, alpha: 0.95 });
      ov.disc(E.defenderPos(d, gt + (now / 1000) % 2.4), 12, { color: '#F0565B', alpha: 0.28 });
    });

    // Ayuda: la mejor jugada, latiendo
    const best = G.mode === 'plan' ? currentHint() : null;
    if (best) {
      const alpha = 0.55 + 0.3 * Math.sin(now / 220);
      if (best.chain[1] === 'H') ov.arc(a, hoopTop, HOOP_H + 40, { color: '#9FE8C3', dashed: true, alpha });
      else { const bp = G.st.pos[best.chain[1]]; ov.line([a, { x: bp[0], y: bp[1] }], { color: '#9FE8C3', width: 3, dashed: true, arrow: true, alpha }); }
    }

    // Previsualización del movimiento que se está arrastrando
    const d = G.mode === 'plan' ? G.drag : null;
    if (d && d.kind === 'shot') {
      const range = E.rangeFor(lv, G.st.holder);
      const far = E.dist(a.x, a.y, HOOP.x, HOOP.y) > range;
      ov.circle(HOOP, range, { color: far ? '#F0565B' : '#3CC17F', fill: true, alpha: 0.55, width: 2 });
      ov.arc(a, { x: d.x, y: d.y, h: HOOP_H }, HOOP_H + 40, { color: far ? '#F0565B' : '#FFC53D', dashed: true });
    } else if (d && d.kind === 'pass') {
      const bp = G.st.pos[d.to];
      const b = { x: bp[0], y: bp[1] };
      ov.line([a, b], { color: '#FFFFFF', width: 3.2, arrow: true });
    } else if (d && d.kind === 'dribble') {
      const tgt = E.dribbleTarget(lv, G.st, d.x, d.y);
      ov.circle(a, E.dribbleMaxFor(lv, G.st.holder), { color: '#9FE8C3', dashed: true, alpha: 0.45, width: 1.4 });
      ov.line([a, tgt], { color: '#9FE8C3', width: 3, dashed: true, arrow: true });
      ov.disc(tgt, 13, { color: '#9FE8C3', alpha: 0.35 });
    }
    // Cargando fuerza: la dirección ya quedó fijada
    if (G.mode === 'charge' && G.charge) ov.arc(a, { x: G.charge.aim.x, y: G.charge.aim.y, h: HOOP_H }, HOOP_H + 40, { color: '#FFC53D', dashed: true });
  }

  // Cartel con el nombre del poseedor, sobre su cabeza (div HTML posicionado con la cámara).
  const nameTag = $('nametag');
  function placeNameTag(visible) {
    if (!visible) { nameTag.hidden = true; return; }
    const holder = G.st.holder, L = G.myLooks[holder], hp = G.st.pos[holder];
    const s = scene.courtToScreen(hp[0], hp[1], P3.HEIGHT * (L.h || 1) + 3);
    const r = cv.getBoundingClientRect();
    if (s.depth < 0 || s.x < 0 || s.y < 0 || s.x > r.width || s.y > r.height) { nameTag.hidden = true; return; }
    nameTag.textContent = L.star ? `★ ${L.name} · #${L.num}` : `#${L.num} ${L.name}`;
    nameTag.hidden = false;
    // con la cámara girada el poseedor puede quedar en el borde: el cartel no se sale de la pantalla
    const half = (nameTag.offsetWidth || 80) / 2 + 6;
    nameTag.style.left = Math.max(half, Math.min(r.width - half, s.x)) + 'px';
    nameTag.style.top = s.y + 'px';
  }

  // ---------------------------------------------------------------- Partida: un fotograma
  function gameFrame(now, dt) {
    const lv = G.level;
    let A = G.anim, leg = A ? A.res.leg : null;
    // Tiempo del partido: congelado salvo mientras se ejecuta un movimiento
    let gt = G.st.t, f = 0;
    if (A) {
      const el = (now - A.real0) / 1000;
      gt = Math.min(leg.t1, leg.t0 + el);
      f = leg.t1 > leg.t0 ? (gt - leg.t0) / (leg.t1 - leg.t0) : 1;
      if (el >= leg.t1 - leg.t0 && !A.done) { A.done = true; onMoveEnd(A); }
      // Movimiento correcto: ya se juega desde el nuevo estado
      if (!G.anim) { A = null; leg = null; gt = G.st.t; f = 0; }
    }
    const st = G.st, holder = st.holder;
    const r = A ? A.res : null;
    const ended = !!(A && A.done);
    const planning = G.mode === 'plan' || G.mode === 'charge';
    const actor = leg && leg.who != null ? leg.who : holder;
    const defPos = (lv.defenders || []).map((d) => E.defenderPos(d, gt));

    // Jugadores propios: posición, pose, dirección, aro y estrella
    st.pos.forEach((p, i) => {
      const P = cast.mine[i];
      let x = p[0], y = p[1], pose = i === holder ? 'dribble' : 'idle', jump = 0, ring = null, face = HOOP;
      if (i === holder && planning) ring = '#FFC53D';
      if (leg && actor === i) {
        if (leg.type === 'dribble') {
          x = leg.from.x + (leg.to.x - leg.from.x) * f; y = leg.from.y + (leg.to.y - leg.from.y) * f;
          pose = f < 1 ? 'run' : 'dribble'; face = f < 1 ? leg.to : HOOP;
        } else if (leg.type === 'pass') { pose = f < 0.35 ? 'pass' : 'idle'; face = leg.to; }
        else { pose = leg.blocked ? 'catch' : 'shoot'; jump = Math.sin(Math.PI * Math.min(1, f * 1.6)) * 12; }
      }
      if (leg && leg.type === 'pass' && leg.target === i) { pose = 'catch'; face = leg.from; }
      if (ended) {
        jump = 0;
        if (r.scored) pose = i === actor ? 'celebrate' : (i % 2 ? 'catch' : 'celebrate');
        else if (i === actor) pose = 'sad';
      }
      if (G.drag && G.drag.kind === 'pass' && G.drag.to === i) ring = '#FFFFFF';
      P.setCourtPosition(x, y);
      turnTo(P, face.x, face.y, dt);
      P.setPose(pose); P.setJump(jump); P.setRing(ring);
      P.setStar(i === lv.starIdx && !(i === holder && planning));
      P.update(now);
    });

    // Pelota: centro en coordenadas de cancha + altura
    let ball;
    if (ended && !r.ok) {
      const k = Math.min(1, (now - A.doneAt) / 350);
      const fp = r.failPos, h0 = leg.type === 'pass' ? 33 : (leg.board ? 80 : 20);
      ball = { x: fp.x, y: fp.y, h: 3.2 + (h0 - 3.2) * (1 - k) };
    } else if (ended && r.scored) {
      const k = Math.min(1, (now - A.doneAt) / 600);
      ball = { x: HOOP.x, y: HOOP.y, h: HOOP_H - (HOOP_H - 3.2) * k * k };
      scene.hoop.swish(Math.min(1, k * 1.5));
    } else if (!A || leg.type === 'dribble') {
      ball = handBall(cast.mine[actor]);
    } else if (leg.type === 'pass') {
      ball = { x: leg.from.x + (leg.to.x - leg.from.x) * f, y: leg.from.y + (leg.to.y - leg.from.y) * f, h: 33 + Math.sin(Math.PI * f) * 6 };
    } else if (leg.blocked) {
      ball = { x: leg.from.x + 16 * f, y: leg.from.y + 8 * f, h: 3.2 + 50 * (1 - f) + Math.sin(Math.PI * f) * 10 };
    } else {
      // Tiro: la pelota sale de la mano cuando los brazos ya están arriba y describe una parábola
      const fr = Math.max(0, (f - 0.15) / 0.85);
      if (fr <= 0) ball = handBall(cast.mine[actor]);
      else {
        if (!A.release) A.release = handBall(cast.mine[actor]);
        const h1 = r.scored ? HOOP_H : (leg.board ? 80 : 3.2);
        ball = {
          x: A.release.x + (leg.to.x - A.release.x) * fr, y: A.release.y + (leg.to.y - A.release.y) * fr,
          h: A.release.h + (h1 - A.release.h) * fr + Math.sin(Math.PI * fr) * 40,
        };
      }
    }
    if (!(ended && r.scored)) scene.hoop.swish(0);
    placeBall(ball);
    if (A && !ended) scene.ball.spin(dt);

    // Defensores: siguen la pelota con la mirada; al robar o tapar, el más cercano reacciona
    let stealer = -1, blocker = -1;
    if (ended && !r.ok) {
      if (r.reason === 'intercepcion' || r.reason === 'robo') stealer = defIndexNear(r.failPos);
      if (r.reason === 'tapon') blocker = defIndexNear(leg.from);
    }
    (lv.defenders || []).forEach((d, k) => {
      const P = cast.rivals[k], p = defPos[k];
      const moving = !!(A && !ended && d.path && d.speed);
      let pose = moving ? 'run' : 'guard';
      let face = ball;
      if (moving) face = E.defenderPos(d, gt + 0.05);
      if (k === stealer) pose = 'steal';
      if (k === blocker) pose = 'catch';
      P.setCourtPosition(p.x, p.y);
      turnTo(P, face.x, face.y, dt);
      P.setPose(pose);
      P.update(now);
    });

    // Cámara: sigue la pelota durante el movimiento; en modo plan ya quedó detrás del poseedor
    if (A && !ended) scene.setCamera({ mode: 'follow', target: { x: ball.x, y: ball.y, h: ball.h } });

    drawOverlay(now, gt, defPos);
    placeNameTag(G.mode === 'plan');
    const ob = scene.getOrbit();
    $('btn-recenter').classList.toggle('off', ob.goalYaw === 0 && ob.goalPitch === 0);
    scene.update(now, dt);
    scene.render();
  }

  // Termina la animación de un movimiento.
  function onMoveEnd(A) {
    A.doneAt = performance.now();
    const r = A.res;
    if (!r.ok) {
      floatMsg({ intercepcion: '¡Robo!', robo: '¡Robo!', tapon: '¡Tapón!', lejos: '¡Corta!', corto: '¡Corta!', largo: '¡Larga!', desviado: '¡Desviada!' }[r.reason] || '¡Fallo!', 'bad');
      try { if (navigator.vibrate) navigator.vibrate(60); } catch (e) { /* nada */ }
      G.mode = 'over';
      setTimeout(() => { clearFloat(); finishLevel(false, r.reason); }, 1500);
      return;
    }
    if (r.scored) {
      floatMsg('¡Canasta!', 'good');
      G.mode = 'over';
      setTimeout(() => { clearFloat(); finishLevel(true); }, 1500);
      return;
    }
    // Movimiento correcto: el juego espera el siguiente
    G.st = r.state;
    G.anim = null;
    G.mode = 'plan';
    planCamera(false);
    updateMoveBar();
    if (G.hint) hintText();
    else $('tipbar').textContent = 'Bien. Elige el siguiente movimiento.';
  }

  // ---------------------------------------------------------------- Bucle de dibujo
  let lastFrame = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0.001, (now - lastFrame) / 1000));
    lastFrame = now;
    if (current === 'game' && G.st) gameFrame(now, dt);
    else if (current === 'home' && $('modal').hidden) heroFrame(now, dt);
  }

  // ---------------------------------------------------------------- Mover con el dedo
  // Píxeles CSS relativos al canvas.
  function toPx(e) {
    const r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  const pxDist = (p, s) => (s.depth > 0 ? Math.hypot(p.x - s.x, p.y - s.y) : Infinity);
  // Punto de la cancha bajo el píxel, sobre un plano horizontal a la altura h (para apuntar al aro).
  const aimRay = new THREE.Raycaster();
  function screenToCourtAt(px, py, h) {
    const r = cv.getBoundingClientRect();
    aimRay.setFromCamera(new THREE.Vector2((px / r.width) * 2 - 1, -(py / r.height) * 2 + 1), scene.camera);
    const hit = aimRay.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -h), new THREE.Vector3());
    return hit ? scene.worldToCourt(hit) : null;
  }

  // Qué movimiento representa el dedo en ese píxel: compañero (torso proyectado), aro o conducción.
  function classify(p) {
    const st = G.st;
    for (let j = 0; j < st.pos.length; j++) {
      if (j !== st.holder && pxDist(p, scene.courtToScreen(st.pos[j][0], st.pos[j][1], 25)) <= 36) return { kind: 'pass', to: j };
    }
    if (pxDist(p, scene.courtToScreen(HOOP.x, HOOP.y, HOOP_H)) <= 40) {
      const aim = screenToCourtAt(p.x, p.y, HOOP_H) || HOOP;
      return { kind: 'shot', x: aim.x, y: aim.y };
    }
    const c = scene.screenToCourt(p.x, p.y);
    if (!c) return { kind: null };
    if (E.dist(c.x, c.y, HOOP.x, HOOP.y) < 70) return { kind: 'shot', x: c.x, y: c.y };
    const hp = st.pos[st.holder];
    if (E.dist(c.x, c.y, hp[0], hp[1]) < E.DRIBBLE_MIN + 6) return { kind: null };
    return { kind: 'dribble', x: c.x, y: c.y };
  }

  // Giro de la cámara con el dedo: un ancho de pantalla ≈ 180° de yaw; la inclinación va con dy.
  const ORBIT_TAP = 6;                                   // px: menos que esto es un toque, no un arrastre
  function orbitMove(p) {
    const o = G.orbit, r = cv.getBoundingClientRect();
    const dx = p.x - o.x0, dy = p.y - o.y0;
    if (!o.active && Math.hypot(dx, dy) < ORBIT_TAP) return;
    o.active = true;
    scene.setOrbit({ yaw: o.yaw0 - (dx / Math.max(1, r.width)) * Math.PI, pitch: o.pitch0 + (dy / Math.max(1, r.height)) * (Math.PI / 3) });
  }
  cv.addEventListener('pointerdown', (e) => {
    if (current !== 'game' || G.mode !== 'plan' || !$('modal').hidden) return;
    if (G.drag || G.orbit) return;                       // un segundo dedo no cambia el gesto en curso
    const p = toPx(e);
    const hp = G.st.pos[G.st.holder];
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* nada */ }
    clearFloat();
    if (pxDist(p, scene.courtToScreen(hp[0], hp[1], 25)) > 44) {
      // Fuera del poseedor: el arrastre gira la cámara; un toque suelto solo muestra la pista
      const o = scene.getOrbit();
      G.orbit = { x0: p.x, y0: p.y, yaw0: o.goalYaw, pitch0: o.goalPitch, active: false };
      return;
    }
    G.drag = { kind: null };
  });
  cv.addEventListener('pointermove', (e) => {
    if (G.orbit) { orbitMove(toPx(e)); return; }
    if (!G.drag) return;
    G.drag = classify(toPx(e));
  });
  const endDrag = (e) => {
    try { cv.releasePointerCapture(e.pointerId); } catch (err) { /* nada */ }
    if (G.orbit) {
      const o = G.orbit;
      G.orbit = null;
      if (!o.active) $('tipbar').textContent = 'Empieza desde el jugador que tiene la pelota (el del círculo amarillo). Arrastra fuera de él para girar la cámara.';
      return;
    }
    if (!G.drag) return;
    const d = G.drag;
    G.drag = null;
    if (!d.kind) {
      $('tipbar').textContent = 'Arrastra hacia un compañero, hacia un espacio libre o hacia el aro.';
      return;
    }
    let move;
    if (d.kind === 'pass') move = { type: 'pass', to: d.to };
    else if (d.kind === 'shot') {
      move = { type: 'shot' };
      // Si el tiro es posible (sin tapón y en distancia), primero hay que cargar la fuerza
      if (E.step(G.level, G.st, move).ok) return startCharge({ x: d.x, y: d.y });
    } else {
      const tgt = E.dribbleTarget(G.level, G.st, d.x, d.y);
      if (tgt.len < E.DRIBBLE_MIN) { $('tipbar').textContent = 'No hay espacio para conducir hacia ahí.'; return; }
      move = { type: 'dribble', x: d.x, y: d.y };
    }
    startMove(E.step(G.level, G.st, move));
  };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);

  // ---------------------------------------------------------------- Medidor de fuerza del tiro
  function startCharge(aim) {
    const w = E.shotWindow(G.level, G.st);
    G.charge = { w, aim, value: 0, dir: 1, pressing: false, last: 0, timer: 0 };
    G.mode = 'charge';
    $('meter-zone').style.top = (100 - (w.ideal + w.half)) + '%';
    $('meter-zone').style.height = (2 * w.half) + '%';
    $('meter-mark').style.top = '100%';
    $('meter-dist').textContent = (w.distance * 0.0417).toFixed(1).replace('.', ',') + ' m' + (w.pressure ? ' · marcado' : '');
    // El medidor va sobre el borde derecho de la pantalla, centrado en su altura
    const rc = cv.getBoundingClientRect();
    $('meter-track').style.height = Math.round(Math.min(280, rc.height * 0.4)) + 'px';
    $('meter').hidden = false;
    // La barra lleva su propio reloj para no depender del ritmo de dibujo de la escena
    G.charge.timer = setInterval(() => updateCharge(performance.now()), 16);
    $('tipbar').textContent = 'Dirección fijada. Mantén presionado para cargar fuerza y suelta dentro de la zona verde.';
  }
  // La barra sube y baja mientras se mantiene presionado. Un tirón del dispositivo (fotograma
  // lento) no puede hacer saltar la barra más de 25 ms de recorrido: así sigue siendo controlable.
  function updateCharge(now) {
    const c = G.charge;
    if (!c) return;
    if (c.pressing && c.last) {
      c.value += c.dir * c.w.speed * Math.min(25, now - c.last) / 1000;
      if (c.value >= 100) { c.value = 100; c.dir = -1; } else if (c.value <= 0) { c.value = 0; c.dir = 1; }
    }
    c.last = now;
    $('meter-mark').style.top = (100 - c.value) + '%';
  }
  function stopCharge() {
    if (G.charge) clearInterval(G.charge.timer);
    G.charge = null;
    $('meter').hidden = true;
  }
  function releaseCharge() {
    const c = G.charge;
    if (!c || !c.pressing) return;
    const power = c.value;
    stopCharge();
    startMove(E.step(G.level, G.st, { type: 'shot', power, aim: c.aim }));
  }
  stage.addEventListener('pointerdown', (e) => {
    if (G.mode !== 'charge' || !$('modal').hidden) return;
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* nada */ }
    G.charge.pressing = true;
    G.charge.last = performance.now();
    e.preventDefault();
  });
  const endCharge = (e) => {
    if (G.mode !== 'charge') return;
    try { stage.releasePointerCapture(e.pointerId); } catch (err) { /* nada */ }
    releaseCharge();
  };
  stage.addEventListener('pointerup', endCharge);
  stage.addEventListener('pointercancel', endCharge);

  // Acceso de solo lectura para las pruebas automáticas (píxeles CSS relativos al canvas).
  window.__jm = {
    scene, get G() { return G; }, get S() { return S; }, E, LEVELS,
    courtToScreen: (x, y, h) => scene.courtToScreen(x, y, h),
  };

  // ---------------------------------------------------------------- Botones
  $('btn-play').onclick = () => startLevel(Math.min(S.unlocked, LEVELS.length - 1));
  $('btn-levels').onclick = () => show('levels');
  $('btn-team').onclick = playerModal;
  $('btn-premium-top').onclick = premiumModal;
  $('btn-levels-back').onclick = () => show('home');
  $('btn-game-back').onclick = () => { closeModal(); stopCharge(); show('levels'); };
  $('btn-reset').onclick = askRestart;
  $('btn-hint').onclick = useHint;
  $('btn-recenter').onclick = () => scene.resetOrbit();

  // ---------------------------------------------------------------- Arranque
  requestAnimationFrame(frame);
  const boot = () => {
    show('home');
    if (!S.country) chooseCountry(true, () => createPlayer(true, renderHome));
    else if (!S.me) createPlayer(true, renderHome);
  };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(boot, boot); else boot();
})();
