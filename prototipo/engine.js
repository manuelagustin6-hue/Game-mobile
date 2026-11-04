// Motor de simulación de "Jugada Maestra".
// No dibuja nada: calcula qué pasa con cada movimiento (pase, conducción o tiro).
// El juego es por turnos: el reloj solo avanza mientras se ejecuta un movimiento.
// Lo usan el juego y la herramienta que verifica los niveles.
(function (root) {
  'use strict';

  const COURT = { w: 360, h: 600 };
  const HOOP = { x: 180, y: 70 };
  const BALL_R = 7;           // radio de la pelota
  const REACH = 22;           // alcance de un defensor para robar
  const BLOCK_R = 40;         // un defensor a esta distancia del tirador tapa el tiro
  const SPEED = 330;          // velocidad del pase (px/s)
  const DRIBBLE_SPEED = 150;  // velocidad al conducir (px/s)
  const DRIBBLE_MAX = 90;     // distancia máxima de una conducción
  const DRIBBLE_MIN = 18;     // menos que esto no cuenta como conducción
  const BODY_R = 12;          // radio del cuerpo para obstáculos y bordes
  const SHOT_TIME = 0.8;      // duración del tiro (s)
  const DEFAULT_RANGE = 210;  // distancia máxima de tiro (línea de triple)
  const WALL_T = 12;          // grosor de los obstáculos
  const MAX_DEPTH = 5;        // movimientos que prueba el buscador de soluciones

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

  // Primer punto (fracción 0..1) del trayecto a-b que choca con un obstáculo, o null.
  function wallHit(level, ax, ay, bx, by, radius) {
    const walls = level.walls || [];
    if (!walls.length) return null;
    const r = radius == null ? BALL_R : radius;
    const steps = Math.max(8, Math.ceil(dist(ax, ay, bx, by) / 3));
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const x = ax + (bx - ax) * f, y = ay + (by - ay) * f;
      for (const w of walls) {
        if (pointSegDist(x, y, w[0], w[1], w[2], w[3]) < WALL_T / 2 + r) return f;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- Estado de una partida
  function initState(level) {
    return { t: 0, holder: 0, moves: 0, pos: level.players.map((p) => [p[0], p[1]]) };
  }
  function cloneState(st) {
    return { t: st.t, holder: st.holder, moves: st.moves, pos: st.pos.map((p) => [p[0], p[1]]) };
  }

  // Punto final real de una conducción: como máximo DRIBBLE_MAX, dentro de la cancha
  // y antes de cualquier obstáculo.
  function dribbleTarget(level, st, x, y) {
    const a = st.pos[st.holder];
    let dx = x - a[0], dy = y - a[1];
    const len = Math.hypot(dx, dy);
    if (len > DRIBBLE_MAX) { dx *= DRIBBLE_MAX / len; dy *= DRIBBLE_MAX / len; }
    let bx = Math.max(BODY_R + 6, Math.min(COURT.w - BODY_R - 6, a[0] + dx));
    let by = Math.max(130, Math.min(COURT.h - BODY_R - 6, a[1] + dy));
    const hit = wallHit(level, a[0], a[1], bx, by, BODY_R);
    if (hit !== null) {
      const f = Math.max(0, hit - 0.04);
      bx = a[0] + (bx - a[0]) * f;
      by = a[1] + (by - a[1]) * f;
    }
    return { x: bx, y: by, len: dist(a[0], a[1], bx, by) };
  }

  // ¿Algún defensor alcanza la pelota mientras viaja de a a b entre t0 y t0+dur?
  function checkSteal(level, a, b, t0, dur, reach) {
    const defs = level.defenders || [];
    const dt = 1 / 240;
    for (let tt = 0; tt <= dur + 1e-9; tt += dt) {
      const f = dur ? Math.min(1, tt / dur) : 1;
      const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f;
      for (const d of defs) {
        const p = defenderPos(d, t0 + tt);
        if (dist(p.x, p.y, x, y) < reach) return { tt, pos: { x, y } };
      }
    }
    return null;
  }

  // Ejecuta un movimiento. move = {type:'pass', to} | {type:'dribble', x, y} | {type:'shot'}
  // Devuelve el tramo animable, el resultado y el estado siguiente.
  function step(level, st, move) {
    const range = level.range || DEFAULT_RANGE;
    const defs = level.defenders || [];
    const ap = st.pos[st.holder];
    const a = { x: ap[0], y: ap[1] };
    const t0 = st.t;
    const next = cloneState(st);

    if (move.type === 'shot') {
      for (const d of defs) {
        const p = defenderPos(d, t0);
        if (dist(p.x, p.y, a.x, a.y) < BLOCK_R) {
          return { ok: false, reason: 'tapon', leg: { type: 'shot', from: a, to: a, t0, t1: t0 + 0.4, blocked: true }, failPos: a };
        }
      }
      const d = dist(a.x, a.y, HOOP.x, HOOP.y);
      if (d > range) {
        const f = Math.max(0.55, (range / d) * 0.9);
        const to = { x: a.x + (HOOP.x - a.x) * f, y: a.y + (HOOP.y - a.y) * f };
        return { ok: false, reason: 'lejos', leg: { type: 'shot', from: a, to, t0, t1: t0 + SHOT_TIME, miss: true }, failPos: to };
      }
      next.t = t0 + SHOT_TIME;
      return { ok: true, scored: true, leg: { type: 'shot', from: a, to: { x: HOOP.x, y: HOOP.y }, t0, t1: t0 + SHOT_TIME }, state: next };
    }

    if (move.type === 'pass') {
      const bp = st.pos[move.to];
      const b = { x: bp[0], y: bp[1] };
      const dur = dist(a.x, a.y, b.x, b.y) / SPEED;
      const hit = wallHit(level, a.x, a.y, b.x, b.y);
      const limit = hit === null ? 1 : hit;
      const lb = { x: a.x + (b.x - a.x) * limit, y: a.y + (b.y - a.y) * limit };
      const steal = checkSteal(level, a, lb, t0, dur * limit, REACH + BALL_R);
      if (steal) {
        return { ok: false, reason: 'intercepcion', leg: { type: 'pass', from: a, to: steal.pos, t0, t1: t0 + steal.tt, who: st.holder }, failPos: steal.pos };
      }
      if (hit !== null) {
        return { ok: false, reason: 'obstaculo', leg: { type: 'pass', from: a, to: lb, t0, t1: t0 + dur * hit, who: st.holder }, failPos: lb };
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
    const steal = checkSteal(level, a, b, t0, dur, REACH + BALL_R);
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
    COURT, HOOP, BALL_R, REACH, BLOCK_R, SPEED, DRIBBLE_SPEED, DRIBBLE_MAX, DRIBBLE_MIN, BODY_R,
    SHOT_TIME, DEFAULT_RANGE, WALL_T,
    dist, pointSegDist, defenderPos, wallHit,
    initState, cloneState, dribbleTarget, step, simulate, solve, stars,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
