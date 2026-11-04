// "Jugada Maestra": interfaz, dibujo y progreso del jugador.
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
    if (name === 'home') renderHome();
    if (name === 'levels') renderLevels();
    if (name === 'game') requestAnimationFrame(resize);
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
    drawHero();
    if (!S.country) { $('home-team').innerHTML = ''; return; }
    const i = Math.min(S.unlocked, LEVELS.length - 1);
    const t = myTeam(LEVELS[i].stage === 'seleccion' ? Math.max(0, i - 1) : i);
    const c = country(S.country);
    $('home-team').innerHTML = `${crest(t.colors)}
      <div class="meta"><div class="label">Juegas en</div><div class="name">${t.name}</div>
      <div class="label" style="text-transform:none;letter-spacing:0">${t.flag} ${t.sub} · Selección de ${c.name}</div></div>`;
    $('btn-play').textContent = S.unlocked >= LEVELS.length ? 'Jugar de nuevo' : `Jugar nivel ${i + 1}`;
  }

  function teamModal() {
    const c = country(S.country);
    const k1 = club(S.club1.id);
    const k2 = S.club2 ? club(S.club2.id) : null;
    modal(`
      <span class="eyebrow">Mi equipo</span>
      <h2>Tu carrera</h2>
      <div class="offer">${crest(k1.colors)}<div class="meta"><div class="name">${k1.name}</div><div class="league">Temporada 1 · Liga de ${country(S.club1.country).name}</div></div></div>
      ${k2 ? `<div class="offer">${crest(k2.colors)}<div class="meta"><div class="name">${k2.name}</div><div class="league">Temporada 2 · Liga de ${country(S.club2.country).name}</div></div></div>`
        : '<p class="note">Al terminar la temporada 1 recibes ofertas de clubes de otros países.</p>'}
      <div class="offer"><span class="flag" style="font-size:34px">${c.flag}</span><div class="meta"><div class="name">Selección de ${c.name}</div><div class="league">Te convoca en los niveles marcados como Selección</div></div></div>
      <div class="actions"><button class="btn alt" id="m-country">Cambiar nacionalidad</button><button class="btn" id="m-close">Listo</button></div>`,
    { 'm-close': closeModal, 'm-country': () => chooseCountry(false, renderHome) });
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

  // ---------------------------------------------------------------- Partida
  const G = {
    idx: 0, level: null, solution: null, mode: 'card',
    chain: [], finger: null, drawing: false,
    result: null, runStart: 0, hint: false, shownEnd: false, mine: null, rival: null,
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
    G.idx = i; G.level = lv; G.solution = E.solve(lv);
    G.mine = myTeam(i); G.rival = rivalTeam(i);
    G.hint = false;
    resetPlay();
    show('game');
    $('game-label').innerHTML = `Nivel ${i + 1} · ${lv.name}<small>${G.mine.name} vs ${G.rival.name}</small>`;
    levelCard();
  }

  function resetPlay() {
    G.chain = []; G.finger = null; G.drawing = false; G.result = null; G.shownEnd = false;
    G.mode = 'plan';
    clearFloat();
    $('tipbar').textContent = G.level ? G.level.tip : '';
    updateHintBtn();
  }

  function levelCard() {
    const lv = G.level, sol = G.solution;
    const passes = sol.minPasses;
    modal(`
      <span class="eyebrow">Temporada ${seasonOf(G.idx)} · Nivel ${G.idx + 1}${lv.stage === 'seleccion' ? ' · Selección' : ''}</span>
      <h2>${lv.name}</h2>
      <div class="matchup">
        <div class="side">${crest(G.mine.colors, true)}<span>${G.mine.name}</span></div>
        <span class="vs">VS</span>
        <div class="side right"><span>${G.rival.name}</span>${crest(G.rival.colors, true)}</div>
      </div>
      <p>${lv.tip}</p>
      <div class="facts">
        <div class="fact"><b>${passes === 0 ? 'Tiro directo' : passes + (passes === 1 ? ' pase' : ' pases')}</b><span>para 3 estrellas</span></div>
        <div class="fact"><b>${(lv.defenders || []).length}</b><span>defensores</span></div>
      </div>
      <div class="actions"><button class="btn" id="m-go">A jugar</button></div>
      <p class="note">Traza con el dedo desde el jugador con la pelota, pasando por tus compañeros, y suelta sobre el aro.</p>`,
    { 'm-go': () => { closeModal(); G.mode = 'plan'; } });
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
      G.hint = true; updateHintBtn();
      return;
    }
    modal(`
      <span class="eyebrow">Ayuda</span>
      <h2>Te faltan monedas</h2>
      <p>La ayuda cuesta ${HINT_COST} monedas y tienes ${S.coins}. Mira un anuncio y te mostramos la jugada gratis.</p>
      <div class="actions"><button class="btn gold" id="m-ad">Ver anuncio</button><button class="btn alt" id="m-close">Volver</button></div>`,
    {
      'm-ad': () => { closeModal(); showAd(true, () => { G.hint = true; updateHintBtn(); }); },
      'm-close': closeModal,
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
      <h2>Te convocó la selección de ${c.name}</h2>
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
      <h2>Tienes ofertas de fichaje</h2>
      <p>Elige tu nuevo club. Cada uno juega en otra liga y te paga una prima de fichaje en monedas.</p>
      ${offers.map((o, k) => `<button class="offer" id="m-o${k}">${crest(o.club.colors)}<div class="meta"><div class="name">${o.club.name}</div><div class="league">${o.country.flag} Liga de ${o.country.name}</div></div><span class="bonus">+${o.bonus}</span></button>`).join('')}`,
    Object.fromEntries(offers.map((o, k) => ['m-o' + k, () => {
      S.club2 = { id: o.club.id, country: o.country.code };
      S.coins += o.bonus; save(); refreshHud(); closeModal(); onDone();
    }])));
  }

  function finishLevel() {
    const r = G.result;
    if (r.ok) {
      const st = E.stars(r.passes, G.solution.minPasses);
      const prev = S.stars[G.idx] || 0;
      const earned = Math.max(0, st - prev) * 10 + 5;
      S.stars[G.idx] = Math.max(prev, st);
      S.coins += earned;
      S.unlocked = Math.max(S.unlocked, G.idx + 1);
      S.sinceAd++;
      save(); refreshHud();
      const last = G.idx === LEVELS.length - 1;
      const msg = st === 3 ? '¡Jugada perfecta!' : st === 2 ? 'Bien jugado. Se puede con menos pases.' : 'Entró, pero hay un camino más corto.';
      modal(`
        <span class="eyebrow">Nivel ${G.idx + 1} superado</span>
        <h2>${last ? '¡Campeones!' : 'Canasta'}</h2>
        <div class="big-stars">${[1, 2, 3].map((k) => `<span class="${k <= st ? 'on' : ''}">★</span>`).join('')}</div>
        <p style="text-align:center">${msg}</p>
        <div class="facts">
          <div class="fact"><b>${r.passes}</b><span>${r.passes === 1 ? 'pase' : 'pases'} (mínimo ${G.solution.minPasses})</span></div>
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
        intercepcion: ['Pelota robada', 'Un defensor cortó el pase. Mira las rutas de los defensores.'],
        obstaculo: ['Pase bloqueado', 'La pelota chocó contra un obstáculo.'],
        tapon: ['Tapón', 'Tenías un defensor encima. Tira desde donde estés libre.'],
        lejos: ['Muy lejos', 'Tiraste desde fuera de la línea de triple: la pelota no llega.'],
      };
      const t = texts[r.reason] || ['Jugada fallida', 'Inténtalo de nuevo.'];
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
          if (!S.premium && S.lives <= 0) return noLives(() => { resetPlay(); });
          const keepHint = G.hint;
          resetPlay(); G.hint = keepHint; updateHintBtn();
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

  // ---------------------------------------------------------------- Dibujo
  const cv = $('court');
  const ctx = cv.getContext('2d');
  let scale = 1, dpr = 1, floor = null;
  const W = E.COURT.w, H = E.COURT.h, HOOP = E.HOOP;
  const PR = 16; // radio de un jugador

  function resize() {
    const box = $('stage').getBoundingClientRect();
    if (!box.width || !box.height) return;
    scale = Math.min(box.width / W, box.height / H);
    dpr = Math.min(3, window.devicePixelRatio || 1);
    cv.style.width = W * scale + 'px';
    cv.style.height = H * scale + 'px';
    cv.width = Math.round(W * scale * dpr);
    cv.height = Math.round(H * scale * dpr);
    floor = makeFloor(scale * dpr);
  }
  window.addEventListener('resize', () => { if (current === 'game') resize(); if (current === 'home') drawHero(); });

  // Parqué y líneas de la cancha. La línea de triple coincide con el alcance de tiro.
  function makeFloor(k) {
    const c = document.createElement('canvas');
    c.width = Math.round(W * k); c.height = Math.round(H * k);
    const g = c.getContext('2d');
    g.setTransform(k, 0, 0, k, 0, 0);
    paintCourt(g, W, H);
    return c;
  }

  function paintCourt(g, w, h, keyColor) {
    // Tablas de madera
    g.fillStyle = '#D9A866';
    g.fillRect(0, 0, w, h);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const plank = 18;
    for (let x = 0; x < w; x += plank) {
      let y = -rnd() * 120;
      while (y < h) {
        const len = 90 + rnd() * 140;
        const tone = rnd();
        g.fillStyle = `rgba(${tone > .5 ? '255,236,200' : '120,72,28'},${0.05 + rnd() * 0.08})`;
        g.fillRect(x, y, plank, len);
        g.fillStyle = 'rgba(90,52,18,.16)';
        g.fillRect(x, y, plank, 1);
        y += len;
      }
      g.fillStyle = 'rgba(90,52,18,.14)';
      g.fillRect(x, 0, 1, h);
    }
    // Pintura de la zona
    g.fillStyle = keyColor || 'rgba(178, 62, 28, .78)';
    g.fillRect(HOOP.x - 50, 30, 100, 170);
    // Líneas
    g.strokeStyle = 'rgba(255,255,255,.92)';
    g.lineWidth = 3;
    g.strokeRect(6, 6, w - 12, h - 12);
    g.strokeRect(HOOP.x - 50, 6, 100, 194);
    g.beginPath(); g.arc(HOOP.x, 200, 50, 0, Math.PI); g.stroke();
    g.setLineDash([8, 8]);
    g.beginPath(); g.arc(HOOP.x, 200, 50, Math.PI, 2 * Math.PI); g.stroke();
    g.setLineDash([]);
    // Línea de triple = alcance de tiro
    const R = E.DEFAULT_RANGE;
    const side = 24;
    const a = Math.asin((side - HOOP.x) / R); // ángulo en que el arco toca las líneas laterales
    const yJoin = HOOP.y + Math.cos(a) * R;
    g.beginPath();
    g.moveTo(side, 6); g.lineTo(side, yJoin);
    g.arc(HOOP.x, HOOP.y, R, Math.PI / 2 - a, Math.PI / 2 + a, true);
    g.lineTo(w - side, 6);
    g.stroke();
    // Medio campo
    g.beginPath(); g.moveTo(6, h - 6); g.lineTo(w - 6, h - 6); g.stroke();
    g.beginPath(); g.arc(HOOP.x, h - 6, 50, Math.PI, 2 * Math.PI); g.stroke();
  }

  function drawHoop(g, swish) {
    // Tablero
    g.fillStyle = 'rgba(255,255,255,.95)';
    g.fillRect(HOOP.x - 36, 44, 72, 7);
    g.fillStyle = '#1D2A44';
    g.fillRect(HOOP.x - 36, 44, 72, 2);
    // Red
    g.strokeStyle = 'rgba(255,255,255,.85)';
    g.lineWidth = 1.2;
    const sw = swish ? Math.sin(swish * Math.PI) * 4 : 0;
    for (let k = -3; k <= 3; k++) {
      g.beginPath();
      g.moveTo(HOOP.x + k * 4.3, HOOP.y);
      g.lineTo(HOOP.x + k * 2.6, HOOP.y + 16 + sw);
      g.stroke();
    }
    // Aro
    g.strokeStyle = '#F26B1D';
    g.lineWidth = 3.5;
    g.beginPath(); g.arc(HOOP.x, HOOP.y, 14, 0, Math.PI * 2); g.stroke();
  }

  function drawBall(g, x, y, s) {
    s = s || 1;
    const r = E.BALL_R * s;
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.beginPath(); g.ellipse(x + 2, y + 3 + (s - 1) * 12, r, r * .7, 0, 0, Math.PI * 2); g.fill();
    const grd = g.createRadialGradient(x - r * .35, y - r * .35, r * .2, x, y, r);
    grd.addColorStop(0, '#FF9A52'); grd.addColorStop(1, '#D8560F');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(40,16,4,.75)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x - r, y); g.lineTo(x + r, y); g.stroke();
    g.beginPath(); g.moveTo(x, y - r); g.lineTo(x, y + r); g.stroke();
    g.beginPath(); g.arc(x - r * 1.25, y, r * .9, -0.9, 0.9); g.stroke();
    g.beginPath(); g.arc(x + r * 1.25, y, r * .9, Math.PI - 0.9, Math.PI + 0.9); g.stroke();
  }

  function drawPlayer(g, x, y, colors, label, opts) {
    opts = opts || {};
    g.save();
    g.globalAlpha = opts.alpha == null ? 1 : opts.alpha;
    g.fillStyle = 'rgba(0,0,0,.28)';
    g.beginPath(); g.ellipse(x + 2, y + 4, PR, PR * .8, 0, 0, Math.PI * 2); g.fill();
    if (opts.glow) {
      g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 3;
      g.beginPath(); g.arc(x, y, PR + 6, 0, Math.PI * 2); g.stroke();
    }
    g.fillStyle = colors[0];
    g.beginPath(); g.arc(x, y, PR, 0, Math.PI * 2); g.fill();
    g.lineWidth = 3.5; g.strokeStyle = colors[1];
    g.beginPath(); g.arc(x, y, PR - 1.75, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1; g.strokeStyle = 'rgba(0,0,0,.55)';
    g.beginPath(); g.arc(x, y, PR + .5, 0, Math.PI * 2); g.stroke();
    if (label != null) {
      g.fillStyle = colors[1];
      g.font = '800 15px "Barlow Condensed", "Arial Narrow", sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(label, x, y + 1);
    }
    g.restore();
  }

  function nodeXY(n) { return n === 'H' ? HOOP : { x: G.level.players[n][0], y: G.level.players[n][1] }; }

  function drawPlan(g, chain, color, dashed, finger) {
    if (!chain.length) return;
    g.save();
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (let i = 0; i < chain.length - 1; i++) {
      const a = nodeXY(chain[i]), b = nodeXY(chain[i + 1]);
      const shot = chain[i + 1] === 'H';
      const far = shot && E.dist(a.x, a.y, b.x, b.y) > (G.level.range || E.DEFAULT_RANGE);
      g.strokeStyle = 'rgba(14,26,49,.55)'; g.lineWidth = 9;
      g.setLineDash(shot ? [2, 12] : dashed ? [10, 10] : []);
      line(g, a, b, shot);
      g.strokeStyle = far ? '#F0565B' : shot ? '#FFC53D' : color; g.lineWidth = 5;
      line(g, a, b, shot);
    }
    if (finger) {
      const a = nodeXY(chain[chain.length - 1]);
      g.setLineDash([4, 8]);
      g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 4;
      line(g, a, finger, false);
    }
    g.restore();
  }
  function line(g, a, b, arc) {
    g.beginPath(); g.moveTo(a.x, a.y);
    if (arc) {
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - Math.min(70, E.dist(a.x, a.y, b.x, b.y) * .3);
      g.quadraticCurveTo(mx, my, b.x, b.y);
    } else g.lineTo(b.x, b.y);
    g.stroke();
  }

  function drawWalls(g) {
    for (const w of G.level.walls || []) {
      g.save();
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = E.WALL_T + 2;
      g.beginPath(); g.moveTo(w[0] + 2, w[1] + 3); g.lineTo(w[2] + 2, w[3] + 3); g.stroke();
      g.strokeStyle = '#22335A'; g.lineWidth = E.WALL_T;
      g.beginPath(); g.moveTo(w[0], w[1]); g.lineTo(w[2], w[3]); g.stroke();
      g.strokeStyle = '#FFC53D'; g.lineWidth = 3; g.setLineDash([6, 6]);
      g.beginPath(); g.moveTo(w[0], w[1]); g.lineTo(w[2], w[3]); g.stroke();
      g.restore();
    }
  }

  function drawDefenderRoutes(g) {
    for (const d of G.level.defenders || []) {
      if (!d.path) continue;
      const pts = [[d.x, d.y]].concat(d.path);
      g.save();
      g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2; g.setLineDash([3, 6]);
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts.slice(1)) g.lineTo(p[0], p[1]);
      g.stroke();
      // flecha con la dirección inicial
      const a = pts[0], b = pts[1];
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const ax = a[0] + Math.cos(ang) * 30, ay = a[1] + Math.sin(ang) * 30;
      g.setLineDash([]); g.fillStyle = 'rgba(255,255,255,.9)';
      g.beginPath();
      g.moveTo(ax + Math.cos(ang) * 7, ay + Math.sin(ang) * 7);
      g.lineTo(ax + Math.cos(ang + 2.4) * 7, ay + Math.sin(ang + 2.4) * 7);
      g.lineTo(ax + Math.cos(ang - 2.4) * 7, ay + Math.sin(ang - 2.4) * 7);
      g.fill();
      g.restore();
    }
  }

  function render(now) {
    requestAnimationFrame(render);
    if (current !== 'game' || !G.level || !floor) return;
    const g = ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(floor, 0, 0);
    g.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);

    const lv = G.level;
    const running = G.mode === 'run';
    const t = running ? (now - G.runStart) / 1000 : 0;
    const tc = running ? Math.min(t, G.result.end) : 0;

    // Alcance de tiro del último jugador de la jugada mientras trazas
    if (G.mode === 'plan' && G.drawing && G.chain.length && G.chain[G.chain.length - 1] !== 'H') {
      const p = nodeXY(G.chain[G.chain.length - 1]);
      const inRange = E.dist(p.x, p.y, HOOP.x, HOOP.y) <= (lv.range || E.DEFAULT_RANGE);
      g.fillStyle = inRange ? 'rgba(60,193,127,.18)' : 'rgba(240,86,91,.16)';
      g.beginPath(); g.arc(HOOP.x, HOOP.y, lv.range || E.DEFAULT_RANGE, 0, Math.PI * 2); g.fill();
    }

    drawWalls(g);
    if (!running) drawDefenderRoutes(g);

    const swish = running && G.result.ok && t > G.result.end ? Math.min(1, (t - G.result.end) / .4) : 0;
    drawHoop(g, swish);

    // Ayuda
    if (G.hint && G.solution.best && !running) {
      g.save(); g.globalAlpha = .55 + .25 * Math.sin(now / 250);
      drawPlan(g, G.solution.best.chain, '#9FE8C3', true);
      g.restore();
    }

    // Tus jugadores
    lv.players.forEach((p, i) => {
      const inChain = G.chain.indexOf(i) >= 0;
      drawPlayer(g, p[0], p[1], G.mine.colors, String(i + 4), { glow: G.mode === 'plan' && inChain && G.drawing });
    });

    // Defensores
    for (const d of lv.defenders || []) {
      if (!running && d.path) {
        // fantasma que muestra el movimiento
        const gp = E.defenderPos(d, (now / 1000) % 3.2);
        drawPlayer(g, gp.x, gp.y, G.rival.colors, null, { alpha: .28 });
      }
      const p = E.defenderPos(d, tc);
      g.save();
      g.strokeStyle = 'rgba(240,86,91,.55)'; g.lineWidth = 1.5; g.setLineDash([3, 4]);
      g.beginPath(); g.arc(p.x, p.y, E.REACH + E.BALL_R, 0, Math.PI * 2); g.stroke();
      g.restore();
      drawPlayer(g, p.x, p.y, G.rival.colors, '×');
    }

    // Jugada trazada
    if (!running && G.chain.length) drawPlan(g, G.chain, '#FFFFFF', false, G.drawing && G.chain[G.chain.length - 1] !== 'H' ? G.finger : null);

    // Pelota
    if (!running) {
      const p = lv.players[0];
      drawBall(g, p[0] + 11, p[1] - 11);
    } else {
      const b = ballAt(t);
      drawBall(g, b.x, b.y, b.s);
      if (t > G.result.end && !G.shownEnd) {
        G.shownEnd = true;
        const r = G.result;
        if (r.ok) floatMsg('¡Canasta!', 'good');
        else floatMsg({ intercepcion: '¡Robo!', obstaculo: '¡Bloqueada!', tapon: '¡Tapón!', lejos: '¡Corta!' }[r.reason] || '¡Fallo!', 'bad');
        try { if (!r.ok && navigator.vibrate) navigator.vibrate(60); } catch (e) { /* nada */ }
        setTimeout(() => { clearFloat(); finishLevel(); }, r.ok ? 900 : 1100);
      }
    }
  }

  // Posición de la pelota durante la jugada (s = tamaño, crece en el tiro por la altura).
  function ballAt(t) {
    const legs = G.result.legs;
    let last = legs[0].from;
    for (const l of legs) {
      if (t < l.t0) return { x: last.x, y: last.y - 11, s: 1 };
      if (t <= l.t1) {
        const f = (t - l.t0) / (l.t1 - l.t0 || 1);
        if (l.type === 'shot') {
          const hgt = Math.sin(Math.PI * f);
          const x = l.from.x + (l.to.x - l.from.x) * f;
          const y = l.from.y + (l.to.y - l.from.y) * f - hgt * Math.min(70, E.dist(l.from.x, l.from.y, l.to.x, l.to.y) * .3);
          return { x, y, s: 1 + hgt * .7 };
        }
        return { x: l.from.x + (l.to.x - l.from.x) * f, y: l.from.y + (l.to.y - l.from.y) * f, s: 1 };
      }
      last = l.to;
    }
    const end = legs[legs.length - 1];
    if (G.result.ok) {
      const k = Math.min(1, (t - G.result.end) / .3);
      return { x: HOOP.x, y: HOOP.y + k * 14, s: 1 - k * .15 };
    }
    return { x: end.to.x, y: end.to.y, s: 1 };
  }

  // ---------------------------------------------------------------- Trazar con el dedo
  function toCourt(e) {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
  }
  cv.addEventListener('pointerdown', (e) => {
    if (G.mode !== 'plan' || !$('modal').hidden) return;
    const p = toCourt(e);
    const h = G.level.players[0];
    if (E.dist(p.x, p.y, h[0], h[1]) > 40) {
      $('tipbar').textContent = 'Empieza a trazar desde el jugador que tiene la pelota.';
      return;
    }
    cv.setPointerCapture(e.pointerId);
    G.drawing = true; G.chain = [0]; G.finger = p;
    clearFloat();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!G.drawing) return;
    const p = toCourt(e);
    G.finger = p;
    const ch = G.chain;
    const last = ch[ch.length - 1];
    if (last === 'H') {
      if (E.dist(p.x, p.y, HOOP.x, HOOP.y) > 46) ch.pop();
      return;
    }
    // Volver atrás si regresas al jugador anterior
    if (ch.length >= 2) {
      const prev = nodeXY(ch[ch.length - 2]);
      if (E.dist(p.x, p.y, prev.x, prev.y) < 20) { ch.pop(); return; }
    }
    for (let i = 1; i < G.level.players.length; i++) {
      if (ch.indexOf(i) >= 0) continue;
      const q = G.level.players[i];
      if (E.dist(p.x, p.y, q[0], q[1]) < E.SNAP) { ch.push(i); return; }
    }
    if (E.dist(p.x, p.y, HOOP.x, HOOP.y) < 34) ch.push('H');
  });
  const endDraw = (e) => {
    if (!G.drawing) return;
    G.drawing = false;
    try { cv.releasePointerCapture(e.pointerId); } catch (err) { /* nada */ }
    if (G.chain[G.chain.length - 1] === 'H') {
      G.result = E.simulate(G.level, G.chain.slice());
      G.mode = 'run';
      G.runStart = performance.now();
      $('tipbar').textContent = '';
    } else {
      G.chain = [];
      $('tipbar').textContent = 'La jugada tiene que terminar en el aro. Suelta el dedo sobre el aro.';
    }
  };
  cv.addEventListener('pointerup', endDraw);
  cv.addEventListener('pointercancel', endDraw);

  // ---------------------------------------------------------------- Cancha del inicio
  function drawHero() {
    const c = $('hero');
    const r = c.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const k = Math.min(3, window.devicePixelRatio || 1);
    c.width = Math.round(r.width * k); c.height = Math.round(r.height * k);
    const g = c.getContext('2d');
    // Vista de la mitad superior de la cancha, centrada en el aro
    // La cancha cubre todo el recuadro; se recorta por los lados o por abajo
    const s = Math.max(r.width / W, r.height / H);
    g.setTransform(k * s, 0, 0, k * s, k * (r.width - W * s) / 2, 0);
    paintCourt(g, W, H);
    drawHoop(g, 0);
    const mine = S.country ? myTeam(Math.min(S.unlocked, LEVELS.length - 1)).colors : ['#74ACDF', '#FFFFFF'];
    const pts = [[90, 290], [250, 230], [170, 150]];
    g.save();
    g.lineCap = 'round'; g.lineWidth = 5; g.strokeStyle = '#FFFFFF';
    g.beginPath(); g.moveTo(90, 290); g.lineTo(250, 230); g.lineTo(170, 150); g.stroke();
    g.strokeStyle = '#FFC53D'; g.setLineDash([2, 12]);
    g.beginPath(); g.moveTo(170, 150); g.quadraticCurveTo(178, 95, HOOP.x, HOOP.y); g.stroke();
    g.restore();
    drawPlayer(g, 175, 215, ['#22223B', '#F2C230'], '×');
    pts.forEach((p, i) => drawPlayer(g, p[0], p[1], mine, String(i + 4)));
    drawBall(g, 101, 279);
  }

  // ---------------------------------------------------------------- Botones
  $('btn-play').onclick = () => startLevel(Math.min(S.unlocked, LEVELS.length - 1));
  $('btn-levels').onclick = () => show('levels');
  $('btn-team').onclick = teamModal;
  $('btn-premium-top').onclick = premiumModal;
  $('btn-levels-back').onclick = () => show('home');
  $('btn-game-back').onclick = () => { closeModal(); show('levels'); };
  $('btn-reset').onclick = () => { if (G.mode === 'plan') { G.chain = []; $('tipbar').textContent = G.level.tip; } };
  $('btn-hint').onclick = useHint;

  // ---------------------------------------------------------------- Arranque
  requestAnimationFrame(render);
  const boot = () => {
    show('home');
    if (!S.country) chooseCountry(true, renderHome);
  };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(boot, boot); else boot();
})();
