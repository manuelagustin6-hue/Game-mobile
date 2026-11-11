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
    tut: {},                       // tutoriales ya vistos: n1, n2, n3 (gesto de cada nivel) y cam (girar la cámara)
  };
  let S = load();
  function load() {
    let s = Object.assign({}, DEFAULTS);
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) s = Object.assign(s, JSON.parse(raw));
    } catch (e) { /* sin almacenamiento: se juega igual */ }
    s.tut = Object.assign({}, s.tut);
    return s;
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
    dragInfo: null,              // dedo del arrastre en curso: dónde empezó, dónde está y si ya se movió
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
    G.anim = null; G.drag = null; G.dragInfo = null; G.orbit = null; G.hintCache = null;
    stopCharge();
    G.mode = 'plan';
    tagSlot = -1;
    clearFloat();
    planCamera(true);
    setTip(G.level.tip);
    updateMoveBar();
    updateHintBtn();
  }

  const movesWord = (n) => (n === 1 ? 'movimiento' : 'movimientos');

  // Texto de la barra de ayuda (una o dos líneas cortas).
  function setTip(text) { const el = $('tiptext'); if (el.textContent !== text) el.textContent = text; }
  // Ayuda que corresponde a la situación actual cuando no se está haciendo nada.
  function baseTip() {
    if (G.hint) return hintText();
    setTip(G.st.moves ? 'Elige el siguiente movimiento.' : G.level.tip);
  }

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
        <li><b>Pase:</b> arrastra del jugador a un compañero.</li>
        <li><b>Conducir:</b> arrastra a un espacio libre.</li>
        <li><b>Tiro:</b> arrastra hasta el aro y suelta con la mira verde; después carga la fuerza.</li>
        <li><b>Cámara:</b> arrastra fuera del jugador para girarla; ↻ la recentra.</li>
      </ul>
      <p class="note">Juegas un movimiento por vez. Los rivales solo se mueven mientras se ejecuta tu movimiento.</p>
      <div class="actions"><button class="btn" id="m-go">A jugar</button></div>`,
    { 'm-go': () => { closeModal(); G.mode = 'plan'; tut.t0 = 0; tut.quietUntil = 0; } });
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
    if (G.mode === 'charge') cancelCharge();
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
    if (!best) setTip('Desde aquí no hay pase seguro. Prueba conducir o reinicia.');
    else if (best.chain[1] === 'H') setTip('Ayuda: tira al aro.');
    else setTip(`Ayuda: pasa a ${G.myLooks[best.chain[1]].name} (#${G.myLooks[best.chain[1]].num}).`);
  }

  function askRestart() {
    if (G.mode === 'charge') cancelCharge();
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
      if (G.idx < 3) S.tut['n' + (G.idx + 1)] = true;      // nivel ganado: su gesto ya está aprendido
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
        desviado: ['Tiro desviado', 'La línea no pasó por el aro. Antes de soltar, mueve el dedo hasta que la mira se ponga verde.'],
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
    faCache = null;
    if (current === 'game' && G.st && (G.mode === 'plan' || G.mode === 'charge')) { planCamera(true); placeMeter(); }
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
    G.drag = null; G.dragInfo = null;
    setTip('');
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
      const far = d.aim === 'far';
      ov.circle(HOOP, E.rangeFor(lv, G.st.holder), { color: far ? '#F0565B' : '#3CC17F', fill: true, alpha: 0.55, width: 2 });
      // Con un defensor encima el tiro sale tapado: se marca hasta dónde tapa cada uno
      if (d.aim === 'blocked') (lv.defenders || []).forEach((df, k) => { if (E.dist(defPos[k].x, defPos[k].y, a.x, a.y) < E.defBlock(df)) ov.circle(defPos[k], E.defBlock(df), { color: '#F0565B', fill: true, alpha: 0.8, width: 2.2 }); });
      shotArc(ov, a, d, d.aim);
    } else if (d && d.kind === 'pass') {
      const bp = G.st.pos[d.to];
      const b = { x: bp[0], y: bp[1] };
      ov.line([a, b], { color: '#FFFFFF', width: 3.2, arrow: true });
    } else if (d && d.kind === 'dribble') {
      // Verde intenso con bordes oscuros: se distingue sobre el parqué claro y sobre la pintura.
      // Los bordes son dos líneas finas a los lados (no una más ancha debajo: el orden de dibujo
      // entre dos cintas superpuestas no está garantizado)
      const tgt = E.dribbleTarget(lv, G.st, d.x, d.y);
      const W = 3.8, len = Math.max(1, tgt.len), ux = (tgt.x - a.x) / len, uy = (tgt.y - a.y) / len;
      ov.circle(a, E.dribbleMaxFor(lv, G.st.holder), { color: '#0B5A3C', dashed: true, alpha: 0.9, width: 2.4 });
      ov.line([a, tgt], { color: '#2EE6A0', width: W, arrow: true });
      const body = Math.max(0, len - W * 4.5), off = W / 2 + 0.55;
      [1, -1].forEach((k) => ov.line([{ x: a.x - uy * off * k, y: a.y + ux * off * k }, { x: a.x + ux * body - uy * off * k, y: a.y + uy * body + ux * off * k }], { color: '#06281C', width: 1.3, alpha: 0.8 }));
      ov.disc(tgt, 15, { color: '#06281C', alpha: 0.55 });
      ov.disc(tgt, 11.5, { color: '#2EE6A0', alpha: 0.95 });
    }
    // Cargando fuerza: la dirección ya quedó fijada (verde si va al aro, ámbar o roja si va desviada)
    if (G.mode === 'charge' && G.charge) shotArc(ov, a, G.charge.aim, G.charge.level);
  }
  // Arco del tiro con el color de la puntería. Dentro del margen "encaja" en el centro del aro.
  const AIM_COLORS = { in: '#4BE38F', near: '#FFB02E', out: '#F0565B', far: '#F0565B', blocked: '#F0565B' };
  function shotArc(ov, a, aim, level) {
    const to = level === 'in' ? hoopTop : { x: aim.x, y: aim.y, h: HOOP_H };
    ov.arc(a, to, HOOP_H + 40, { color: AIM_COLORS[level] || AIM_COLORS.near, dashed: true, width: level === 'in' ? 2.6 : 2 });
  }

  // ---------------------------------------------------------------- Partida: interfaz sobre el 3D
  // Zona del canvas libre de interfaz (px CSS): entre la barra de arriba y la de abajo.
  // Se mide una vez por fotograma (y de nuevo si cambia el tamaño): varias piezas la consultan.
  let faCache = null;
  function freeArea() {
    if (faCache) return faCache;
    const r = cv.getBoundingClientRect();
    const top = $('game-top').offsetHeight, bot = $('game-bottom').offsetHeight;
    return (faCache = { w: r.width, h: r.height, top, bottom: r.height - bot });
  }
  // Cuerpo de un jugador en pantalla: segmento de los pies a la cabeza (px CSS) y su largo.
  function bodyOnScreen(x, y, h) {
    const f = scene.courtToScreen(x, y, 0), t = scene.courtToScreen(x, y, P3.HEIGHT * (h || 1));
    return { f, t, len: Math.hypot(f.x - t.x, f.y - t.y), ok: f.depth > 0 && t.depth > 0 };
  }
  const bodyDist = (p, b) => (b.ok ? E.pointSegDist(p.x, p.y, b.f.x, b.f.y, b.t.x, b.t.y) : Infinity);
  function holderBody() {
    const hp = G.st.pos[G.st.holder];
    return bodyOnScreen(hp[0], hp[1], G.myLooks[G.st.holder].h);
  }

  // Cartel con el nombre del poseedor (div HTML posicionado con la cámara). Va donde no tape
  // información de juego: debajo del jugador si hay lugar, si no a un costado de sus piernas y, como
  // último recurso, sobre la cabeza. Se elige el primer lugar que no pisa a nadie (cuerpos,
  // círculos de robo, aro) y se apaga mientras se arrastra.
  const nameTag = $('nametag');
  let tagSlot = -1, tagText = '', tagW = 80, tagH = 24;
  function placeNameTag(visible) {
    if (!visible) { nameTag.hidden = true; return; }
    const holder = G.st.holder, L = G.myLooks[holder], hp = G.st.pos[holder];
    const b = holderBody(), fa = freeArea();
    if (!b.ok || b.f.x < 0 || b.f.x > fa.w || b.t.y > fa.h || b.f.y < 0) { nameTag.hidden = true; return; }
    const text = L.star ? `★ ${L.name} · #${L.num}` : `#${L.num} ${L.name}`;
    if (nameTag.hidden || text !== tagText) {
      nameTag.textContent = tagText = text;
      nameTag.hidden = false;
      tagW = nameTag.offsetWidth || 80; tagH = nameTag.offsetHeight || 24;
    }
    nameTag.classList.toggle('dim', !!G.drag);
    // Lo que no hay que tapar: rectángulos en pantalla de compañeros, defensores (con su círculo
    // de robo) y el aro
    const rects = [];
    const addBody = (x, y, h, reach) => {
      const o = bodyOnScreen(x, y, h);
      if (!o.ok) return;
      if (reach) {
        // caja del círculo de robo tal como se ve en pantalla (8 puntos de su borde)
        const q = [1e9, 1e9, -1e9, -1e9];
        for (let k = 0; k < 8; k++) {
          const c = scene.courtToScreen(x + Math.cos(k * Math.PI / 4) * reach, y + Math.sin(k * Math.PI / 4) * reach, 0);
          q[0] = Math.min(q[0], c.x); q[1] = Math.min(q[1], c.y); q[2] = Math.max(q[2], c.x); q[3] = Math.max(q[3], c.y);
        }
        rects.push([q[0] - 2, q[1] - 2, q[2] + 2, q[3] + 2]);
      }
      const hw = Math.max(10, o.len * 0.3);
      rects.push([o.f.x - hw, Math.min(o.t.y, o.f.y) - 4, o.f.x + hw, Math.max(o.t.y, o.f.y) + 4]);
    };
    G.st.pos.forEach((p, i) => { if (i !== holder) addBody(p[0], p[1], G.myLooks[i].h); });
    (G.level.defenders || []).forEach((d, k) => { const p = E.defenderPos(d, G.st.t); addBody(p.x, p.y, G.rivalLooks[k].h, E.defReach(d) + E.BALL_R); });
    const hs = scene.courtToScreen(HOOP.x, HOOP.y, HOOP_H);
    rects.push([hs.x - 22, hs.y - 30, hs.x + 22, hs.y + 22]);
    const hw = Math.max(14, b.len * 0.3), midY = b.f.y - b.len * 0.2;
    const slots = [
      [b.f.x, b.f.y + 12 + tagH / 2],                       // debajo de los pies
      [b.f.x + hw + 8 + tagW / 2, midY],                    // a la derecha de las piernas
      [b.f.x - hw - 8 - tagW / 2, midY],                    // a la izquierda
      [b.t.x, b.t.y - 6 - tagH / 2],                        // sobre la cabeza
    ];
    const cost = (c) => {
      const x0 = c[0] - tagW / 2, x1 = c[0] + tagW / 2, y0 = c[1] - tagH / 2, y1 = c[1] + tagH / 2;
      if (x0 < 4 || x1 > fa.w - 4 || y0 < fa.top + 2 || y1 > fa.bottom - 2) return 1e9;
      let a = 0;
      for (const q of rects) a += Math.max(0, Math.min(x1, q[2]) - Math.max(x0, q[0])) * Math.max(0, Math.min(y1, q[3]) - Math.max(y0, q[1]));
      return a;
    };
    // se queda donde está mientras ese lugar siga libre (no salta de lado al girar la cámara)
    let best = tagSlot >= 0 && cost(slots[tagSlot]) === 0 ? tagSlot : -1;
    if (best < 0) { let bc = Infinity; slots.forEach((c, i) => { const k = cost(c); if (k < bc) { bc = k; best = i; } }); }
    tagSlot = best;
    const c = slots[best];
    const half = tagW / 2 + 4;
    nameTag.style.transform = `translate(${Math.round(Math.max(half, Math.min(fa.w - half, c[0])) - tagW / 2)}px, ${Math.round(c[1] - tagH / 2)}px)`;
  }

  // ---------------------------------------------------------------- Puntería del tiro
  // El tiro sale desviado si la recta tirador → punto apuntado pasa a más de `tol` unidades del
  // centro del aro. Ese margen nunca es menor que AIM_MIN_PX en pantalla: con la cámara lejos
  // pocas unidades son muy pocos píxeles, y un dedo no apunta con esa precisión. El piso crece en
  // la misma proporción que el margen propio del tiro (más cerca o con Tiro entrenado, más ancho).
  const AIM_MIN_PX = 14, AIM_MAX_PX = 30, AIM_TOL_CAP = 40;
  function aimInfo(aim) {
    const st = G.st, hp = st.pos[st.holder], a = { x: hp[0], y: hp[1] };
    const base = E.shotWindow(G.level, st);
    // píxeles por unidad a la altura del aro, en la dirección perpendicular al tiro
    const vx = HOOP.x - a.x, vy = HOOP.y - a.y, len = Math.hypot(vx, vy) || 1;
    const nx = -vy / len, ny = vx / len;
    const s1 = scene.courtToScreen(HOOP.x + nx * 8, HOOP.y + ny * 8, HOOP_H), s2 = scene.courtToScreen(HOOP.x - nx * 8, HOOP.y - ny * 8, HOOP_H);
    const ppu = Math.max(0.02, Math.hypot(s1.x - s2.x, s1.y - s2.y) / 16);
    const floorPx = Math.min(AIM_MAX_PX, AIM_MIN_PX * base.aimTolBase / E.AIM_TOL_FAR);
    const tolMin = Math.min(AIM_TOL_CAP, floorPx / ppu);
    const tol = Math.max(base.aimTolBase, tolMin);
    const far = base.distance > E.rangeFor(G.level, st.holder);
    // defensores que taparían el tiro desde donde está el tirador (regla del motor: dentro de su `block`)
    const blockers = [];
    (G.level.defenders || []).forEach((d, k) => { const p = E.defenderPos(d, st.t); if (E.dist(p.x, p.y, a.x, a.y) < E.defBlock(d)) blockers.push(k); });
    const e = E.aimError(a, aim || HOOP);
    const level = far ? 'far' : blockers.length ? 'blocked' : e.err <= tol ? 'in' : e.err <= tol * 2.2 ? 'near' : 'out';
    return { tol, tolMin, tolBase: base.aimTolBase, tolPx: tol * ppu, ppu, err: e.err, q: { x: e.x, y: e.y }, level, far, blockers };
  }

  // Mira sobre el aro (anillo = margen real, punto = por dónde pasa la línea) y lupa sobre el dedo.
  const aimRing = $('aim-ring'), aimDot = $('aim-dot'), aimLens = $('aim-lens');
  const lensCv = $('aim-lens-cv'), lensCtx = lensCv.getContext('2d');
  const LENS = 84;                                       // diámetro de la lupa (px CSS)
  const AIM_LABELS = { in: 'En la mira', near: 'Desviado', out: 'Desviado', far: 'Muy lejos', blocked: 'Tapado' };
  let aimShown = null;                                   // datos de la mira dibujada este fotograma
  let lensSpot = -1;                                     // lugar que ocupa la lupa respecto del dedo
  function placeAimUI() {
    const dragging = G.mode === 'plan' && G.drag && G.drag.kind === 'shot';
    const charging = G.mode === 'charge' && G.charge;
    if (!dragging && !charging) {
      if (aimShown) { aimRing.hidden = aimDot.hidden = aimLens.hidden = true; aimRing.classList.remove('in'); aimShown = null; lensSpot = -1; }
      return;
    }
    const info = dragging ? aimInfo(G.drag) : G.charge.info;
    const hs = scene.courtToScreen(HOOP.x, HOOP.y, HOOP_H), qs = scene.courtToScreen(info.q.x, info.q.y, HOOP_H);
    const color = AIM_COLORS[info.level];
    const rad = Math.max(8, info.tolPx);
    aimRing.style.setProperty('--aim', color);
    aimRing.style.width = aimRing.style.height = (2 * rad).toFixed(1) + 'px';
    aimRing.style.transform = `translate(${(hs.x - rad).toFixed(1)}px, ${(hs.y - rad).toFixed(1)}px)`;
    aimRing.classList.toggle('in', info.level === 'in');
    aimRing.hidden = false;
    // dentro del margen el punto "encaja" en el centro; fuera, muestra por dónde pasa la línea
    const dx = info.level === 'in' ? 0 : qs.x - hs.x, dy = info.level === 'in' ? 0 : qs.y - hs.y;
    aimDot.style.setProperty('--aim', color);
    aimDot.style.transform = `translate(${(hs.x + dx).toFixed(1)}px, ${(hs.y + dy).toFixed(1)}px)`;
    aimDot.hidden = info.level === 'far' || info.level === 'blocked';
    aimShown = { info, hs, dx: qs.x - hs.x, dy: qs.y - hs.y, lens: false };
    // Lupa: solo mientras el dedo está apoyado, por encima de él (o al costado si no hay lugar)
    const fp = dragging && G.dragInfo ? G.dragInfo.last : null;
    if (!fp) { aimLens.hidden = true; lensSpot = -1; return; }
    // Lugares posibles, en orden de preferencia: arriba del dedo, a los costados, abajo. Vale el
    // primero que entra en la zona libre, queda lejos del dedo y no tapa la mira del aro
    const fa = freeArea(), R = LENS / 2;
    const spots = [[0, -96], [-104, -34], [104, -34], [-104, -96], [104, -96], [0, 112], [-104, 40], [104, 40]];
    const spot = (i) => {
      const x = Math.max(R + 6, Math.min(fa.w - R - 6, fp.x + spots[i][0]));
      const y = Math.max(fa.top + R + 2, Math.min(fa.bottom - R - 24, fp.y + spots[i][1]));
      return { x, y, cost: Math.max(0, 78 - Math.hypot(x - fp.x, y - fp.y)) + Math.max(0, R + rad + 10 - Math.hypot(x - hs.x, y - hs.y)) };
    };
    // mientras el lugar actual siga sirviendo, la lupa no salta de lado
    let best = lensSpot >= 0 ? spot(lensSpot) : null;
    if (!best || best.cost > 0) {
      best = null;
      for (let i = 0; i < spots.length; i++) {
        const c = spot(i);
        if (!best || c.cost < best.cost - 0.5) { best = c; lensSpot = i; }
        if (c.cost === 0) break;
      }
    }
    const lx = best.x, ly = best.y;
    aimLens.style.setProperty('--aim', color);
    aimLens.style.transform = `translate(${Math.round(lx - R)}px, ${Math.round(ly - R)}px)`;
    $('aim-lens-label').textContent = AIM_LABELS[info.level];
    aimLens.hidden = false;
    aimShown.lens = true;
  }
  // Contenido de la lupa: la zona del aro tal como se acaba de dibujar, ampliada, con el anillo
  // del margen y el punto de la línea. Se llama justo después de scene.render().
  function drawLens() {
    if (!aimShown || !aimShown.lens) return;
    const { info, hs, dx, dy } = aimShown;
    const r = cv.getBoundingClientRect(), k = cv.width / Math.max(1, r.width);
    const half = Math.max(22, Math.min(52, info.tolPx * 1.6));   // media ventana de pantalla que se amplía (px CSS)
    const W = lensCv.width, s = W / LENS, z = (LENS / (2 * half)) * s;
    const ctx = lensCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#06080f'; ctx.fillRect(0, 0, W, W);
    try { ctx.drawImage(cv, (hs.x - half) * k, (hs.y - half) * k, 2 * half * k, 2 * half * k, 0, 0, W, W); } catch (e) { /* sin copia: quedan el anillo y el punto */ }
    const color = AIM_COLORS[info.level], c = W / 2;
    ctx.lineWidth = 2 * s; ctx.strokeStyle = 'rgba(6,8,15,.65)';
    ctx.beginPath(); ctx.arc(c, c, info.tolPx * z + 2.2 * s, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = (info.level === 'in' ? 3.4 : 2.6) * s; ctx.strokeStyle = color;
    ctx.beginPath(); ctx.arc(c, c, info.tolPx * z, 0, Math.PI * 2); ctx.stroke();
    if (info.level === 'far' || info.level === 'blocked') return;
    let px = info.level === 'in' ? 0 : dx * z, py = info.level === 'in' ? 0 : dy * z;
    const lim = c - 9 * s, m = Math.hypot(px, py);
    if (m > lim) { px *= lim / m; py *= lim / m; }
    ctx.beginPath(); ctx.arc(c + px, c + py, 5.5 * s, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.lineWidth = 2.4 * s; ctx.strokeStyle = color; ctx.stroke();
  }

  // Destino de la conducción: una marca HTML por encima de las barras, para que se vea aunque
  // el punto caiga bajo la barra inferior (conducir hacia atrás o al costado).
  const dribPin = $('drib-pin');
  function placeDribPin() {
    const d = G.mode === 'plan' ? G.drag : null;
    if (!d || d.kind !== 'dribble') { if (!dribPin.hidden) dribPin.hidden = true; return; }
    const tgt = E.dribbleTarget(G.level, G.st, d.x, d.y);
    const s = scene.courtToScreen(tgt.x, tgt.y, 0), fa = freeArea();
    if (s.depth <= 0) { dribPin.hidden = true; return; }
    const x = Math.max(16, Math.min(fa.w - 16, s.x)), y = Math.max(fa.top + 44, Math.min(fa.h - 8, s.y));
    dribPin.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    dribPin.hidden = false;
  }
  // La barra inferior se aclara mientras el destino de la conducción cae debajo de ella.
  function fadeBottomBar() {
    const d = G.mode === 'plan' ? G.drag : null;
    let under = false;
    if (d && d.kind === 'dribble') {
      const tgt = E.dribbleTarget(G.level, G.st, d.x, d.y);
      under = scene.courtToScreen(tgt.x, tgt.y, 0).y > freeArea().bottom - 24;
    }
    $('game-bottom').classList.toggle('see-through', under);
  }

  // ---------------------------------------------------------------- Tutorial con gesto animado
  // En los niveles 1, 2 y 3, la primera vez, una mano fantasma repite el gesto que hay que hacer
  // (se ubica con la cámara, así que acompaña los giros). Desaparece al empezar a arrastrar y
  // vuelve si el jugador se queda quieto sin haber hecho el gesto. S.tut guarda lo ya aprendido.
  const tut = { t0: 0, quietUntil: 0, step: null, camShown: 0 };   // camShown: segundos que lleva a la vista la pista de la cámara
  const tutEl = $('tut'), tutHand = $('tut-hand'), tutRing = $('tut-ring'), tutTrail = $('tut-trail'), coach = $('coach');
  const REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const CAM_HINT_S = 7;
  function tutSeen(key) { if (!S.tut[key]) { S.tut[key] = true; save(); } }
  // Gesto que toca enseñar ahora: 'aim' | 'hold' | 'pass' | 'star' | null
  function tutStep() {
    const k = G.idx;
    if (k > 2 || S.tut['n' + (k + 1)] || (S.stars[k] || 0) > 0) return null;
    if (k === 0) {
      // el nivel 1 se aprende al convertir: si el tiro falla, la mano vuelve a mostrar el gesto
      if (G.mode === 'plan') return 'aim';
      return G.mode === 'charge' && G.charge && !G.charge.pressing ? 'hold' : null;
    }
    if (G.mode !== 'plan' || G.st.moves > 0) return null;
    if (k === 2 && G.st.holder === G.level.starIdx) return null;
    return k === 1 ? 'pass' : 'star';
  }
  function tutText(step) {
    if (step === 'aim') return 'Arrastra del jugador al aro y suelta';
    if (step === 'hold') return 'Mantén presionado y suelta en la zona verde';
    if (step === 'pass') return 'Arrastra del jugador a tu compañero';
    return `Pásale la pelota a tu jugador ★ ${esc(S.me.name)}`;
  }
  function setCoach(html) {
    if (html == null) { if (!coach.hidden) { coach.hidden = true; coach._html = null; } return; }
    if (coach._html !== html) { coach.innerHTML = html; coach._html = html; }
    coach.style.top = (freeArea().top + 2) + 'px';
    coach.hidden = false;
  }
  function updateTutorial(now, dt) {
    const open = $('modal').hidden;
    const step = open ? tutStep() : null;
    const busy = !!(G.drag || G.orbit);
    if (busy) tut.quietUntil = now + 1600;
    if (step !== tut.step) { tut.step = step; tut.t0 = 0; }
    // Cartel: el gesto del nivel o, la primera vez que no hay gesto que enseñar, cómo girar la cámara
    let coachHtml = null;
    if (step && !G.drag) coachHtml = tutText(step);
    else if (open && !step && !S.tut.cam && G.mode === 'plan' && !G.drag) {
      // se cuenta en tiempo de dibujo (dt acotado): en un equipo lento no se va antes de poder leerla
      tut.camShown += dt;
      if (tut.camShown > CAM_HINT_S) tutSeen('cam');
      else coachHtml = '<i class="swipe"></i><span>Arrastra fuera del jugador para girar la cámara</span>';
    }
    setCoach(coachHtml);
    // Mano
    if (!step || busy || now < tut.quietUntil) { if (!tutEl.hidden) tutEl.hidden = true; tut.t0 = 0; return; }
    if (!tut.t0) tut.t0 = now;
    const fa = freeArea();
    let from, to, T = 2600;
    if (step === 'hold') {
      // lejos del tirador y del medidor: del lado contrario al medidor, a media altura
      const left = !$('meter').classList.contains('left');
      from = to = { x: fa.w * (left ? 0.24 : 0.76), y: fa.top + (fa.bottom - fa.top) * 0.5 };
      T = 1700;
    } else {
      const hp = G.st.pos[G.st.holder];
      from = scene.courtToScreen(hp[0], hp[1], 25);
      if (step === 'aim') to = scene.courtToScreen(HOOP.x, HOOP.y, HOOP_H);
      else { const tp = G.st.pos[step === 'star' ? G.level.starIdx : (G.st.holder === 0 ? 1 : 0)]; to = scene.courtToScreen(tp[0], tp[1], 25); }
      if (from.depth <= 0 || to.depth <= 0) { tutEl.hidden = true; return; }
    }
    const u = REDUCED ? 0.74 : ((now - tut.t0) % T) / T;
    let x, y, alpha, pressed, ringScale = 1, ringAlpha = 1;
    if (step === 'hold') {
      x = from.x; y = from.y; alpha = 1; pressed = u > 0.12;
      ringScale = pressed ? 1 + 0.9 * ((u - 0.12) / 0.88) : 1; ringAlpha = pressed ? 1 - (u - 0.12) / 0.88 : 0;
    } else {
      const m = Math.max(0, Math.min(1, (u - 0.2) / 0.45)), e = m * m * (3 - 2 * m);
      x = from.x + (to.x - from.x) * e; y = from.y + (to.y - from.y) * e;
      alpha = u < 0.1 ? u / 0.1 : u > 0.9 ? (1 - u) / 0.1 : 1;
      pressed = u >= 0.12 && u < 0.88;
      if (pressed && u > 0.66) ringScale = 1 + 0.16 * Math.sin((u - 0.66) / 0.22 * Math.PI * 2);
      ringAlpha = pressed ? 1 : 0;
    }
    tutEl.hidden = false;
    tutEl.style.opacity = (0.95 * alpha).toFixed(2);
    tutHand.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${pressed ? 0.94 : 1.1})`;
    tutRing.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${ringScale.toFixed(2)})`;
    tutRing.style.opacity = ringAlpha.toFixed(2);
    const len = pressed ? Math.hypot(x - from.x, y - from.y) : 0;
    tutTrail.style.width = len.toFixed(1) + 'px';
    tutTrail.style.transform = `translate(${from.x.toFixed(1)}px, ${from.y.toFixed(1)}px) rotate(${Math.atan2(y - from.y, x - from.x).toFixed(3)}rad)`;
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
    const ob = scene.getOrbit();
    $('btn-recenter').classList.toggle('off', ob.goalYaw === 0 && ob.goalPitch === 0);
    scene.update(now, dt);
    // Interfaz pegada al 3D: se ubica con la cámara ya actualizada
    faCache = null;
    placeNameTag(G.mode === 'plan');
    placeAimUI();
    placeDribPin();
    fadeBottomBar();
    updateTutorial(now, dt);
    scene.render();
    drawLens();
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
      if (scene.cheer) scene.cheer();            // la hinchada local se para y festeja
      G.mode = 'over';
      setTimeout(() => { clearFloat(); finishLevel(true); }, 1500);
      return;
    }
    // Movimiento correcto: el juego espera el siguiente
    G.st = r.state;
    G.anim = null;
    G.mode = 'plan';
    tagSlot = -1;                                // nuevo poseedor: el cartel vuelve a elegir su lugar
    planCamera(false);
    updateMoveBar();
    if (G.hint) hintText();
    else setTip('Bien. Elige el siguiente movimiento.');
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

  // Qué movimiento representa el dedo en ese píxel: compañero (cuerpo proyectado), aro o conducción.
  const CANCEL_PX = 16;                                  // volver al punto de partida anula el gesto
  function classify(p) {
    const st = G.st, gi = G.dragInfo;
    if (gi && Math.hypot(p.x - gi.x0, p.y - gi.y0) < CANCEL_PX) return { kind: null };
    // Compañero: el más cercano al dedo entre los que quedan a tiro (el radio crece con su tamaño en pantalla)
    let best = -1, bd = Infinity;
    for (let j = 0; j < st.pos.length; j++) {
      if (j === st.holder) continue;
      const b = bodyOnScreen(st.pos[j][0], st.pos[j][1], G.myLooks[j].h);
      const d = Math.min(bodyDist(p, b), pxDist(p, scene.courtToScreen(st.pos[j][0], st.pos[j][1], 25)) - 4);
      if (d <= Math.max(32, Math.min(56, b.len * 0.28)) && d < bd) { bd = d; best = j; }
    }
    if (best >= 0) return { kind: 'pass', to: best };
    // Aro: alrededor de su imagen en pantalla (la zona crece con el margen de puntería, para que
    // un tiro desviado se vea como tal en vez de volverse otra cosa) o sobre el piso debajo de él
    const shot = (aim) => ({ kind: 'shot', x: aim.x, y: aim.y, aim: aimInfo(aim).level });
    const grab = Math.max(48, Math.min(80, aimInfo(HOOP).tolPx * 2.6));
    if (pxDist(p, scene.courtToScreen(HOOP.x, HOOP.y, HOOP_H)) <= grab) return shot(screenToCourtAt(p.x, p.y, HOOP_H) || HOOP);
    const c = scene.screenToCourt(p.x, p.y);
    if (!c) return { kind: null };
    if (E.dist(c.x, c.y, HOOP.x, HOOP.y) < 70) return shot(c);
    const hp = st.pos[st.holder];
    if (E.dist(c.x, c.y, hp[0], hp[1]) < E.DRIBBLE_MIN + 6) return { kind: null };
    return { kind: 'dribble', x: c.x, y: c.y };
  }
  // Ayuda corta mientras se arrastra: qué va a pasar al soltar.
  function dragTip(d) {
    if (d.kind === 'pass') { const L = G.myLooks[d.to]; return `Suelta para pasar a ${L.star ? '★ ' + L.name : '#' + L.num + ' ' + L.name}.`; }
    if (d.kind === 'dribble') return 'Suelta para conducir hasta la marca verde.';
    if (d.kind === 'shot') {
      if (d.aim === 'far') return 'Desde aquí el tiro no llega: acércate o pasa la pelota.';
      if (d.aim === 'blocked') return 'Con un defensor encima te tapan el tiro: pasa o aléjate.';
      return d.aim === 'in' ? 'En la mira. Suelta para fijar el tiro.' : 'Desviado: mueve el dedo hasta que la mira quede verde.';
    }
    return 'Suelta aquí para cancelar.';
  }

  // Giro de la cámara con el dedo: un ancho de pantalla ≈ 180° de yaw; la inclinación va con dy.
  const ORBIT_TAP = 10;                                  // px: menos que esto es un toque, no un arrastre
  const DRAG_MIN = 12;                                   // px que debe moverse el dedo para que el gesto cuente
  function orbitMove(p) {
    const o = G.orbit, r = cv.getBoundingClientRect();
    const dx = p.x - o.x0, dy = p.y - o.y0;
    if (!o.active && Math.hypot(dx, dy) < ORBIT_TAP) return;
    if (!o.active) { o.active = true; tutSeen('cam'); }
    scene.setOrbit({ yaw: o.yaw0 - (dx / Math.max(1, r.width)) * Math.PI, pitch: o.pitch0 + (dy / Math.max(1, r.height)) * (Math.PI / 3) });
  }
  cv.addEventListener('pointerdown', (e) => {
    if (current !== 'game' || G.mode !== 'plan' || !$('modal').hidden) return;
    if (G.drag || G.orbit) return;                       // un segundo dedo no cambia el gesto en curso
    const p = toPx(e);
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* nada */ }
    clearFloat();
    // ¿Sobre el poseedor? Cuenta todo su cuerpo en pantalla (de cerca es grande), con un mínimo
    // cómodo para el dedo cuando la cámara está lejos
    const hb = holderBody(), hp = G.st.pos[G.st.holder];
    const onHolder = bodyDist(p, hb) <= Math.max(34, Math.min(64, hb.len * 0.3)) || pxDist(p, scene.courtToScreen(hp[0], hp[1], 25)) <= 44;
    if (!onHolder) {
      // Fuera del poseedor: el arrastre gira la cámara; un toque suelto solo muestra la pista
      const o = scene.getOrbit();
      G.orbit = { pid: e.pointerId, x0: p.x, y0: p.y, yaw0: o.goalYaw, pitch0: o.goalPitch, active: false };
      return;
    }
    G.drag = { kind: null };
    G.dragInfo = { pid: e.pointerId, x0: p.x, y0: p.y, last: p, moved: false };
  });
  cv.addEventListener('pointermove', (e) => {
    if (G.orbit) { if (e.pointerId === G.orbit.pid) orbitMove(toPx(e)); return; }
    const gi = G.dragInfo;
    if (!G.drag || !gi || e.pointerId !== gi.pid) return;
    const p = toPx(e);
    gi.last = p;
    // Un toque con un temblor de pocos píxeles no es un arrastre
    if (!gi.moved && Math.hypot(p.x - gi.x0, p.y - gi.y0) < DRAG_MIN) return;
    gi.moved = true;
    const prev = G.drag, d = classify(p);
    G.drag = d;
    if (d.kind !== prev.kind || d.to !== prev.to || d.aim !== prev.aim) {
      setTip(dragTip(d));
      // la mira "encaja": un toque de vibración donde el teléfono lo permite
      if (d.kind === 'shot' && d.aim === 'in') { try { if (navigator.vibrate) navigator.vibrate(8); } catch (err) { /* nada */ } }
    }
  });
  const endDrag = (e) => {
    const cancelled = e.type === 'pointercancel';
    if (G.orbit) {
      if (e.pointerId !== G.orbit.pid) return;
      try { cv.releasePointerCapture(e.pointerId); } catch (err) { /* nada */ }
      const o = G.orbit;
      G.orbit = null;
      if (!o.active && !cancelled) setTip('Empieza en el jugador del círculo amarillo. Arrastrar fuera de él gira la cámara.');
      return;
    }
    const gi = G.dragInfo;
    if (!G.drag || (gi && e.pointerId !== gi.pid)) return;
    try { cv.releasePointerCapture(e.pointerId); } catch (err) { /* nada */ }
    const d = G.drag;
    G.drag = null; G.dragInfo = null;
    // El sistema interrumpió el gesto (llamada, gesto del sistema): no se juega nada
    if (cancelled) { baseTip(); return; }
    if (!d.kind) {
      if (gi && gi.moved) baseTip();
      else setTip('Arrastra desde el jugador hacia un compañero, un espacio libre o el aro.');
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
      if (tgt.len < E.DRIBBLE_MIN) { setTip('No hay espacio para conducir hacia ahí.'); return; }
      move = { type: 'dribble', x: d.x, y: d.y };
    }
    const res = E.step(G.level, G.st, move);
    // Tutorial: el gesto del nivel queda aprendido cuando sale bien (nivel 2: un pase; nivel 3: el pase a tu jugador)
    if (res.ok && move.type === 'pass' && (G.idx === 1 || (G.idx === 2 && move.to === G.level.starIdx))) tutSeen('n' + (G.idx + 1));
    startMove(res);
  };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);

  // ---------------------------------------------------------------- Medidor de fuerza del tiro
  const CHARGE_MIN = 8;                                  // soltar por debajo de esto no es un tiro: fue un toque
  function startCharge(aim) {
    // La puntería queda fijada con la cámara de este momento (margen en píxeles incluido)
    const info = aimInfo(aim);
    const w = E.shotWindow(G.level, G.st, { aimTolMin: info.tol });
    G.charge = { w, aim, info, level: info.level, value: 0, dir: 1, pressing: false, pid: null, last: 0, timer: 0 };
    G.mode = 'charge';
    $('meter-zone').style.top = (100 - (w.ideal + w.half)) + '%';
    $('meter-zone').style.height = (2 * w.half) + '%';
    $('meter-mark').style.top = '100%';
    $('meter-dist').textContent = (w.distance * 0.0417).toFixed(1).replace('.', ',') + ' m' + (w.pressure ? ' · marcado' : '');
    $('meter').hidden = false;
    placeMeter();
    // La barra lleva su propio reloj para no depender del ritmo de dibujo de la escena
    G.charge.timer = setInterval(() => updateCharge(performance.now()), 16);
    chargeTip();
  }
  function chargeTip() {
    setTip(G.charge.level === 'in' ? 'Mantén presionado y suelta en la zona verde. ✕ cancela el tiro.'
      : 'La línea va desviada: toca ✕ para apuntar de nuevo, o tira igual.');
  }
  // El medidor va en un borde de la pantalla, centrado en la zona libre entre las dos barras y sin
  // pasarse de ella; del lado donde no tapa al tirador ni al aro (por defecto, a la derecha).
  function placeMeter() {
    const m = $('meter');
    if (m.hidden) return;
    const fa = freeArea(), free = Math.max(120, fa.bottom - fa.top);
    $('meter-track').style.height = Math.round(Math.max(80, Math.min(240, free - 140))) + 'px';
    const h = m.offsetHeight;
    m.style.top = Math.round(fa.top + Math.max(0, (free - h) / 2)) + 'px';
    const b = holderBody(), hs = scene.courtToScreen(HOOP.x, HOOP.y, HOOP_H);
    const hw = Math.max(16, b.len * 0.32), band = 72;
    const cost = (x0, x1) => (b.ok && b.f.x + hw > x0 && b.f.x - hw < x1 ? 2 : 0) + (hs.x + 26 > x0 && hs.x - 26 < x1 ? 1 : 0);
    m.classList.toggle('left', cost(0, band) < cost(fa.w - band, fa.w));
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
  // Vuelve a planear sin tirar: no cuesta vida ni movimiento.
  function cancelCharge() {
    if (G.mode !== 'charge') return;
    stopCharge();
    G.mode = 'plan';
    setTip('Tiro cancelado. Elige tu movimiento.');
  }
  // Deja de cargar sin tirar (toque demasiado corto o gesto interrumpido por el sistema).
  function resetPress() {
    const c = G.charge;
    if (!c) return;
    c.pressing = false; c.pid = null; c.value = 0; c.dir = 1;
    $('meter-mark').style.top = '100%';
  }
  function releaseCharge() {
    const c = G.charge;
    if (!c || !c.pressing) return;
    // Un toque suelto no llega a cargar nada: no se tira (ni se pierde una vida por accidente)
    if (c.value < CHARGE_MIN) { resetPress(); setTip('Mantén presionado para cargar la fuerza. ✕ cancela el tiro.'); return; }
    const power = c.value, aim = c.aim, aimTolMin = c.info.tol;
    stopCharge();
    startMove(E.step(G.level, G.st, { type: 'shot', power, aim, aimTolMin }));
  }
  stage.addEventListener('pointerdown', (e) => {
    if (G.mode !== 'charge' || !$('modal').hidden) return;
    if (G.charge.pressing) return;                       // un segundo dedo no reinicia la carga
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* nada */ }
    G.charge.pressing = true;
    G.charge.pid = e.pointerId;
    G.charge.last = performance.now();
    chargeTip();
    e.preventDefault();
  });
  const endCharge = (e) => {
    if (G.mode !== 'charge' || !G.charge.pressing || e.pointerId !== G.charge.pid) return;
    try { stage.releasePointerCapture(e.pointerId); } catch (err) { /* nada */ }
    if (e.type === 'pointercancel') { resetPress(); return; }
    releaseCharge();
  };
  stage.addEventListener('pointerup', endCharge);
  stage.addEventListener('pointercancel', endCharge);
  // Botón ✕ del medidor: cancela el tiro ya apuntado (su toque no cuenta como "cargar")
  $('btn-cancel-shot').addEventListener('pointerdown', (e) => e.stopPropagation());
  $('btn-cancel-shot').onclick = cancelCharge;
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && current === 'game' && $('modal').hidden) cancelCharge(); });

  // Acceso de solo lectura para las pruebas automáticas (píxeles CSS relativos al canvas).
  // aimInfo(aim?): puntería del poseedor actual hacia `aim` (por defecto, el centro del aro):
  //   { tol, tolBase, tolMin, tolPx, ppu, err, level: 'in' | 'near' | 'out' | 'far', q }.
  // tutorial(): { step: gesto que se está enseñando o null, hand: mano visible, coach: texto del cartel }.
  window.__jm = {
    scene, get G() { return G; }, get S() { return S; }, E, LEVELS,
    courtToScreen: (x, y, h) => scene.courtToScreen(x, y, h),
    aimInfo: (aim) => aimInfo(aim),
    tutorial: () => ({ step: tut.step, hand: !tutEl.hidden, coach: coach.hidden ? null : coach.textContent }),
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
