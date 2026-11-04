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

  // ---------------------------------------------------------------- Personajes
  const SKINS = ['#F3CFB3', '#E3B08A', '#C98E62', '#A26B45', '#7A4C2E', '#5B3720'];
  const HAIRS = ['#17110D', '#2E1D12', '#5A3A22', '#8C5A2E', '#C9974F', '#E3CF9A'];
  const STYLES = ['short', 'afro', 'buzz', 'band', 'pony', 'short', 'bald', 'band'];
  const NUMS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
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
      num: NUMS[((base >>> 3) + i * 5) % NUMS.length],
      name: SURNAMES[((base >>> 7) + i * 7) % SURNAMES.length],
      phase: (h % 100) / 37,
    };
  }

  // ---------------------------------------------------------------- Partida
  const G = {
    idx: 0, level: null, solution: null, mode: 'plan',
    st: null, anim: null, drag: null, hint: false, hintCache: null,
    mine: null, rival: null, myLooks: [], rivalLooks: [],
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
    G.myLooks = lv.players.map((_, k) => lookFor(G.mine, k));
    G.rivalLooks = (lv.defenders || []).map((_, k) => lookFor(G.rival, k));
    G.hint = false;
    resetPlay();
    show('game');
    $('game-label').innerHTML = `Nivel ${i + 1} · ${lv.name}<small>${G.mine.name} vs ${G.rival.name}</small>`;
    levelCard();
  }

  function resetPlay() {
    G.st = E.initState(G.level);
    G.anim = null; G.drag = null; G.hintCache = null;
    G.mode = 'plan';
    clearFloat();
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
        <div class="fact"><b>${min === 0 ? 'Tiro directo' : min + ' ' + movesWord(min)}</b><span>para 3 estrellas</span></div>
        <div class="fact"><b>${(lv.defenders || []).length}</b><span>defensores</span></div>
      </div>
      <ul class="howto">
        <li><b>Pase:</b> arrastra del jugador con la pelota a un compañero.</li>
        <li><b>Conducir:</b> arrastra a un espacio libre para avanzar unos pasos.</li>
        <li><b>Tiro:</b> arrastra hasta el aro.</li>
      </ul>
      <p class="note">Juegas un movimiento por vez. Los rivales solo se mueven mientras se ejecuta tu movimiento.</p>
      <div class="actions"><button class="btn" id="m-go">A jugar</button></div>`,
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
        obstaculo: ['Pase bloqueado', 'La pelota chocó contra un obstáculo.'],
        tapon: ['Tapón', 'Tenías un defensor encima. Tira desde donde estés libre.'],
        lejos: ['Muy lejos', 'Tiraste desde fuera de la línea de triple: la pelota no llega.'],
      };
      const t = texts[reason] || ['Jugada fallida', 'Inténtalo de nuevo.'];
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

  // ---------------------------------------------------------------- Dibujo
  const cv = $('court');
  const ctx = cv.getContext('2d');
  let scale = 1, dpr = 1, floor = null;
  const W = E.COURT.w, H = E.COURT.h, HOOP = E.HOOP;

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

  function makeFloor(k) {
    const c = document.createElement('canvas');
    c.width = Math.round(W * k); c.height = Math.round(H * k);
    const g = c.getContext('2d');
    g.setTransform(k, 0, 0, k, 0, 0);
    paintCourt(g, W, H);
    return c;
  }

  // Parqué y líneas. La línea de triple coincide con el alcance de tiro.
  function paintCourt(g, w, h) {
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
    g.fillStyle = 'rgba(178, 62, 28, .78)';
    g.fillRect(HOOP.x - 50, 30, 100, 170);
    g.strokeStyle = 'rgba(255,255,255,.92)';
    g.lineWidth = 3;
    g.strokeRect(6, 6, w - 12, h - 12);
    g.strokeRect(HOOP.x - 50, 6, 100, 194);
    g.beginPath(); g.arc(HOOP.x, 200, 50, 0, Math.PI); g.stroke();
    g.setLineDash([8, 8]);
    g.beginPath(); g.arc(HOOP.x, 200, 50, Math.PI, 2 * Math.PI); g.stroke();
    g.setLineDash([]);
    const R = E.DEFAULT_RANGE;
    const side = 24;
    const a = Math.asin((side - HOOP.x) / R);
    const yJoin = HOOP.y + Math.cos(a) * R;
    g.beginPath();
    g.moveTo(side, 6); g.lineTo(side, yJoin);
    g.arc(HOOP.x, HOOP.y, R, Math.PI / 2 - a, Math.PI / 2 + a, true);
    g.lineTo(w - side, 6);
    g.stroke();
    g.beginPath(); g.moveTo(6, h - 6); g.lineTo(w - 6, h - 6); g.stroke();
    g.beginPath(); g.arc(HOOP.x, h - 6, 50, Math.PI, 2 * Math.PI); g.stroke();
  }

  function drawHoop(g, swish) {
    g.fillStyle = 'rgba(255,255,255,.95)';
    g.fillRect(HOOP.x - 36, 44, 72, 7);
    g.fillStyle = '#1D2A44';
    g.fillRect(HOOP.x - 36, 44, 72, 2);
    g.strokeStyle = 'rgba(255,255,255,.85)';
    g.lineWidth = 1.2;
    const sw = swish ? Math.sin(swish * Math.PI) * 4 : 0;
    for (let k = -3; k <= 3; k++) {
      g.beginPath();
      g.moveTo(HOOP.x + k * 4.3, HOOP.y);
      g.lineTo(HOOP.x + k * 2.6, HOOP.y + 16 + sw);
      g.stroke();
    }
    g.strokeStyle = '#F26B1D';
    g.lineWidth = 3.5;
    g.beginPath(); g.arc(HOOP.x, HOOP.y, 14, 0, Math.PI * 2); g.stroke();
  }

  // Pelota. lift = altura sobre el piso (la sombra queda en el piso).
  function drawBall(g, x, y, lift, s) {
    s = s || 1;
    const r = E.BALL_R * s;
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.beginPath(); g.ellipse(x + 1, y + 1, r * (1 - Math.min(.4, lift / 120)), r * .5, 0, 0, Math.PI * 2); g.fill();
    const by = y - lift;
    const grd = g.createRadialGradient(x - r * .35, by - r * .35, r * .2, x, by, r);
    grd.addColorStop(0, '#FF9A52'); grd.addColorStop(1, '#D8560F');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, by, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(40,16,4,.75)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x - r, by); g.lineTo(x + r, by); g.stroke();
    g.beginPath(); g.moveTo(x, by - r); g.lineTo(x, by + r); g.stroke();
    g.beginPath(); g.arc(x - r * 1.25, by, r * .9, -0.9, 0.9); g.stroke();
    g.beginPath(); g.arc(x + r * 1.25, by, r * .9, Math.PI - 0.9, Math.PI + 0.9); g.stroke();
  }

  function rrect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  // Personaje de pie con los pies en (c.x, c.y).
  // pose: idle | run | guard | dribble | pass | catch | shoot
  function drawChar(g, c, now) {
    const L = c.look;
    const t = now / 1000 + L.phase;
    const run = c.pose === 'run';
    const bob = run ? Math.abs(Math.sin(t * 14)) * 1.6 : Math.sin(t * 2.6) * 0.6;
    const jump = c.jump || 0;
    const x = c.x, y = c.y - jump - bob;
    const outline = 'rgba(20,12,6,.45)';
    g.save();
    if (c.alpha != null) g.globalAlpha = c.alpha;

    // Sombra y aro de selección en el piso
    g.fillStyle = 'rgba(0,0,0,.28)';
    g.beginPath(); g.ellipse(c.x + 1, c.y, 12 - jump * .2, 4.5, 0, 0, Math.PI * 2); g.fill();
    if (c.ring) {
      g.strokeStyle = c.ring; g.lineWidth = 2.5;
      g.beginPath(); g.ellipse(c.x, c.y, 18, 7.5, 0, 0, Math.PI * 2); g.stroke();
    }

    // Piernas y zapatillas
    const stride = run ? Math.sin(t * 14) * 3.5 : 0;
    [[-4, stride], [4, -stride]].forEach(([dx, s]) => {
      const fx = x + dx + s * .35, fy = y - 3 - Math.max(0, s) * .5;
      g.strokeStyle = L.skin; g.lineWidth = 4.6; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x + dx, y - 15); g.lineTo(fx, fy); g.stroke();
      g.fillStyle = '#1F1F24';
      g.beginPath(); g.ellipse(fx, fy + 1, 3.8, 2.4, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#F4F4F4';
      g.fillRect(fx - 2.4, fy + .2, 4.8, 1);
    });

    // Pelo de atrás (afro y coleta)
    if (L.style === 'afro') { g.fillStyle = L.hair; g.beginPath(); g.arc(x, y - 48, 11.5, 0, Math.PI * 2); g.fill(); }
    if (L.style === 'pony') { g.fillStyle = L.hair; g.beginPath(); g.arc(x, y - 57, 4.2, 0, Math.PI * 2); g.fill(); }

    // Short
    rrect(g, x - 9.5, y - 24, 19, 11, 3);
    g.fillStyle = L.colors[0]; g.fill();
    g.strokeStyle = outline; g.lineWidth = 1; g.stroke();
    g.fillStyle = L.colors[1];
    g.fillRect(x - 9.5, y - 15.5, 19, 1.6);

    // Camiseta
    rrect(g, x - 10.5, y - 38, 21, 17, 5);
    g.fillStyle = L.colors[0]; g.fill();
    g.strokeStyle = outline; g.lineWidth = 1; g.stroke();
    g.strokeStyle = L.colors[1]; g.lineWidth = 1.8;
    g.beginPath(); g.arc(x, y - 38, 4.4, 0.15, Math.PI - 0.15); g.stroke();
    g.beginPath(); g.moveTo(x - 9.5, y - 35); g.quadraticCurveTo(x - 7, y - 31, x - 9.8, y - 27); g.stroke();
    g.beginPath(); g.moveTo(x + 9.5, y - 35); g.quadraticCurveTo(x + 7, y - 31, x + 9.8, y - 27); g.stroke();
    g.fillStyle = L.colors[1];
    g.font = '800 10px "Barlow Condensed", "Arial Narrow", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(L.num), x, y - 28.5);

    // Brazos
    const sw = run ? Math.sin(t * 14) * 3 : 0;
    const hands = {
      idle: [[-12.5, -22], [12.5, -22]],
      run: [[-11.5, -24 + sw], [11.5, -24 - sw]],
      guard: [[-20, -40], [20, -40]],
      dribble: [[-12.5, -23], [14, -19]],
      pass: [[-7, -29], [7, -29]],
      catch: [[-9, -42], [9, -42]],
      shoot: [[-3.5, -57], [4, -58]],
    }[c.pose] || [[-12.5, -22], [12.5, -22]];
    [[-9, hands[0]], [9, hands[1]]].forEach(([sx, h]) => {
      g.strokeStyle = L.skin; g.lineWidth = 4; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x + sx, y - 35); g.lineTo(x + h[0], y + h[1]); g.stroke();
      g.fillStyle = L.skin;
      g.beginPath(); g.arc(x + h[0], y + h[1], 2.5, 0, Math.PI * 2); g.fill();
    });
    // Mangas
    g.fillStyle = L.colors[0];
    g.beginPath(); g.arc(x - 9, y - 35, 3, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(x + 9, y - 35, 3, 0, Math.PI * 2); g.fill();

    // Cabeza
    const hy = y - 47;
    g.fillStyle = L.skin;
    g.beginPath(); g.arc(x - 8.4, hy + 1, 2.1, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(x + 8.4, hy + 1, 2.1, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(x, hy, 8.6, 0, Math.PI * 2); g.fill();
    g.strokeStyle = outline; g.lineWidth = 1; g.stroke();

    // Pelo de arriba
    g.fillStyle = L.hair;
    if (L.style === 'short' || L.style === 'band' || L.style === 'pony') {
      g.beginPath(); g.arc(x, hy - 0.5, 8.9, Math.PI * 1.02, Math.PI * 1.98); g.closePath(); g.fill();
      g.beginPath(); g.ellipse(x - 2, hy - 6.2, 6.5, 3.2, -0.2, 0, Math.PI * 2); g.fill();
    } else if (L.style === 'afro') {
      g.beginPath(); g.arc(x, hy - 2.5, 9.4, Math.PI * 1.05, Math.PI * 1.95); g.closePath(); g.fill();
    } else if (L.style === 'buzz') {
      g.globalAlpha *= .7;
      g.beginPath(); g.arc(x, hy - 0.5, 8.8, Math.PI * 1.08, Math.PI * 1.92); g.closePath(); g.fill();
      g.globalAlpha = c.alpha == null ? 1 : c.alpha;
    } else if (L.style === 'bald') {
      g.fillStyle = 'rgba(255,255,255,.28)';
      g.beginPath(); g.ellipse(x - 3, hy - 4.5, 3, 1.6, -0.4, 0, Math.PI * 2); g.fill();
    }
    if (L.style === 'band') {
      g.fillStyle = L.colors[1];
      g.fillRect(x - 8.6, hy - 4.6, 17.2, 2.6);
    }

    // Cara
    const blink = (Math.floor(t * 10) % 37) === 0;
    g.fillStyle = '#1B1410';
    if (blink) {
      g.fillRect(x - 4.4, hy + .2, 2.4, .9); g.fillRect(x + 2, hy + .2, 2.4, .9);
    } else {
      g.beginPath(); g.arc(x - 3.2, hy + .6, 1.3, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(x + 3.2, hy + .6, 1.3, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = '#1B1410'; g.lineWidth = 1.1; g.lineCap = 'round';
    if (c.rival) {
      g.beginPath(); g.moveTo(x - 5.2, hy - 2.6); g.lineTo(x - 1.6, hy - 1.4); g.stroke();
      g.beginPath(); g.moveTo(x + 5.2, hy - 2.6); g.lineTo(x + 1.6, hy - 1.4); g.stroke();
      g.beginPath(); g.moveTo(x - 1.8, hy + 4.4); g.lineTo(x + 1.8, hy + 4.4); g.stroke();
    } else {
      g.strokeStyle = '#6A2E1C';
      g.beginPath(); g.arc(x, hy + 3, 2.6, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
    }
    g.restore();
  }

  function drawNameTag(g, x, y, text) {
    g.save();
    g.font = '700 10px "Barlow", system-ui, sans-serif';
    const w = g.measureText(text).width + 12;
    rrect(g, x - w / 2, y - 9, w, 15, 7.5);
    g.fillStyle = 'rgba(14,26,49,.88)'; g.fill();
    g.fillStyle = '#F7EEDF';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, x, y - 1.2);
    g.restore();
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

  // Ruta de cada defensor que se mueve, con una flecha hacia donde va ahora.
  function drawDefenderRoutes(g, gt, now) {
    for (const d of G.level.defenders || []) {
      if (!d.path) continue;
      const pts = [[d.x, d.y]].concat(d.path);
      g.save();
      g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2; g.setLineDash([3, 6]);
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts.slice(1)) g.lineTo(p[0], p[1]);
      g.stroke();
      const p0 = E.defenderPos(d, gt), p1 = E.defenderPos(d, gt + 0.08);
      const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      const ax = p0.x + Math.cos(ang) * 26, ay = p0.y + Math.sin(ang) * 26;
      g.setLineDash([]); g.fillStyle = 'rgba(255,255,255,.95)';
      g.beginPath();
      g.moveTo(ax + Math.cos(ang) * 8, ay + Math.sin(ang) * 8);
      g.lineTo(ax + Math.cos(ang + 2.4) * 7, ay + Math.sin(ang + 2.4) * 7);
      g.lineTo(ax + Math.cos(ang - 2.4) * 7, ay + Math.sin(ang - 2.4) * 7);
      g.fill();
      // Huella que adelanta su movimiento
      const gp = E.defenderPos(d, gt + (now / 1000) % 2.4);
      g.fillStyle = 'rgba(240,86,91,.28)';
      g.beginPath(); g.ellipse(gp.x, gp.y, 12, 5, 0, 0, Math.PI * 2); g.fill();
      g.restore();
    }
  }

  function arrowLine(g, a, b, color, opts) {
    opts = opts || {};
    g.save();
    g.lineCap = 'round';
    g.setLineDash(opts.dash || []);
    g.strokeStyle = 'rgba(14,26,49,.5)'; g.lineWidth = 8;
    pathLine(g, a, b, opts.arc); g.stroke();
    g.strokeStyle = color; g.lineWidth = 4.5;
    pathLine(g, a, b, opts.arc); g.stroke();
    if (!opts.arc) {
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      g.setLineDash([]); g.fillStyle = color;
      g.beginPath();
      g.moveTo(b.x + Math.cos(ang) * 3, b.y + Math.sin(ang) * 3);
      g.lineTo(b.x + Math.cos(ang + 2.5) * 11, b.y + Math.sin(ang + 2.5) * 11);
      g.lineTo(b.x + Math.cos(ang - 2.5) * 11, b.y + Math.sin(ang - 2.5) * 11);
      g.fill();
    }
    g.restore();
  }
  function pathLine(g, a, b, arc) {
    g.beginPath(); g.moveTo(a.x, a.y);
    if (arc) {
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - Math.min(70, E.dist(a.x, a.y, b.x, b.y) * .3);
      g.quadraticCurveTo(mx, my, b.x, b.y);
    } else g.lineTo(b.x, b.y);
  }

  // Cómo se ve el movimiento que se está arrastrando.
  function drawDragPreview(g) {
    const d = G.drag;
    if (!d || !d.kind) return;
    const hp = G.st.pos[G.st.holder];
    const a = { x: hp[0], y: hp[1] };
    const range = G.level.range || E.DEFAULT_RANGE;
    if (d.kind === 'shot') {
      const far = E.dist(a.x, a.y, HOOP.x, HOOP.y) > range;
      g.fillStyle = far ? 'rgba(240,86,91,.16)' : 'rgba(60,193,127,.18)';
      g.beginPath(); g.arc(HOOP.x, HOOP.y, range, 0, Math.PI * 2); g.fill();
      arrowLine(g, a, HOOP, far ? '#F0565B' : '#FFC53D', { arc: true, dash: [2, 11] });
    } else if (d.kind === 'pass') {
      const bp = G.st.pos[d.to];
      const b = { x: bp[0], y: bp[1] };
      const hit = E.wallHit(G.level, a.x, a.y, b.x, b.y);
      if (hit !== null) {
        const m = { x: a.x + (b.x - a.x) * hit, y: a.y + (b.y - a.y) * hit };
        arrowLine(g, a, m, '#F0565B');
      } else arrowLine(g, a, b, '#FFFFFF');
    } else if (d.kind === 'dribble') {
      const tgt = E.dribbleTarget(G.level, G.st, d.x, d.y);
      g.save();
      g.strokeStyle = 'rgba(159,232,195,.45)'; g.lineWidth = 1.5; g.setLineDash([3, 5]);
      g.beginPath(); g.arc(a.x, a.y, E.DRIBBLE_MAX, 0, Math.PI * 2); g.stroke();
      g.restore();
      arrowLine(g, a, tgt, '#9FE8C3', { dash: [7, 7] });
      g.fillStyle = 'rgba(159,232,195,.35)';
      g.beginPath(); g.ellipse(tgt.x, tgt.y, 13, 5.5, 0, 0, Math.PI * 2); g.fill();
    }
  }

  function drawHint(g, now) {
    const best = currentHint();
    if (!best || G.mode !== 'plan') return;
    const hp = G.st.pos[G.st.holder];
    const a = { x: hp[0], y: hp[1] };
    g.save();
    g.globalAlpha = .55 + .3 * Math.sin(now / 220);
    if (best.chain[1] === 'H') arrowLine(g, a, HOOP, '#9FE8C3', { arc: true, dash: [2, 11] });
    else { const bp = G.st.pos[best.chain[1]]; arrowLine(g, a, { x: bp[0], y: bp[1] }, '#9FE8C3', { dash: [10, 8] }); }
    g.restore();
  }

  function render(now) {
    requestAnimationFrame(render);
    if (current !== 'game' || !G.level || !floor) return;
    const g = ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(floor, 0, 0);
    g.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);

    const lv = G.level;
    const A = G.anim;
    const leg = A ? A.res.leg : null;
    // Tiempo del partido: congelado salvo mientras se ejecuta un movimiento
    let gt = G.st.t, f = 0;
    if (A) {
      const el = (now - A.real0) / 1000;
      gt = Math.min(leg.t1, leg.t0 + el);
      f = leg.t1 > leg.t0 ? (gt - leg.t0) / (leg.t1 - leg.t0) : 1;
      if (el >= leg.t1 - leg.t0 && !A.done) { A.done = true; onMoveEnd(A); }
    }

    drawWalls(g);
    if (!A) drawDefenderRoutes(g, gt, now);

    // Alcance de los defensores (en el piso)
    const defPos = (lv.defenders || []).map((d) => E.defenderPos(d, gt));
    if (!A) {
      g.save();
      g.strokeStyle = 'rgba(240,86,91,.55)'; g.lineWidth = 1.5; g.setLineDash([3, 4]);
      defPos.forEach((p) => { g.beginPath(); g.ellipse(p.x, p.y, E.REACH + E.BALL_R, (E.REACH + E.BALL_R) * .55, 0, 0, Math.PI * 2); g.stroke(); });
      g.restore();
    }

    const swish = A && A.res.scored && A.done ? Math.min(1, (now - A.doneAt) / 400) : 0;
    drawHoop(g, swish);
    if (G.hint) drawHint(g, now);
    if (G.mode === 'plan') drawDragPreview(g);

    // Personajes, ordenados por profundidad
    const chars = [];
    const holder = G.st.holder;
    G.st.pos.forEach((p, i) => {
      let x = p[0], y = p[1], pose = 'idle', jump = 0, ring = null;
      if (i === holder) { pose = 'dribble'; ring = G.mode === 'plan' ? '#FFC53D' : null; }
      if (leg && leg.who === i) {
        if (leg.type === 'dribble') { x = leg.from.x + (leg.to.x - leg.from.x) * f; y = leg.from.y + (leg.to.y - leg.from.y) * f; pose = f < 1 ? 'run' : 'dribble'; }
        if (leg.type === 'pass') pose = f < .35 ? 'pass' : 'idle';
        if (leg.type === 'shot') { pose = leg.blocked ? 'catch' : 'shoot'; jump = Math.sin(Math.PI * Math.min(1, f * 1.6)) * 12; }
      }
      if (leg && leg.type === 'pass' && leg.target === i) pose = 'catch';
      if (G.drag && G.drag.kind === 'pass' && G.drag.to === i) ring = '#FFFFFF';
      chars.push({ x, y, pose, jump, ring, look: G.myLooks[i], id: i });
    });
    (lv.defenders || []).forEach((d, k) => {
      const p = defPos[k];
      const moving = !!(A && d.path && d.speed && !A.done);
      chars.push({ x: p.x, y: p.y, pose: moving ? 'run' : 'guard', look: G.rivalLooks[k], rival: true });
    });
    chars.sort((a, b) => a.y - b.y);
    chars.forEach((c) => drawChar(g, c, now));

    // Pelota
    const hp = G.st.pos[holder];
    if (!A || leg.type === 'dribble') {
      let bx = hp[0], by = hp[1];
      if (leg && leg.type === 'dribble') { bx = leg.from.x + (leg.to.x - leg.from.x) * f; by = leg.from.y + (leg.to.y - leg.from.y) * f; }
      drawBall(g, bx + 14, by - 1, 2 + Math.abs(Math.sin(now / 140)) * 13, .9);
    } else if (leg.type === 'pass') {
      drawBall(g, leg.from.x + (leg.to.x - leg.from.x) * f, leg.from.y + (leg.to.y - leg.from.y) * f, 24);
    } else if (leg.type === 'shot') {
      if (leg.blocked) {
        drawBall(g, leg.from.x + 16 * f, leg.from.y + 8 * f, 40 * (1 - f) + 4);
      } else if (A.done && A.res.scored) {
        const k = Math.min(1, (now - A.doneAt) / 300);
        drawBall(g, HOOP.x, HOOP.y + k * 12, 0, 1 - k * .15);
      } else {
        const hgt = Math.sin(Math.PI * f) * Math.min(90, E.dist(leg.from.x, leg.from.y, leg.to.x, leg.to.y) * .45);
        const x = leg.from.x + (leg.to.x - leg.from.x) * f;
        const y = leg.from.y + (leg.to.y - leg.from.y) * f;
        drawBall(g, x, y, 40 * (1 - f) + hgt, 1 + Math.sin(Math.PI * f) * .5);
      }
    }

    // Nombre del jugador con la pelota
    if (G.mode === 'plan') {
      const L = G.myLooks[holder];
      drawNameTag(g, hp[0], hp[1] - 66, `#${L.num} ${L.name}`);
    }
  }

  // Termina la animación de un movimiento.
  function onMoveEnd(A) {
    A.doneAt = performance.now();
    const r = A.res;
    if (!r.ok) {
      floatMsg({ intercepcion: '¡Robo!', robo: '¡Robo!', obstaculo: '¡Bloqueada!', tapon: '¡Tapón!', lejos: '¡Corta!' }[r.reason] || '¡Fallo!', 'bad');
      try { if (navigator.vibrate) navigator.vibrate(60); } catch (e) { /* nada */ }
      G.mode = 'over';
      setTimeout(() => { clearFloat(); finishLevel(false, r.reason); }, 1100);
      return;
    }
    if (r.scored) {
      floatMsg('¡Canasta!', 'good');
      G.mode = 'over';
      setTimeout(() => { clearFloat(); finishLevel(true); }, 1000);
      return;
    }
    // Movimiento correcto: el juego espera el siguiente
    G.st = r.state;
    G.anim = null;
    G.mode = 'plan';
    updateMoveBar();
    if (G.hint) hintText();
    else $('tipbar').textContent = 'Bien. Elige el siguiente movimiento.';
  }

  // ---------------------------------------------------------------- Mover con el dedo
  function toCourt(e) {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
  }
  // ¿El dedo está sobre el personaje (pies o cuerpo)?
  const onChar = (p, q, r) => E.dist(p.x, p.y, q[0], q[1]) < (r || 24) || E.dist(p.x, p.y, q[0], q[1] - 26) < (r || 24) + 4;

  function classify(p) {
    const st = G.st;
    for (let j = 0; j < st.pos.length; j++) {
      if (j !== st.holder && onChar(p, st.pos[j], 24)) return { kind: 'pass', to: j };
    }
    if (E.dist(p.x, p.y, HOOP.x, HOOP.y) < 42) return { kind: 'shot' };
    const hp = st.pos[st.holder];
    if (E.dist(p.x, p.y, hp[0], hp[1]) < E.DRIBBLE_MIN + 6) return { kind: null };
    return { kind: 'dribble', x: p.x, y: p.y };
  }

  cv.addEventListener('pointerdown', (e) => {
    if (G.mode !== 'plan' || !$('modal').hidden) return;
    const p = toCourt(e);
    if (!onChar(p, G.st.pos[G.st.holder], 28)) {
      $('tipbar').textContent = 'Empieza desde el jugador que tiene la pelota (el del círculo amarillo).';
      return;
    }
    cv.setPointerCapture(e.pointerId);
    G.drag = { kind: null };
    clearFloat();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!G.drag) return;
    G.drag = classify(toCourt(e));
  });
  const endDrag = (e) => {
    if (!G.drag) return;
    const d = G.drag;
    G.drag = null;
    try { cv.releasePointerCapture(e.pointerId); } catch (err) { /* nada */ }
    if (!d.kind) {
      $('tipbar').textContent = 'Arrastra hacia un compañero, hacia un espacio libre o hacia el aro.';
      return;
    }
    let move;
    if (d.kind === 'pass') move = { type: 'pass', to: d.to };
    else if (d.kind === 'shot') move = { type: 'shot' };
    else {
      const tgt = E.dribbleTarget(G.level, G.st, d.x, d.y);
      if (tgt.len < E.DRIBBLE_MIN) { $('tipbar').textContent = 'No hay espacio para conducir hacia ahí.'; return; }
      move = { type: 'dribble', x: d.x, y: d.y };
    }
    G.anim = { res: E.step(G.level, G.st, move), real0: performance.now(), done: false };
    G.mode = 'anim';
    $('tipbar').textContent = '';
  };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);

  // ---------------------------------------------------------------- Cancha del inicio
  let heroTeam = null;
  function drawHero() {
    const c = $('hero');
    const r = c.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const k = Math.min(3, window.devicePixelRatio || 1);
    c.width = Math.round(r.width * k); c.height = Math.round(r.height * k);
    heroTeam = S.country ? myTeam(Math.min(S.unlocked, LEVELS.length - 1)) : { name: 'Halcones', colors: ['#B3202A', '#F5F0E6'] };
    paintHero(performance.now());
  }
  function paintHero(now) {
    const c = $('hero');
    if (!c.width || !heroTeam) return;
    const r = c.getBoundingClientRect();
    const k = c.width / r.width;
    const g = c.getContext('2d');
    // La cancha cubre todo el recuadro; se recorta por los lados o por abajo
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#D9A866';
    g.fillRect(0, 0, c.width, c.height);
    const s = Math.max(r.width / 240, r.height / H);
    const ty = Math.max(r.height - H * s, Math.min(0, r.height / 2 - 215 * s));
    g.setTransform(k * s, 0, 0, k * s, k * (r.width - W * s) / 2, k * ty);
    paintCourt(g, W, H);
    drawHoop(g, 0);
    const rival = { name: 'Centellas', colors: ['#F2C230', '#22223B'] };
    const pts = [[95, 300], [255, 240], [175, 170]];
    arrowLine(g, { x: 95, y: 300 }, { x: 245, y: 245 }, '#FFFFFF');
    const chars = pts.map((p, i) => ({ x: p[0], y: p[1], pose: i === 0 ? 'dribble' : i === 2 ? 'catch' : 'idle', look: lookFor(heroTeam, i), ring: i === 0 ? '#FFC53D' : null }));
    chars.push({ x: 178, y: 255, pose: 'guard', look: lookFor(rival, 0), rival: true });
    chars.push({ x: 120, y: 205, pose: 'guard', look: lookFor(rival, 1), rival: true });
    chars.sort((a, b) => a.y - b.y).forEach((ch) => drawChar(g, ch, now));
    drawBall(g, 109, 299, 2 + Math.abs(Math.sin(now / 140)) * 13, .9);
  }
  (function heroLoop(now) {
    requestAnimationFrame(heroLoop);
    if (current === 'home' && $('modal').hidden) paintHero(now);
  })(performance.now());

  // ---------------------------------------------------------------- Botones
  $('btn-play').onclick = () => startLevel(Math.min(S.unlocked, LEVELS.length - 1));
  $('btn-levels').onclick = () => show('levels');
  $('btn-team').onclick = teamModal;
  $('btn-premium-top').onclick = premiumModal;
  $('btn-levels-back').onclick = () => show('home');
  $('btn-game-back').onclick = () => { closeModal(); show('levels'); };
  $('btn-reset').onclick = askRestart;
  $('btn-hint').onclick = useHint;

  // ---------------------------------------------------------------- Arranque
  requestAnimationFrame(render);
  const boot = () => {
    show('home');
    if (!S.country) chooseCountry(true, renderHome);
  };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(boot, boot); else boot();
})();
