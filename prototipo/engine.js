// Motor de simulación de "Jugada Maestra".
// No dibuja nada: calcula qué pasa con cada movimiento (pase, conducción o tiro).
// El juego es por turnos: el reloj solo avanza mientras se ejecuta un movimiento.
// Lo usan el juego y la herramienta que verifica los niveles.
(function (root) {
  'use strict';

  const COURT = { w: 360, h: 600 };
  const HOOP = { x: 180, y: 70 };
  const BALL_R = 7;           // radio de la pelota
  const REACH = 22;           // alcance de un defensor para robar (un defensor puede traer su propio `reach`)
  const BLOCK_R = 40;         // un defensor a esta distancia del tirador tapa el tiro (o su propio `block`)
  const PRESSURE_R = 70;      // a esta distancia (escalada por `block`) el defensor achica la ventana del tiro
  const SPEED = 330;          // velocidad del pase (px/s)
  const DRIBBLE_SPEED = 150;  // velocidad al conducir (px/s)
  const DRIBBLE_MAX = 90;     // distancia máxima de una conducción
  const DRIBBLE_MIN = 18;     // menos que esto no cuenta como conducción
  const BODY_R = 12;          // radio del cuerpo para los bordes de la cancha
  const SHOT_TIME = 0.8;      // duración del tiro (s)
  const DEFAULT_RANGE = 210;  // distancia máxima de tiro (línea de triple)
  const MAX_DEPTH = 5;        // movimientos que prueba el buscador de soluciones
  const AIM_TOL_FAR = 5;      // margen lateral de puntería (unidades) en el peor caso: tiro al límite del alcance, sin entrenar

  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

  function pointSegDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return dist(px, py, ax + t * dx, ay + t * dy);
  }

  // Posición de un defensor en el instante t. Recorre su ruta ida y vuelta.
  function defenderPos(d, t) {
    if (!d.path || !d.path.length || !d.speed) return { x: d.x, y: d.y };
    const pts = [[d.x, d.y]].concat(d.path);
    const segs = [];
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const l = dist(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      segs.push(l);
      total += l;
    }
    if (!total) return { x: d.x, y: d.y };
    let s = (t * d.speed) % (2 * total);
    if (s > total) s = 2 * total - s;
    for (let i = 0; i < segs.length; i++) {
      if (s <= segs[i] || i === segs.length - 1) {
        const f = segs[i] ? Math.min(1, s / segs[i]) : 0;
        return {
          x: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f,
          y: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f,
        };
      }
      s -= segs[i];
    }
    return { x: d.x, y: d.y };
  }

  // Alcances de un defensor. Un defensor alto (pívot: `tall: true` en el nivel) suele traer
  // `reach` y `block` mayores: roba pases que pasan más lejos y tapa tiros desde más distancia.
  // Los defensores sin esos campos usan los valores base.
  const defReach = (d) => (d.reach != null ? d.reach : REACH);
  const defBlock = (d) => (d.block != null ? d.block : BLOCK_R);

  // ---------------------------------------------------------------- Estado de una partida
  // El nivel puede indicar quién empieza con la pelota (holder); si no, el jugador 0.
  function initState(level) {
    return { t: 0, holder: level.holder || 0, moves: 0, pos: level.players.map((p) => [p[0], p[1]]) };
  }
  function cloneState(st) {
    return { t: st.t, holder: st.holder, moves: st.moves, pos: st.pos.map((p) => [p[0], p[1]]) };
  }

  // Habilidades del jugador estrella (si el nivel las trae); el resto usa los valores base.
  const isStar = (level, i) => level.starIdx != null && level.starIdx === i;
  function rangeFor(level, i) { return (isStar(level, i) && level.starRange) || level.range || DEFAULT_RANGE; }
  function dribbleMaxFor(level, i) { return (isStar(level, i) && level.starDribble) || DRIBBLE_MAX; }
  function passSpeedFor(level, i) { return (isStar(level, i) && level.starPass) || SPEED; }

  // Punto final real de una conducción: como máximo la distancia de conducción del jugador y
  // dentro de la cancha (sin acercarse a la línea de fondo del aro).
  function dribbleTarget(level, st, x, y) {
    const a = st.pos[st.holder];
    const max = dribbleMaxFor(level, st.holder);
    let dx = x - a[0], dy = y - a[1];
    const len = Math.hypot(dx, dy);
    if (len > max) { dx *= max / len; dy *= max / len; }
    const bx = Math.max(BODY_R + 6, Math.min(COURT.w - BODY_R - 6, a[0] + dx));
    const by = Math.max(130, Math.min(COURT.h - BODY_R - 6, a[1] + dy));
    return { x: bx, y: by, len: dist(a[0], a[1], bx, by) };
  }

  // Ventana de fuerza del tiro desde la situación actual: punto ideal (0–100), margen a cada
  // lado y velocidad de la barra. Más lejos → más fuerza, menos margen y barra más rápida;
  // un defensor cerca achica el margen (un pívot presiona desde más lejos, en proporción a su
  // `block`); entrenar Tiro (solo tu jugador) lo agranda y frena la barra.
  // opts.aimTolMin (opcional, unidades): piso del margen lateral de puntería. Lo calcula la
  // interfaz según lo que se ve en pantalla (con la cámara lejos, pocas unidades son muy pocos
  // píxeles); el margen final es el mayor entre el propio del tiro (aimTolBase) y ese piso.
  function shotWindow(level, st, opts) {
    const a = st.pos[st.holder];
    const d = dist(a[0], a[1], HOOP.x, HOOP.y);
    const range = rangeFor(level, st.holder);
    const far = Math.min(1, d / range);
    // Distancia al defensor más molesto, normalizada a la escala de un defensor común
    let near = Infinity;
    for (const df of level.defenders || []) {
      const p = defenderPos(df, st.t);
      near = Math.min(near, dist(p.x, p.y, a[0], a[1]) * BLOCK_R / defBlock(df));
    }
    const skill = isStar(level, st.holder) ? (level.starShot || 0) : 0;
    const pressure = near < PRESSURE_R;
    let half = 11 - 5 * far + 2.5 * skill;
    if (pressure) half -= 3 * (1 - near / PRESSURE_R);
    // margen lateral (unidades) para que la línea pase por el aro: la distancia lo achica y
    // entrenar Tiro lo agranda
    const aimTolBase = Math.max(3, 9 - 4 * far + 2 * skill);
    const aimTolMin = (opts && opts.aimTolMin) || 0;
    return {
      ideal: 38 + 50 * far,
      half: Math.max(4, half),
      speed: 70 + 40 * far - 8 * skill,
      aimTol: Math.max(aimTolBase, aimTolMin),
      aimTolBase,
      distance: d,
      pressure,
    };
  }

  // Error lateral de puntería (unidades): distancia del centro del aro a la recta que sale del
  // tirador `a` y pasa por el punto apuntado `aim`. Devuelve también el punto de esa recta más
  // cercano al aro (por dónde "pasa" el tiro). Una línea de menos de 20 unidades no se juzga.
  function aimError(a, aim) {
    const vx = aim.x - a.x, vy = aim.y - a.y;
    const len = Math.hypot(vx, vy);
    if (len <= 20) return { err: 0, x: HOOP.x, y: HOOP.y, len };
    const t = ((HOOP.x - a.x) * vx + (HOOP.y - a.y) * vy) / (len * len);
    const qx = a.x + vx * t, qy = a.y + vy * t;
    return { err: dist(qx, qy, HOOP.x, HOOP.y), x: qx, y: qy, len };
  }

  // ¿Algún defensor alcanza la pelota mientras viaja de a a b entre t0 y t0+dur?
  // Cada defensor roba dentro de su `reach` (más el radio de la pelota).
  function checkSteal(level, a, b, t0, dur) {
    const defs = level.defenders || [];
    const dt = 1 / 240;
    for (let tt = 0; tt <= dur + 1e-9; tt += dt) {
      const f = dur ? Math.min(1, tt / dur) : 1;
      const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f;
      for (const d of defs) {
        const p = defenderPos(d, t0 + tt);
        if (dist(p.x, p.y, x, y) < defReach(d) + BALL_R) return { tt, pos: { x, y }, who: d };
      }
    }
    return null;
  }

  // Ejecuta un movimiento. move = {type:'pass', to} | {type:'dribble', x, y} |
  // {type:'shot', aim?, power?, aimTolMin?} (aimTolMin: piso del margen de puntería, ver shotWindow)
  // Devuelve el tramo animable, el resultado y el estado siguiente.
  function step(level, st, move) {
    const range = rangeFor(level, st.holder);
    const defs = level.defenders || [];
    const ap = st.pos[st.holder];
    const a = { x: ap[0], y: ap[1] };
    const t0 = st.t;
    const next = cloneState(st);

    if (move.type === 'shot') {
      for (const d of defs) {
        const p = defenderPos(d, t0);
        if (dist(p.x, p.y, a.x, a.y) < defBlock(d)) {
          return { ok: false, reason: 'tapon', leg: { type: 'shot', from: a, to: a, t0, t1: t0 + 0.4, blocked: true }, failPos: a };
        }
      }
      const d = dist(a.x, a.y, HOOP.x, HOOP.y);
      if (d > range) {
        const f = Math.max(0.55, (range / d) * 0.9);
        const to = { x: a.x + (HOOP.x - a.x) * f, y: a.y + (HOOP.y - a.y) * f };
        return { ok: false, reason: 'lejos', leg: { type: 'shot', from: a, to, t0, t1: t0 + SHOT_TIME, miss: true }, failPos: to };
      }
      // Puntería: si el movimiento trae aim (punto hacia donde se trazó la línea), la línea
      // que sale del tirador tiene que pasar cerca del centro del aro.
      // Sin aim ni power (buscador de soluciones, ayuda) el tiro se considera perfecto.
      const win = shotWindow(level, st, { aimTolMin: move.aimTolMin });
      if (move.aim) {
        const e = aimError(a, move.aim);
        if (e.err > win.aimTol) {
          const vx = move.aim.x - a.x, vy = move.aim.y - a.y;
          const to = { x: a.x + (vx / e.len) * d, y: a.y + (vy / e.len) * d };
          return { ok: false, reason: 'desviado', leg: { type: 'shot', from: a, to, t0, t1: t0 + SHOT_TIME, miss: true }, failPos: to, aimError: e.err, window: win };
        }
      }
      if (move.power != null) {
        if (move.power < win.ideal - win.half) {
          const f = 0.82;
          const to = { x: a.x + (HOOP.x - a.x) * f, y: a.y + (HOOP.y - a.y) * f };
          return { ok: false, reason: 'corto', leg: { type: 'shot', from: a, to, t0, t1: t0 + SHOT_TIME, miss: true }, failPos: to, power: move.power, window: win };
        }
        if (move.power > win.ideal + win.half) {
          const to = { x: HOOP.x, y: HOOP.y - 16 };
          return { ok: false, reason: 'largo', leg: { type: 'shot', from: a, to, t0, t1: t0 + SHOT_TIME, miss: true, board: true }, failPos: to, power: move.power, window: win };
        }
      }
      next.t = t0 + SHOT_TIME;
      return { ok: true, scored: true, leg: { type: 'shot', from: a, to: { x: HOOP.x, y: HOOP.y }, t0, t1: t0 + SHOT_TIME }, state: next };
    }

    if (move.type === 'pass') {
      const bp = st.pos[move.to];
      const b = { x: bp[0], y: bp[1] };
      const dur = dist(a.x, a.y, b.x, b.y) / passSpeedFor(level, st.holder);
      const steal = checkSteal(level, a, b, t0, dur);
      if (steal) {
        return { ok: false, reason: 'intercepcion', leg: { type: 'pass', from: a, to: steal.pos, t0, t1: t0 + steal.tt, who: st.holder }, failPos: steal.pos };
      }
      next.t = t0 + dur;
      next.holder = move.to;
      next.moves++;
      return { ok: true, leg: { type: 'pass', from: a, to: b, t0, t1: t0 + dur, who: st.holder, target: move.to }, state: next };
    }

    // Conducción
    const tgt = dribbleTarget(level, st, move.x, move.y);
    const b = { x: tgt.x, y: tgt.y };
    const dur = tgt.len / DRIBBLE_SPEED;
    const steal = checkSteal(level, a, b, t0, dur);
    if (steal) {
      return { ok: false, reason: 'robo', leg: { type: 'dribble', from: a, to: steal.pos, t0, t1: t0 + steal.tt, who: st.holder }, failPos: steal.pos };
    }
    next.t = t0 + dur;
    next.pos[st.holder] = [b.x, b.y];
    next.moves++;
    return { ok: true, leg: { type: 'dribble', from: a, to: b, t0, t1: t0 + dur, who: st.holder }, state: next };
  }

  // Simula una secuencia de pases terminada en tiro: [0, 2, 1, 'H'].
  function simulate(level, chain, st) {
    let s = st ? cloneState(st) : initState(level);
    for (let i = 1; i < chain.length; i++) {
      const r = step(level, s, chain[i] === 'H' ? { type: 'shot' } : { type: 'pass', to: chain[i] });
      if (!r.ok) return { ok: false, reason: r.reason, moves: s.moves };
      if (r.scored) return { ok: true, moves: s.moves, time: r.state.t };
      s = r.state;
    }
    return { ok: false, reason: 'incompleta', moves: s.moves };
  }

  // Busca jugadas de pases que terminen en canasta desde un estado (por defecto, el inicio).
  // Devuelve la mejor (menos movimientos, luego menos tiempo) y estadísticas.
  function solve(level, st) {
    const start = st ? cloneState(st) : initState(level);
    const n = level.players.length;
    const wins = [];
    let total = 0;
    function rec(s, chain, depth) {
      total++;
      const shot = step(level, s, { type: 'shot' });
      if (shot.ok) wins.push({ chain: chain.concat('H'), moves: s.moves - start.moves, time: shot.state.t });
      if (depth >= MAX_DEPTH) return;
      for (let j = 0; j < n; j++) {
        if (j === s.holder) continue;
        const r = step(level, s, { type: 'pass', to: j });
        total++;
        if (r.ok) rec(r.state, chain.concat(j), depth + 1);
      }
    }
    rec(start, [start.holder], 0);
    wins.sort((a, b) => a.moves - b.moves || a.time - b.time);
    return { best: wins[0] || null, wins: wins.length, total, minMoves: wins[0] ? wins[0].moves : null };
  }

  // Estrellas: 3 con la cantidad mínima de movimientos, 2 con uno de más, 1 si no.
  function stars(moves, minMoves) {
    if (moves <= minMoves) return 3;
    if (moves === minMoves + 1) return 2;
    return 1;
  }

  const api = {
    COURT, HOOP, BALL_R, REACH, BLOCK_R, PRESSURE_R, SPEED, DRIBBLE_SPEED, DRIBBLE_MAX, DRIBBLE_MIN, BODY_R,
    SHOT_TIME, DEFAULT_RANGE, AIM_TOL_FAR,
    dist, pointSegDist, defenderPos, defReach, defBlock, rangeFor, dribbleMaxFor, passSpeedFor,
    initState, cloneState, dribbleTarget, shotWindow, aimError, step, simulate, solve, stars,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
