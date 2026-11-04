// Motor de simulación de "Jugada Maestra".
// No dibuja nada: calcula qué pasa con una jugada (pases + tiro) en un nivel.
// Lo usan el juego y la herramienta que verifica los niveles.
(function (root) {
  'use strict';

  const COURT = { w: 360, h: 600 };
  const HOOP = { x: 180, y: 70 };
  const BALL_R = 7;          // radio de la pelota
  const REACH = 22;          // alcance de un defensor para interceptar
  const BLOCK_R = 40;        // un defensor a esta distancia del tirador tapa el tiro
  const SPEED = 330;         // velocidad del pase (px/s)
  const CATCH = 0.18;        // pausa al recibir (s)
  const SHOT_TIME = 0.75;    // duración del tiro (s)
  const DEFAULT_RANGE = 210; // distancia máxima de tiro
  const WALL_T = 12;         // grosor de los obstáculos
  const SNAP = 28;           // radio para enganchar a un compañero al trazar

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

  // Primer punto (fracción 0..1) del pase a-b que choca con un obstáculo, o null.
  function wallHit(level, ax, ay, bx, by) {
    const walls = level.walls || [];
    const steps = Math.max(8, Math.ceil(dist(ax, ay, bx, by) / 3));
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const x = ax + (bx - ax) * f, y = ay + (by - ay) * f;
      for (const w of walls) {
        if (pointSegDist(x, y, w[0], w[1], w[2], w[3]) < WALL_T / 2 + BALL_R) return f;
      }
    }
    return null;
  }

  function nodePos(level, node) {
    if (node === 'H') return HOOP;
    const p = level.players[node];
    return { x: p[0], y: p[1] };
  }

  // Simula una jugada. chain = [0, 2, 1, 'H'] (índices de jugadores y al final el aro).
  // Devuelve los tramos con sus tiempos y el resultado.
  function simulate(level, chain) {
    const range = level.range || DEFAULT_RANGE;
    const defs = level.defenders || [];
    const legs = [];
    let t = 0;
    const dt = 1 / 240;

    for (let i = 0; i < chain.length - 1; i++) {
      const a = nodePos(level, chain[i]);
      const b = nodePos(level, chain[i + 1]);
      if (i > 0) t += CATCH;

      if (chain[i + 1] === 'H') {
        // Tiro al aro
        const t0 = t;
        for (const d of defs) {
          const p = defenderPos(d, t0);
          if (dist(p.x, p.y, a.x, a.y) < BLOCK_R) {
            legs.push({ type: 'shot', from: a, to: a, t0, t1: t0 + 0.35 });
            return { ok: false, reason: 'tapon', legs, end: t0 + 0.35, failPos: a, passes: i };
          }
        }
        const d = dist(a.x, a.y, b.x, b.y);
        if (d > range) {
          // Se queda corto
          const f = Math.max(0.55, range / d * 0.9);
          const to = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
          legs.push({ type: 'shot', from: a, to, t0, t1: t0 + SHOT_TIME, miss: true });
          return { ok: false, reason: 'lejos', legs, end: t0 + SHOT_TIME, failPos: to, passes: i };
        }
        legs.push({ type: 'shot', from: a, to: b, t0, t1: t0 + SHOT_TIME });
        return { ok: true, legs, end: t0 + SHOT_TIME, passes: i };
      }

      // Pase
      const len = dist(a.x, a.y, b.x, b.y);
      const dur = len / SPEED;
      const hit = wallHit(level, a.x, a.y, b.x, b.y);
      const t0 = t;
      const limit = hit === null ? 1 : hit;
      for (let tt = 0; tt <= dur * limit; tt += dt) {
        const f = tt / dur;
        const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f;
        for (const d of defs) {
          const p = defenderPos(d, t0 + tt);
          if (dist(p.x, p.y, x, y) < REACH + BALL_R) {
            const pos = { x, y };
            legs.push({ type: 'pass', from: a, to: pos, t0, t1: t0 + tt });
            return { ok: false, reason: 'intercepcion', legs, end: t0 + tt, failPos: pos, passes: i + 1 };
          }
        }
      }
      if (hit !== null) {
        const pos = { x: a.x + (b.x - a.x) * hit, y: a.y + (b.y - a.y) * hit };
        legs.push({ type: 'pass', from: a, to: pos, t0, t1: t0 + dur * hit });
        return { ok: false, reason: 'obstaculo', legs, end: t0 + dur * hit, failPos: pos, passes: i + 1 };
      }
      legs.push({ type: 'pass', from: a, to: b, t0, t1: t0 + dur });
      t = t0 + dur;
    }
    return { ok: false, reason: 'incompleta', legs, end: t, passes: chain.length - 1 };
  }

  // Busca todas las jugadas que funcionan. Devuelve la mejor (menos pases) y estadísticas.
  function solve(level) {
    const n = level.players.length;
    const wins = [];
    let total = 0;
    function rec(chain, used) {
      const c = chain.concat('H');
      total++;
      const r = simulate(level, c);
      if (r.ok) wins.push({ chain: c, passes: r.passes, time: r.end });
      for (let i = 1; i < n; i++) {
        if (!used[i]) {
          used[i] = true;
          rec(chain.concat(i), used);
          used[i] = false;
        }
      }
    }
    const used = new Array(n).fill(false);
    used[0] = true;
    rec([0], used);
    wins.sort((a, b) => a.passes - b.passes || a.time - b.time);
    return { best: wins[0] || null, wins: wins.length, total, minPasses: wins[0] ? wins[0].passes : null };
  }

  // Estrellas: 3 con la cantidad mínima de pases, 2 con un pase de más, 1 si no.
  function stars(passes, minPasses) {
    if (passes <= minPasses) return 3;
    if (passes === minPasses + 1) return 2;
    return 1;
  }

  const api = {
    COURT, HOOP, BALL_R, REACH, BLOCK_R, SPEED, CATCH, SHOT_TIME, DEFAULT_RANGE, WALL_T, SNAP,
    dist, pointSegDist, defenderPos, wallHit, simulate, solve, stars,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
