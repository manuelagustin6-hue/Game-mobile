/* players3d.js — Jugadores 3D procedimentales para "Jugada Maestra" (Contrato B). Versión final.
 * Dirección de arte "deportista realista estilizado": proporciones de ~7,3 cabezas, hombros anchos,
 * muslos potentes, piel mate con poros, camiseta de tela con número grande, zapatillas con brillo.
 *
 * Construcción: cada jugador es UN SkinnedMesh (una sola llamada de dibujo) con un esqueleto de
 * THREE.Bone (cadera → columna → pecho → cuello → cabeza; pecho → hombro → codo → muñeca;
 * cadera → muslo → rodilla → tobillo). Toda la ropa, la piel, la cara y el número viven en un atlas
 * de textura de canvas (1024 × 1024) por aspecto (con caché), más un mapa de rugosidad.
 * Codos y rodillas rígidos con una esfera al ras (giro tipo codo de caño, sin estrangular); pesos
 * mezclados en cuello, contorno del hombro y costados del short. El cuerpo se pensó para verse de
 * espaldas y desde arriba (cámara del juego): hombros y dorsales en V, omóplatos, short recto.
 *
 * Animación: poses escritas por intención como OBJETIVOS (muñecas y tobillos en el espacio del
 * jugador) resueltos con cinemática inversa de dos huesos; los pies quedan siempre horizontales y
 * apoyados (la cadera baja sola si una pierna no llega). Las poses se mezclan por canales (~150 ms).
 * Sin Math.random: todo lo "aleatorio" sale de hash(look.name + look.num) o de look.phase.
 *
 * Estrella: p.update(now, { camera, viewportHeight, starMinPx = 16, starMaxPx = 34 }) ajusta su escala
 * para que en pantalla mida entre starMinPx y starMaxPx (píxeles CSS de alto). p.update(now) a secas
 * sigue funcionando: la estrella conserva la última escala calculada (1 si nunca se pasó la cámara).
 */
(function () {
  'use strict';
  const T = window.THREE;
  if (!T) throw new Error('players3d.js necesita THREE como global');

  // ------------------------------------------------------------------ Listas públicas
  const SKINS = ['#F2D0B5', '#E1B48F', '#C99068', '#A86F48', '#7D4F31', '#5A3520'];
  const HAIRS = ['#14100D', '#2B1C13', '#4E3220', '#7A4E2B', '#B48450', '#D8C08A'];
  const STYLES = ['corto', 'rapado', 'rulos', 'trenzas', 'mono', 'pelado'];
  const STYLE_NAMES = { corto: 'Corto', rapado: 'Rapado', rulos: 'Rulos', trenzas: 'Trenzas', mono: 'Moño', pelado: 'Pelado' };
  const BODIES = ['delgado', 'atletico', 'fornido'];
  const BODY_NAMES = { delgado: 'Delgado', atletico: 'Atlético', fornido: 'Fornido' };
  const ACCESSORIES = ['ninguno', 'vincha', 'manga', 'munequeras', 'rodillera'];
  const ACCESSORY_NAMES = { ninguno: 'Ninguno', vincha: 'Vincha', manga: 'Manga', munequeras: 'Muñequeras', rodillera: 'Rodillera' };
  const POSES = ['idle', 'run', 'guard', 'dribble', 'pass', 'catch', 'shoot', 'celebrate', 'steal', 'sad'];
  const HEIGHT = 47;      // unidades de mundo con h = 1 (1,95 m)
  const TRANSITION = 150; // ms entre poses
  const DEG = Math.PI / 180;

  // ------------------------------------------------------------------ Utilidades
  function hash(str) {
    let h = 2166136261;
    str = String(str);
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  // Generador determinista [0,1) a partir de una semilla entera
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function smooth(k) { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); }
  function hexToRgb(hex) {
    const n = parseInt(String(hex).replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  }
  // Aclara (k > 0) u oscurece (k < 0) un color
  function shade(hex, k) {
    const [r, g, b] = hexToRgb(hex);
    return k >= 0 ? rgbToHex(r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k) : rgbToHex(r * (1 + k), g * (1 + k), b * (1 + k));
  }
  function mix(a, b, k) {
    const A = hexToRgb(a), B = hexToRgb(b);
    return rgbToHex(lerp(A[0], B[0], k), lerp(A[1], B[1], k), lerp(A[2], B[2], k));
  }
  function rgba(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
  function luminance(hex) { const [r, g, b] = hexToRgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }

  function defaults(look) {
    look = look || {};
    const name = look.name || 'Jugador';
    const num = look.num == null ? 10 : look.num;
    const seed = hash(name + num);
    return {
      colors: (look.colors && look.colors.length >= 2) ? look.colors : ['#B3202A', '#F5F0E6'],
      skin: look.skin || SKINS[2],
      hair: look.hair || HAIRS[0],
      style: STYLES.includes(look.style) ? look.style : 'corto',
      beard: !!look.beard,
      body: BODIES.includes(look.body) ? look.body : 'atletico',
      accessory: ACCESSORIES.includes(look.accessory) ? look.accessory : 'ninguno',
      h: clamp(look.h == null ? 1 : look.h, 0.9, 1.1),
      num, name,
      phase: look.phase == null ? (seed % 1000) / 137 : look.phase,
      star: !!look.star,
      seed,
    };
  }

  // ------------------------------------------------------------------ Geometría: tubo por anillos
  // rings: [{ y, rx, rz, cx, cz, f, dy }] recorridos en orden. f(a) multiplica el radio según el
  // ángulo (músculos, pómulos); dy(a) desplaza la altura según el ángulo (hombros caídos, clavículas).
  // uv: { u0, u1, v0, v1 } región del atlas; v se reparte por longitud de arco del perfil.
  // opts.arc = [a0, a1] genera solo ese sector (abierto), p. ej. la barba al frente de la cara.
  // opts.angles(t) (t de 0 a 1) reparte los ángulos de la vuelta completa (más densos al frente).
  // Devuelve BufferGeometry indexada y, en geo.userData.ringV, el v (0..1) de cada anillo.
  function tube(rings, opts) {
    opts = opts || {};
    const segs = opts.segs || 14;
    const uv = opts.uv || { u0: 0, u1: 1, v0: 0, v1: 1 };
    const arc = opts.arc || [-Math.PI, Math.PI];
    const n = rings.length;
    const L = [0];
    for (let i = 1; i < n; i++) {
      const a = rings[i - 1], b = rings[i];
      const ra = (a.rx + a.rz) / 2, rb = (b.rx + b.rz) / 2;
      L.push(L[i - 1] + Math.hypot(ra - rb, a.y - b.y) + 1e-6);
    }
    const total = L[n - 1];
    const desc = rings[n - 1].y < rings[0].y;
    const pos = [], nor = [], uvs = [], idx = [];
    const ringV = [];
    for (let i = 0; i < n; i++) {
      const r = rings[i];
      const v = desc ? 1 - L[i] / total : L[i] / total;
      ringV.push(v);
      const vv = lerp(uv.v0, uv.v1, v);
      for (let j = 0; j <= segs; j++) {
        const a = opts.angles ? opts.angles(j / segs) : arc[0] + (j / segs) * (arc[1] - arc[0]); // a = 0 → +z (frente)
        const f = r.f ? r.f(a) : 1;
        const x = (r.cx || 0) + r.rx * f * Math.sin(a), z = (r.cz || 0) + r.rz * f * Math.cos(a);
        pos.push(x, r.y + (r.dy ? r.dy(a) : 0), z);
        nor.push(0, 0, 0);
        uvs.push(lerp(uv.u0, uv.u1, (a + Math.PI) / (Math.PI * 2)), vv);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < segs; j++) {
        const a = i * (segs + 1) + j, b = a + segs + 1;
        if (desc) idx.push(a, b, a + 1, a + 1, b, b + 1); else idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const na = g.attributes.normal;
    if (!opts.arc) {
      // Cose las normales de la costura
      for (let i = 0; i < n; i++) {
        const a = i * (segs + 1), b = a + segs;
        const x = (na.getX(a) + na.getX(b)) / 2, y = (na.getY(a) + na.getY(b)) / 2, z = (na.getZ(a) + na.getZ(b)) / 2;
        na.setXYZ(a, x, y, z); na.setXYZ(b, x, y, z);
      }
    }
    // Normales suaves en los polos
    for (let i = 0; i < n; i++) {
      if (rings[i].rx < 0.05) {
        const nb = i === 0 ? rings[1] : rings[n - 2];
        const dir = Math.sign(rings[i].y - nb.y) || 1;
        for (let j = 0; j <= segs; j++) na.setXYZ(i * (segs + 1) + j, 0, dir, 0);
      }
    }
    g.userData.ringV = ringV;
    return g;
  }
  // Protuberancia gaussiana sobre el círculo de ángulos: centrada en a0, ancho w (rad), amplitud amp
  function bump(a, a0, w, amp) {
    let d = a - a0; d = Math.atan2(Math.sin(d), Math.cos(d));
    return amp * Math.exp(-(d * d) / (w * w));
  }
  // Suma de protuberancias simétricas (±a0) y centrales: lista de [a0, w, amp]
  function shapeOf(list) {
    return (a) => { let f = 1; for (const b of list) { f += bump(a, b[0], b[1], b[2]); if (b[0] !== 0 && Math.abs(Math.abs(b[0]) - Math.PI) > 1e-6) f += bump(a, -b[0], b[1], b[2]); } return f; };
  }
  // Igual que shapeOf pero sin espejar (músculos distintos por dentro y por fuera de una extremidad)
  function shapeA(list) {
    return (a) => { let f = 1; for (const b of list) f += bump(a, b[0], b[1], b[2]); return f; };
  }
  function cap(y, cz) { return { y, rx: 0.02, rz: 0.02, cz: cz || 0 }; }

  // Invierte en X (y el sentido de las caras) para hacer la pieza simétrica.
  function mirrorX(g) {
    const p = g.attributes.position, nrm = g.attributes.normal;
    for (let i = 0; i < p.count; i++) { p.setX(i, -p.getX(i)); nrm.setX(i, -nrm.getX(i)); }
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    return g;
  }
  // Deja todas las uv en un punto fijo del atlas (color plano de una muestra)
  function flatUV(g, u, v) {
    const a = g.attributes.uv;
    for (let i = 0; i < a.count; i++) a.setXY(i, u, v);
    return g;
  }
  function toIndexed(g) { if (g.index) return g; const n = g.attributes.position.count; const ix = new (n > 65535 ? Uint32Array : Uint16Array)(n); for (let i = 0; i < n; i++) ix[i] = i; g.setIndex(new T.BufferAttribute(ix, 1)); return g; }

  // Fusiona geometrías indexadas con position/normal/uv (+ skinIndex/skinWeight si los traen)
  function merge(list) {
    let nv = 0, ni = 0;
    for (const g of list) { toIndexed(g); nv += g.attributes.position.count; ni += g.index.count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uvs = new Float32Array(nv * 2);
    const si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4);
    const idx = new (nv > 65535 ? Uint32Array : Uint16Array)(ni);
    let ov = 0, oi = 0;
    for (const g of list) {
      const c = g.attributes.position.count;
      pos.set(g.attributes.position.array, ov * 3);
      if (g.attributes.normal) nor.set(g.attributes.normal.array, ov * 3);
      if (g.attributes.uv) uvs.set(g.attributes.uv.array, ov * 2);
      if (g.attributes.skinIndex) { si.set(g.attributes.skinIndex.array, ov * 4); sw.set(g.attributes.skinWeight.array, ov * 4); }
      const ia = g.index.array;
      for (let i = 0; i < ia.length; i++) idx[oi + i] = ia[i] + ov;
      ov += c; oi += ia.length;
    }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.BufferAttribute(pos, 3));
    out.setAttribute('normal', new T.BufferAttribute(nor, 3));
    out.setAttribute('uv', new T.BufferAttribute(uvs, 2));
    out.setAttribute('skinIndex', new T.BufferAttribute(si, 4));
    out.setAttribute('skinWeight', new T.BufferAttribute(sw, 4));
    out.setIndex(new T.BufferAttribute(idx, 1));
    return out;
  }

  // Asigna toda la geometría a un hueso (peso rígido)
  function bindTo(g, boneIndex) {
    const c = g.attributes.position.count;
    const si = new Uint16Array(c * 4), sw = new Float32Array(c * 4);
    for (let i = 0; i < c; i++) { si[i * 4] = boneIndex; sw[i * 4] = 1; }
    g.setAttribute('skinIndex', new T.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new T.BufferAttribute(sw, 4));
    return g;
  }
  // Peso mezclado: el hueso propio `own` y, para los vértices entre yA (peso 0) e yB (peso wMax),
  // una parte del hueso vecino `other`. Suaviza codos, rodillas y el cuello.
  function bindBlend(g, own, other, yA, yB, wMax) {
    const c = g.attributes.position.count, p = g.attributes.position;
    const si = new Uint16Array(c * 4), sw = new Float32Array(c * 4);
    for (let i = 0; i < c; i++) {
      const k = clamp((p.getY(i) - yA) / (yB - yA), 0, 1) * wMax;
      si[i * 4] = own; sw[i * 4] = 1 - k; si[i * 4 + 1] = other; sw[i * 4 + 1] = k;
    }
    g.setAttribute('skinIndex', new T.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new T.BufferAttribute(sw, 4));
    return g;
  }

  // Casquete de pelo sobre un elipsoide (centro c, radios R) limitado por una línea de pelo
  // hairline(a) → elevación máxima (0 = coronilla, π/2 = ecuador). bump(a, el, i, j) desplaza el radio.
  function hairCap(c, R, thick, hairline, bump, uvPoint, segsA, segsE) {
    segsA = segsA || 24; segsE = segsE || 10;
    const pos = [], nor = [], uvs = [], idx = [];
    for (let i = 0; i <= segsE; i++) {
      for (let j = 0; j <= segsA; j++) {
        const a = -Math.PI + (j / segsA) * Math.PI * 2;
        const elMax = hairline(a);
        const el = (i / segsE) * elMax;
        const d = new T.Vector3(Math.sin(el) * Math.sin(a), Math.cos(el), Math.sin(el) * Math.cos(a));
        // el borde del casquete se afina hacia la línea de pelo
        const edge = i === segsE ? 0.35 : i === segsE - 1 ? 0.8 : 1;
        const k = 1 + (thick + (bump ? bump(a, el, i, j) : 0)) * edge;
        const nx = d.x / (R.x * R.x), ny = d.y / (R.y * R.y), nz = d.z / (R.z * R.z);
        const nl = Math.hypot(nx, ny, nz);
        let px = c.x + d.x * R.x * k, py = c.y + d.y * R.y * k, pz = c.z + d.z * R.z * k;
        // Debajo del cráneo (nuca, patillas) la cara/mandíbula puede salir del elipsoide: se empuja
        // el pelo hacia afuera lo que sobresalga la piel, para que nunca quede tapado.
        if (py / HS < 3.75) {
          const hp = headPoint(py / HS, a, 0).multiplyScalar(HS);
          const dh = Math.hypot(hp.x - c.x, hp.z - c.z), db = Math.hypot(d.x * R.x, d.z * R.z);
          if (dh > db) { const hl = Math.hypot(px - c.x, pz - c.z) || 1; const kk2 = (hl + dh - db) / hl; px = c.x + (px - c.x) * kk2; pz = c.z + (pz - c.z) * kk2; }
        }
        pos.push(px, py, pz);
        nor.push(nx / nl, ny / nl, nz / nl);
        if (uvPoint.ringV) uvs.push((a + PI) / (2 * PI), lerp(uvPoint.v0, uvPoint.v1, yToV(HEAD_RINGS, uvPoint.ringV, c.y + d.y * R.y)));   // misma textura que el cuero cabelludo
        else if (uvPoint.u0 != null) uvs.push(lerp(uvPoint.u0, uvPoint.u1, j / segsA), lerp(uvPoint.v1, uvPoint.v0, i / segsE)); else uvs.push(uvPoint[0], uvPoint[1]);
      }
    }
    for (let i = 0; i < segsE; i++) for (let j = 0; j < segsA; j++) {
      const a = i * (segsA + 1) + j, b = a + segsA + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    if (bump) g.computeVertexNormals();
    return g;
  }

  // ------------------------------------------------------------------ Atlas (1024 × 1024)
  const ATLAS = 1024;
  const REG = {
    head: [0, 300], torso: [300, 560], pelvis: [560, 640], thigh: [640, 760], shin: [760, 840], shoe: [840, 888], sole: [888, 902], hair: [902, 932],
  };
  // Muestras (color plano): [x0, x1, y0, y1]
  const SW = {
    upperArm: [0, 340, 932, 962], forearm: [340, 680, 932, 962], hand: [680, 1024, 932, 962],
    hair: [0, 340, 962, 992], trim: [340, 680, 962, 992], jersey: [680, 1024, 962, 992],
    white: [0, 512, 992, 1024], dark: [512, 1024, 992, 1024],
  };
  function uvReg(r) { return { u0: 0, u1: 1, v0: 1 - r[1] / ATLAS, v1: 1 - r[0] / ATLAS }; }
  function swUV(s) { return [((s[0] + s[1]) / 2) / ATLAS, 1 - ((s[2] + s[3]) / 2) / ATLAS]; }
  function rowOf(r, v) { return r[1] - v * (r[1] - r[0]); }

  // ------------------------------------------------------------------ Medidas del cuerpo
  // Todo en unidades de mundo con h = 1. El personaje mira a +z; su derecha es −x.
  function measures(body) {
    const thin = body === 'delgado', big = body === 'fornido';
    const k = thin ? 0.84 : big ? 1.13 : 1;    // vientres musculares de brazos y piernas
    const kj = thin ? 0.9 : big ? 1.07 : 1;    // articulaciones (rodilla, codo, muñeca, tobillo): casi no cambian
    const kt = thin ? 0.88 : big ? 1.13 : 1;   // ancho de pecho y hombros
    const kw = thin ? 0.88 : big ? 1.08 : 1;   // cintura y cadera (el fornido es ancho arriba, no abajo)
    const kc = thin ? 0.92 : big ? 1.08 : 1;   // profundidad del pecho
    const mu = thin ? 0.55 : big ? 1.6 : 1;    // relieve muscular (deltoides, bíceps, dorsales, gemelos)
    const sh = big ? 0.8 : thin ? -0.45 : 0;   // hombros extra
    return {
      k, kj, kt, kw, kc, mu,
      hipY: 25.2, hipX: 3.5,
      spineY: 3.3, chestY: 6.0, neckY: 6.2, headY: 0.55,
      shoulder: { x: 4.7 * kt + sh, y: 3.5, z: 0.2 },
      upperArm: 9.0, forearm: 8.6, hand: 3.6,
      thigh: 11.3, shin: 11.0, ankle: 2.9,
    };
  }

  // ------------------------------------------------------------------ Cabeza esculpida
  // La cabeza es una malla densa de anillos horizontales (local del hueso 'head', en su base) cuyo
  // radio sale de una función de escultura: cráneo elipsoidal de adulto arriba, mandíbula en U con
  // ángulos marcados abajo, y rasgos sumados en unidades reales (arco superciliar, cuencas hundidas,
  // pómulos, nariz con puente, punta y aletas integrada en la cara, labios, mentón). Las medidas se
  // escriben con escala 1 y se multiplican por HS (cabeza de ~24 cm para un jugador de 1,95 m).
  const HS = 0.9; // escala de la cabeza
  const PI = Math.PI;
  // Alturas de referencia de la cara (sin escalar)
  const FY = { chin: 0.6, jaw: 1.0, lipLo: 1.42, mouth: 1.55, lipUp: 1.68, noseBase: 2.16, noseTip: 2.36, cheek: 2.95, eyes: 3.5, brow: 3.96, hairline: 5.42, top: 6.72 };
  // Cráneo: elipsoide (centro y radios sin escalar). El pelo y la vincha se apoyan en él.
  const SKULL_C = { y: 4.0, z: -0.25 }, SKULL_R = { x: 2.3, y: 2.72, z: 2.78 };
  const G = (v, s) => Math.exp(-(v * v) / (s * s));
  // Interpolación lineal en una tabla [[x, y], ...]
  function table(tb, x) {
    if (x <= tb[0][0]) return tb[0][1];
    for (let i = 1; i < tb.length; i++) if (x <= tb[i][0]) { const k = (x - tb[i - 1][0]) / (tb[i][0] - tb[i - 1][0]); return lerp(tb[i - 1][1], tb[i][1], k); }
    return tb[tb.length - 1][1];
  }
  // Catmull-Rom sobre una lista de llaves [{ y, ... }] para el campo `key`
  function crKeys(keys, y, key) {
    let i = 1; while (i < keys.length - 1 && y > keys[i].y) i++;
    const p1 = keys[i - 1], p2 = keys[i], p0 = keys[Math.max(0, i - 2)], p3 = keys[Math.min(keys.length - 1, i + 1)];
    const t = clamp((y - p1.y) / (p2.y - p1.y), 0, 1), t2 = t * t, t3 = t2 * t;
    const a = p0[key], b = p1[key], c = p2[key], d = p3[key];
    return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  }
  // Sección del cráneo a la altura y
  function skullAt(y) {
    const t = clamp((y - SKULL_C.y) / SKULL_R.y, -1, 1), s = Math.sqrt(Math.max(0, 1 - t * t));
    return { rx: SKULL_R.x * s, rz: SKULL_R.z * s, cz: SKULL_C.z };
  }
  // Llaves de la cara y la mandíbula (debajo de los ojos); arriba manda el cráneo.
  // jaw = refuerzo del ángulo de la mandíbula, back = recorte de la nuca (detrás entra el cuello)
  const FACE_KEYS = [
    { y: 0.12, rx: 0.35, rz: 0.45, cz: 1.35, jaw: 0, back: 0 },
    { y: 0.3, rx: 1.12, rz: 1.08, cz: 1.15, jaw: 0, back: 0 },
    { y: 0.6, rx: 1.55, rz: 1.64, cz: 0.82, jaw: 0.06, back: 0 },
    { y: 1.0, rx: 1.8, rz: 2.02, cz: 0.5, jaw: 0.12, back: 0.02 },
    { y: 1.55, rx: 1.9, rz: 2.32, cz: 0.18, jaw: 0.07, back: 0.04 },
    { y: 2.2, rx: 2.06, rz: 2.55, cz: -0.06, jaw: 0.02, back: 0.03 },
    { y: 2.85, rx: 2.18, rz: 2.66, cz: -0.2, jaw: 0, back: 0.01 },
    Object.assign({ y: 3.3, jaw: 0, back: 0 }, skullAt(3.3)),
    Object.assign({ y: 3.7, jaw: 0, back: 0 }, skullAt(3.7)),
  ];
  // Perfil de la nariz: saliente (unidades) y ancho (sigma del arco) según la altura
  const NOSE_P = [[1.86, 0], [2.0, 0.1], [2.1, 0.33], [2.22, 0.55], [2.36, 0.64], [2.5, 0.6], [2.75, 0.5], [3.05, 0.4], [3.35, 0.3], [3.6, 0.17], [3.8, 0.06], [4.0, 0]];
  const NOSE_W = [[2.0, 0.3], [2.2, 0.36], [2.42, 0.29], [2.8, 0.21], [3.3, 0.19], [3.7, 0.24]];
  // Variación de la cara por jugador (semilla): nariz, mandíbula, mentón, arco superciliar, labios,
  // pómulos. Se fija al construir cada jugador (buildBody) y vuelve a la neutra al terminar.
  const FV0 = { nose: 1, noseW: 1, jaw: 1, chin: 1, brow: 1, lips: 1, cheek: 1 };
  let FV = FV0;
  function faceVariation(seed) {
    const q = rng(seed ^ 0xface5);
    const v = (a, b) => lerp(a, b, q());
    return { nose: v(0.82, 1.15), noseW: v(0.88, 1.2), jaw: v(0.94, 1.07), chin: v(0.75, 1.3), brow: v(0.75, 1.25), lips: v(0.8, 1.3), cheek: v(0.8, 1.25) };
  }
  // Rasgos: desplazamiento radial (unidades sin escalar) en la altura y y el ángulo a (0 = frente)
  function faceDisp(y, a) {
    const aa = Math.abs(a), x = a * 2.55; // x ≈ distancia de arco al eje de la cara
    let d = 0;
    if (aa > 1.9) return 0;
    d += 0.15 * FV.brow * G(y - 3.98, 0.22) * G(a, 0.85);               // arco superciliar
    d += 0.05 * G(y - 4.0, 0.16) * G(aa - 0.5, 0.25);                   // hueso de la ceja sobre cada ojo
    d -= 0.24 * G(y - 3.5, 0.25) * G(aa - 0.45, 0.2);                   // cuencas
    d -= 0.07 * G(y - 3.74, 0.12) * G(aa - 0.45, 0.24);                 // pliegue bajo la ceja
    d -= 0.035 * G(y - 3.95, 0.45) * G(aa - 1.18, 0.22);                // sienes
    d += 0.11 * FV.cheek * G(y - 2.98, 0.3) * G(aa - 0.86, 0.3);         // pómulos
    d -= 0.1 * G(y - 2.05, 0.34) * G(aa - 1.02, 0.3);                    // mejilla hundida bajo el pómulo
    d += 0.07 * G(y - 1.85, 0.42) * G(a, 0.42);                         // arco dental (hocico)
    d += 0.085 * FV.lips * G(y - FY.lipUp, 0.09) * G(x, 0.5);           // labio superior
    d += 0.1 * FV.lips * G(y - FY.lipLo, 0.1) * G(x, 0.44);             // labio inferior
    d -= 0.045 * G(y - FY.mouth, 0.05) * G(x, 0.52);                    // comisura
    d -= 0.07 * G(y - 1.2, 0.12) * G(x, 0.55);                          // surco mentolabial
    d += 0.13 * FV.chin * G(y - FY.chin, 0.27) * G(x, 0.8);             // mentón
    d -= 0.02 * G(y - 2.0, 0.25) * G(Math.abs(x) - 0.66, 0.12);         // surco nasogeniano
    // Nariz
    const P = table(NOSE_P, y);
    if (P > 0) d += P * FV.nose * G(x, table(NOSE_W, y) * FV.noseW);
    d += 0.2 * G(y - 2.24, 0.13) * G(Math.abs(x) - 0.38 * FV.noseW, 0.13); // aletas
    return d;
  }
  // Anillo de la cabeza a la altura y (sin escalar): { rx, rz, cz, f }
  function headRingAt(y) {
    let rx, rz, cz, jaw = 0, back = 0;
    if (y >= 3.7) ({ rx, rz, cz } = skullAt(y));
    else { rx = crKeys(FACE_KEYS, y, 'rx') * lerp(1, FV.jaw, smooth((2.5 - y) / 1.3)); rz = crKeys(FACE_KEYS, y, 'rz'); cz = crKeys(FACE_KEYS, y, 'cz'); jaw = crKeys(FACE_KEYS, y, 'jaw'); back = crKeys(FACE_KEYS, y, 'back'); }
    const occ = 0.04 * G(y - 4.4, 0.9); // occipital
    const f = (a) => {
      const er = Math.hypot(rx * Math.sin(a), rz * Math.cos(a)) || 1e-3;
      const sh = 1 + jaw * G(Math.abs(a) - 1.95, 0.35) - back * G(Math.abs(a) - PI, 0.8) + occ * G(Math.abs(a) - PI, 0.9);
      return sh + faceDisp(y, a) / er;
    };
    return { rx, rz, cz, f };
  }
  // Alturas de los anillos: densos en la cara, más espaciados en el cráneo
  const HEAD_YS = [0.12, 0.22, 0.34, 0.46, 0.58, 0.72, 0.86, 1.0, 1.12, 1.23, 1.33, 1.42, 1.5, 1.57, 1.64, 1.72, 1.81, 1.9, 1.99, 2.07, 2.15, 2.23, 2.31, 2.4, 2.5, 2.62, 2.76, 2.9, 3.04, 3.18, 3.31, 3.43, 3.54, 3.65, 3.76, 3.87, 3.98, 4.1, 4.24, 4.42, 4.66, 4.95, 5.28, 5.6, 5.9, 6.16, 6.38, 6.54, 6.65];
  // Anillos escalados de la cabeza con la variación de cara vigente (FV)
  function makeHeadRings() {
    return [cap(0.02, 1.4)].concat(HEAD_YS.map((y) => Object.assign({ y }, headRingAt(y))), [cap(FY.top, SKULL_C.z)])
      .map((r) => ({ y: r.y * HS, rx: r.rx * HS, rz: r.rz * HS, cz: (r.cz || 0) * HS, f: r.f }));
  }
  const HEAD_RINGS = makeHeadRings(); // de referencia (las alturas son las mismas para todos)
  // Nombres de los anillos que usa la pintura de la cara (el más cercano a cada altura)
  const HEAD_NAMES = HEAD_RINGS.map(() => '');
  for (const [nm, y] of [['chin', FY.chin], ['jaw', FY.jaw], ['mouth', FY.mouth], ['nose', FY.noseBase], ['eyes', FY.eyes], ['brow', FY.brow], ['forehead', 4.95], ['crown', 6.25]]) {
    let best = 1; for (let i = 1; i < HEAD_RINGS.length - 1; i++) if (Math.abs(HEAD_RINGS[i].y - y * HS) < Math.abs(HEAD_RINGS[best].y - y * HS)) best = i;
    HEAD_NAMES[best] = nm;
  }
  HEAD_NAMES[0] = 'cap0'; HEAD_NAMES[HEAD_NAMES.length - 1] = 'top';
  // Ángulos de la cabeza: más densos al frente (rasgos finos), espaciados atrás
  const headAngles = (t) => { const s = 2 * t - 1; return PI * (0.34 * s + 0.66 * s * s * s); };
  // Elipsoide del cráneo (para el pelo y la vincha), ya escalado
  const HEAD_C = new T.Vector3(0, SKULL_C.y * HS, SKULL_C.z * HS), HEAD_R = new T.Vector3(SKULL_R.x * HS, SKULL_R.y * HS, SKULL_R.z * HS);
  // Línea de pelo: elevación máxima (desde la coronilla) según |a|, por tabla. La estándar tiene
  // entradas en las sienes, patillas delante de la oreja, el pelo pasa por encima de la oreja y baja a la nuca.
  function hairlineTable(tb) { return (a) => table(tb, Math.abs(a)); }
  const elOf = (y) => Math.acos(clamp((y - SKULL_C.y) / SKULL_R.y, -1, 1)); // elevación de una altura (sin escalar)
  const HL_FULL = [[0, elOf(FY.hairline)], [0.35, elOf(FY.hairline + 0.02)], [0.7, elOf(FY.hairline + 0.22)], [0.95, elOf(FY.hairline - 0.1)], [1.12, elOf(3.6)], [1.24, elOf(3.05)], [1.34, elOf(3.3)], [1.42, elOf(4.15)], [1.85, elOf(4.2)], [2.15, elOf(3.4)], [2.6, elOf(2.75)], [PI, elOf(2.55)]];
  const HAIRLINE_STD = hairlineTable(HL_FULL);
  // Parte de arriba (volumen del corto): termina sobre las sienes y baja un poco atrás
  const HAIRLINE_TOP = hairlineTable([[0, elOf(FY.hairline - 0.02)], [0.6, elOf(FY.hairline + 0.15)], [1.0, elOf(5.0)], [1.57, elOf(5.15)], [2.3, elOf(4.7)], [PI, elOf(4.3)]]);
  // compatibilidad: hairline(front, side, back) en radianes
  function hairline(front, side, back) {
    return (a) => {
      const c = Math.cos(a), f = (c + 1) / 2, s = Math.sin(a) * Math.sin(a);
      const fb = lerp(back, front, smooth(f));
      return fb * (1 - s) + side * s;
    };
  }
  // Punto sobre el elipsoide a una elevación/ángulo dados, con factor de radio kk
  function onHead(el, a, kk) {
    return new T.Vector3(HEAD_C.x + Math.sin(el) * Math.sin(a) * HEAD_R.x * kk, HEAD_C.y + Math.cos(el) * HEAD_R.y * kk, HEAD_C.z + Math.sin(el) * Math.cos(a) * HEAD_R.z * kk);
  }
  // Punto de la superficie de la cara (sin escalar) a la altura y y el ángulo a, con un despegue `off`
  function headPoint(y, a, off) {
    const r = headRingAt(y), f = r.f(a);
    const er = Math.hypot(r.rx * Math.sin(a), r.rz * Math.cos(a)) || 1e-3, k = f + (off || 0) / er;
    return new T.Vector3(r.rx * k * Math.sin(a), y, r.cz + r.rz * k * Math.cos(a));
  }
  // Barba: borde superior e inferior (altura sin escalar) según |a|, y medio ancho angular
  const BEARD_A = 1.5;
  const BEARD_TOP = [[0, 1.3], [0.16, 1.33], [0.24, 1.5], [0.3, 1.78], [0.42, 1.98], [0.62, 2.06], [0.9, 2.3], [1.12, 2.75], [1.26, 3.15], [1.36, 3.4], [1.5, 3.4]];
  const BEARD_BOT = [[0, 0.06], [0.5, 0.2], [0.9, 0.5], [1.2, 0.85], [1.5, 1.15]];
  // Ruido determinista periódico sobre el ángulo (mechones, vello de la barba)
  function ripple(a, n, amp, ph) { return amp * (0.6 * Math.sin(a * n + (ph || 0)) + 0.4 * Math.sin(a * (n * 1.7 + 1) + 1.3)); }

  // Construye las piezas del cuerpo en coordenadas locales de su hueso.
  // Convención de ángulos en los tubos: a = 0 frente (+z), a = ±π atrás; las extremidades se
  // modelan para el lado izquierdo (exterior = +x = +π/2, interior = −π/2) y se reflejan para el derecho.
  function buildBody(L) {
    FV = faceVariation(L.seed);
    try { return buildBodyInner(L); } finally { FV = FV0; }
  }
  function buildBodyInner(L) {
    const M = measures(L.body);
    const k = M.k, kj = M.kj, kt = M.kt, kw = M.kw, kc = M.kc, mu = M.mu;
    const kjm = (k + kj) / 2;
    const bones = [];
    const B = {};
    function bone(name, parent, x, y, z) {
      const b = new T.Bone(); b.name = name; b.position.set(x, y, z);
      if (parent) parent.add(b);
      B[name] = b; b.userData.index = bones.length; bones.push(b);
      return b;
    }
    const hips = bone('hips', null, 0, M.hipY, 0);
    const spine = bone('spine', hips, 0, M.spineY, 0);
    const chest = bone('chest', spine, 0, M.chestY, 0);
    const neck = bone('neck', chest, 0, M.neckY, 0);
    bone('head', neck, 0, M.headY, 0.1);
    const side = { R: -1, L: 1 };
    for (const s of ['R', 'L']) {
      const sg = side[s];
      const sh = bone('shoulder' + s, chest, sg * M.shoulder.x, M.shoulder.y, M.shoulder.z);
      const el = bone('elbow' + s, sh, 0, -M.upperArm, 0);
      bone('wrist' + s, el, 0, -M.forearm, 0);
      const th = bone('thigh' + s, hips, sg * M.hipX, 0, 0);
      const kn = bone('knee' + s, th, 0, -M.thigh, 0);
      bone('ankle' + s, kn, 0, -M.shin, 0);
    }
    const I = (n) => B[n].userData.index;

    const parts = [];
    const rings = {};
    const add = (geo, boneName) => { parts.push({ geo, bone: B[boneName] }); return geo; };
    const OUT = PI / 2, IN = -PI / 2; // exterior / interior de una extremidad izquierda

    // --- Cabeza: malla esculpida (cráneo, cara, nariz y labios en una sola superficie), orejas pegadas
    const headRings = makeHeadRings();
    const headGeo = tube(headRings, { segs: 40, uv: uvReg(REG.head), angles: headAngles });
    {
      // v por longitud de arco, pero con más peso en la cara (y de 1 a 4,4): ~2× resolución vertical
      const n = HEAD_RINGS.length, hreg = uvReg(REG.head), uvA = headGeo.attributes.uv, acc = [0];
      for (let i = 1; i < n; i++) {
        const p = headRings[i - 1], q = headRings[i], ym = (p.y + q.y) / 2 / HS;
        const len = Math.hypot((p.rx + p.rz) / 2 - (q.rx + q.rz) / 2, p.y - q.y);
        acc.push(acc[i - 1] + len * (1 + 2.2 * smooth((ym - 0.8) / 0.4) * smooth((4.6 - ym) / 0.4)));
      }
      const rv = acc.map((v) => v / acc[n - 1]);
      for (let i = 0; i < n; i++) for (let j = 0; j <= 40; j++) uvA.setY(i * 41 + j, lerp(hreg.v0, hreg.v1, rv[i]));
      headGeo.userData.ringV = rv;
    }
    rings.head = { v: headGeo.userData.ringV, names: HEAD_NAMES };
    rings.headDef = headRings;
    const earUV = swUV(SW.upperArm); // piel lisa
    const pieces = [headGeo];
    for (const sg of [-1, 1]) {
      // Oreja: concha plana apoyada en el cráneo + reborde (hélice) que deja la concha hundida + lóbulo.
      // Va de la altura de la ceja a la base de la nariz, un poco detrás del centro, apenas despegada atrás.
      const yE = 3.05, rr = headRingAt(yE), xs = rr.rx * rr.f(sg * PI / 2);
      const place = (g) => { g.rotateX(-0.2); g.rotateY(-sg * 0.22); g.translate(sg * xs, yE, -0.45); g.scale(HS, HS, HS); return flatUV(g, earUV[0], earUV[1]); };
      const shell = new T.SphereGeometry(1, 12, 9); shell.scale(0.13, 0.74, 0.42); shell.translate(sg * 0.05, 0, 0);
      pieces.push(place(shell));
      // hélice abierta: nace adelante (sobre el trago), pasa por arriba y atrás y baja hasta el lóbulo
      const helix = new T.TorusGeometry(0.56, 0.095, 6, 18, PI * 1.45); helix.rotateZ(PI * 1.5 + 0.25); helix.rotateY(PI / 2); helix.scale(1, 1.28, 0.72); helix.translate(sg * 0.13, 0.04, -0.02);
      pieces.push(place(helix));
      const lobe = new T.SphereGeometry(1, 8, 6); lobe.scale(0.12, 0.24, 0.2); lobe.translate(sg * 0.1, -0.74, 0.1);
      pieces.push(place(lobe));
      const tragus = new T.SphereGeometry(1, 6, 5); tragus.scale(0.1, 0.16, 0.12); tragus.translate(sg * 0.05, -0.12, 0.42);
      pieces.push(place(tragus));
    }
    // Barba: cáscara fina que sigue la mandíbula y el mentón (misma superficie de la cara, despegada
    // unos milímetros), con el borde superior en diagonal de la comisura a la patilla y bordes afinados.
    if (L.beard) {
      const nA = 34, nY = 10, A = BEARD_A, hreg = uvReg(REG.head);
      const pos = [], uvs = [], idx = [];
      for (let i = 0; i <= nY; i++) {
        for (let j = 0; j <= nA; j++) {
          const a = -A + (2 * A * j) / nA, aa = Math.abs(a);
          const yT = table(BEARD_TOP, aa), yB = table(BEARD_BOT, aa), t = i / nY;
          const y = lerp(yB, yT, t);
          const edge = smooth(Math.min(t * 3, (1 - t) * 5)) * smooth((A - aa) / 0.2);
          const off = (0.07 + 0.08 * G(a, 0.55) * G(y - 0.6, 0.55) + ripple(a, 17, 0.012, i)) * edge;
          const pnt = headPoint(y, a, off).multiplyScalar(HS);
          pos.push(pnt.x, pnt.y, pnt.z);
          uvs.push((a + PI) / (2 * PI), lerp(hreg.v0, hreg.v1, yToV(HEAD_RINGS, headGeo.userData.ringV, y * HS)));
        }
      }
      for (let i = 0; i < nY; i++) for (let j = 0; j < nA; j++) { const q = i * (nA + 1) + j; idx.push(q, q + 1, q + nA + 1, q + 1, q + nA + 2, q + nA + 1); }
      const beard = new T.BufferGeometry();
      beard.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      beard.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
      beard.setIndex(idx); beard.computeVertexNormals();
      pieces.push(beard);
    }
    add(merge(pieces.map((g) => bindTo(g, I('head')))), 'head');

    // --- Tronco: desde adentro del short hasta el cuello (camiseta pintada en el atlas).
    // Espalda de deportista: dorsales que abren en V, omóplatos, canal de la columna y trapecios que
    // suben del acromion a la nuca; al frente pectorales y surco del esternón. La línea de los hombros
    // llega hasta arriba del deltoides: el brazo nace DEBAJO del hombro, no como una bola al costado.
    const sx = M.shoulder.x;
    const droop = (d) => (a) => -d * Math.sin(a) * Math.sin(a);
    const SC = PI - 0.64; // ángulo de los omóplatos
    const torsoRings = [
      { y: -3.2, rx: 3.9 * kw, rz: 2.7 * kc, cz: 0.1 },
      { y: 0.0, rx: 4.05 * kw, rz: 2.8 * kc, cz: 0.12, f: shapeOf([[0, 0.3, -0.02], [1.9, 0.5, 0.025], [PI, 0.26, -0.04]]) },                                             // cintura
      { y: 2.6, rx: 2.3 * kw + 2.3 * kt, rz: 3.1 * kc, cz: 0.2, f: shapeOf([[0, 0.3, -0.03], [2.1, 0.5, 0.05 + 0.02 * mu], [PI, 0.24, -0.08]]) },                       // costillas / dorsales
      { y: 5.0, rx: 5.35 * kt, rz: 3.4 * kc, cz: 0.3, f: shapeOf([[0.5, 0.42, 0.05], [0, 0.2, -0.03], [2.05, 0.5, 0.05 + 0.025 * mu], [SC, 0.36, 0.045], [PI, 0.22, -0.09]]) }, // pecho / dorsales
      { y: 7.2, rx: 5.75 * kt, rz: 3.4 * kc, cz: 0.22, f: shapeOf([[0.55, 0.48, 0.065], [0, 0.22, -0.03], [SC, 0.4, 0.075 + 0.015 * mu], [PI, 0.22, -0.085]]) },             // pectorales / omóplatos
      { y: 9.1, rx: sx + 1.0, rz: 3.1 * kc, cz: 0.06, f: shapeOf([[0, 0.5, -0.02], [SC - 0.05, 0.42, 0.06], [PI, 0.26, -0.05]]), dy: droop(0.2) },                          // hombros
      { y: 10.55, rx: sx + 0.55, rz: 2.6 * kc, cz: -0.06, f: shapeOf([[0, 0.5, -0.04], [SC, 0.5, 0.035]]), dy: droop(0.25) },
      { y: 11.3, rx: sx - 0.35, rz: 2.15 * kc, cz: -0.15, f: shapeOf([[0, 0.6, -0.08], [PI, 0.8, 0.05]]), dy: droop(0.25) },                                                   // acromion
      { y: 11.8, rx: 3.05 * (0.4 + 0.6 * kt), rz: 1.95 * kc, cz: -0.15, f: shapeOf([[0, 0.6, -0.1], [PI, 0.75, 0.07 + 0.02 * mu]]), dy: droop(0.2) },                          // trapecios / clavículas
      { y: 12.2, rx: 1.86 + 0.3 * (kt - 1), rz: 1.6, cz: -0.1, f: shapeOf([[PI, 0.8, 0.1], [0, 0.35, -0.05], [0.75, 0.3, 0.04]]) },                                            // base del cuello
      { y: 12.8, rx: 1.52 + 0.25 * (kt - 1), rz: 1.45, cz: -0.05, f: shapeOf([[0.7, 0.32, 0.05], [0, 0.3, 0.02], [PI, 0.8, 0.04]]) },                                          // cuello
      { y: 13.4, rx: 1.46 + 0.2 * (kt - 1), rz: 1.42, cz: -0.12, f: shapeOf([[0.75, 0.35, 0.03]]), dy: (a) => 0.5 * G(Math.abs(a) - PI, 1.0) },                                // nuca y garganta
      { y: 14.1, rx: 1.36, rz: 1.3, cz: -0.3, dy: (a) => 0.7 * G(Math.abs(a) - PI, 1.0) },                                                                                     // entra en la base del cráneo
    ];
    const torsoGeo = tube(torsoRings, { segs: 26, uv: uvReg(REG.torso) });
    rings.torso = { v: torsoGeo.userData.ringV, names: ['in', 'waist', 'ribs', 'chest', 'pecs', 'shoulders', 'shTop', 'acro', 'traps', 'neckBase', 'neckMid', 'neckTop', 'neckIn'], def: torsoRings };
    // Pesos: el cuello sigue al hueso del cuello y, arriba (dentro del cráneo), en parte a la cabeza;
    // el contorno del hombro acompaña un poco al brazo (se recoge al levantarlo).
    {
      const c = torsoGeo.attributes.position.count, pp = torsoGeo.attributes.position;
      const si = new Uint16Array(c * 4), sw = new Float32Array(c * 4);
      for (let i = 0; i < c; i++) {
        const x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i);
        const wn = smooth((y - 11.3) / 1.7) * 0.9 * smooth((4.0 - Math.abs(x)) / 1.6), wh = smooth((y - 12.9) / 1.2) * 0.6;
        const ws = 0.3 * smooth((3.2 - Math.hypot(Math.abs(x) - sx, y - 9.5, z - 0.2)) / 2.2);
        si[i * 4] = I('spine'); sw[i * 4] = (1 - wn) * (1 - ws);
        si[i * 4 + 1] = I('neck'); sw[i * 4 + 1] = wn * (1 - wh) * (1 - ws);
        si[i * 4 + 2] = I('head'); sw[i * 4 + 2] = wn * wh * (1 - ws);
        si[i * 4 + 3] = I(x < 0 ? 'shoulderR' : 'shoulderL'); sw[i * 4 + 3] = ws;
      }
      torsoGeo.setAttribute('skinIndex', new T.BufferAttribute(si, 4)); torsoGeo.setAttribute('skinWeight', new T.BufferAttribute(sw, 4));
    }
    add(torsoGeo, 'spine');

    // --- Pelvis (parte alta del short): cintura elástica por fuera de la camiseta, glúteos y una
    // entrepierna corta. Las perneras (en el muslo) cuelgan rectas desde la cadera: sin globo.
    const ks = 0.3 + 0.7 * k;                 // holgura de la tela según el cuerpo
    const hw = M.hipX + 2.72 * ks;            // semiancho del short a la altura de la cadera
    const pelvisRings = [
      cap(-3.3, 0),
      { y: -3.0, rx: hw * 0.8, rz: 2.2 * kc, cz: 0 },                                                                   // entrepierna
      { y: -1.8, rx: hw * 0.985, rz: 3.15 * kc, cz: -0.08, f: shapeOf([[PI - 0.6, 0.5, 0.04], [PI, 0.22, -0.03]]) },
      { y: -0.2, rx: hw, rz: 3.45 * kc, cz: -0.12, f: shapeOf([[PI - 0.6, 0.5, 0.05], [PI, 0.22, -0.035]]) },             // glúteos
      { y: 1.7, rx: hw * 0.72 + 4.5 * kw * 0.28, rz: 3.4 * kc, cz: 0, f: shapeOf([[PI - 0.6, 0.5, 0.025]]) },
      { y: 3.6, rx: 4.75 * kw, rz: 3.2 * kc, cz: 0.1 },
      { y: 4.9, rx: 4.6 * kw, rz: 3.1 * kc, cz: 0.12 },                                                                 // cintura del short
      { y: 5.5, rx: 4.15 * kw, rz: 2.8 * kc, cz: 0.12 },
    ];
    const pelvisGeo = tube(pelvisRings, { segs: 24, uv: uvReg(REG.pelvis) });
    {
      // Pesos: los costados bajos del short siguen en parte al muslo de su lado
      const c = pelvisGeo.attributes.position.count, pp = pelvisGeo.attributes.position;
      const si = new Uint16Array(c * 4), sw = new Float32Array(c * 4);
      for (let i = 0; i < c; i++) {
        const x = pp.getX(i), y = pp.getY(i);
        const w = smooth((0.8 - y) / 3.4) * 0.5 * clamp((Math.abs(x) - 0.8) / 2.5, 0, 1);
        si[i * 4] = I('hips'); sw[i * 4] = 1 - w; si[i * 4 + 1] = I(x < 0 ? 'thighR' : 'thighL'); sw[i * 4 + 1] = w;
      }
      pelvisGeo.setAttribute('skinIndex', new T.BufferAttribute(si, 4)); pelvisGeo.setAttribute('skinWeight', new T.BufferAttribute(sw, 4));
    }
    add(pelvisGeo, 'hips');

    // --- Extremidades
    const skinSw = (s) => ({ u0: s[0] / ATLAS, u1: s[1] / ATLAS, v0: 1 - s[3] / ATLAS, v1: 1 - s[2] / ATLAS });
    const jointSphere = (r, uvp, bi, sy) => { const g = new T.SphereGeometry(r, 12, 9); if (sy) g.scale(1, sy, 1); return bindTo(flatUV(g, uvp[0], uvp[1]), bi); };
    const handUV = swUV(SW.hand), armUV = swUV(SW.upperArm), darkUV = swUV(SW.dark), soleUV = swUV(SW.white);
    for (const s of ['R', 'L']) {
      const mir = s === 'R';
      // Muslo: pernera del short que cae recta hasta casi la rodilla (pliegues en el ruedo) y, debajo,
      // piel: vasto interno (gota sobre la rodilla), vasto externo y rótula. Las articulaciones usan kj.
      const fold = (n, amp, ph) => (a) => 1 + amp * Math.sin(a * n + ph);
      const thighRings = [
        cap(2.7, -0.1),                                                            // cúpula cerrada alrededor de la cadera:
        { y: 2.3, rx: 1.5 * ks, rz: 1.55 * ks, cz: -0.1 },                         // al flexionar el muslo no deja huecos
        { y: 1.3, rx: 2.3 * ks, rz: 2.4 * ks, cz: -0.08 },
        { y: -0.2, rx: 2.68 * ks, rz: 2.86 * ks, cz: -0.05 },
        { y: -1.6, rx: 2.72 * ks, rz: 2.9 * ks, cz: -0.03 },
        { y: -3.6, rx: 2.68 * ks, rz: 2.84 * ks, cz: 0, f: fold(3, 0.018, 0.8) },
        { y: -6.2, rx: 2.64 * ks, rz: 2.78 * ks, cz: 0.02, f: fold(4, 0.026, 2.1) },
        { y: -8.3, rx: 2.7 * ks, rz: 2.82 * ks, cz: 0.05, f: fold(4, 0.04, 0.4) },   // ruedo
        { y: -8.45, rx: 2.0 * k, rz: 2.1 * k, cz: 0.02, f: shapeOf([[0.4, 0.5, 0.05], [PI, 0.6, 0.03]]) }, // piel bajo el ruedo
        { y: -9.7, rx: 1.76 * kjm, rz: 1.84 * kjm, cz: 0.05, f: shapeA([[IN * 0.45, 0.45, 0.03 + 0.03 * mu], [OUT * 0.5, 0.5, 0.03], [PI, 0.5, 0.02]]) },
        { y: -10.5, rx: 1.6 * kj, rz: 1.66 * kj, cz: 0.08, f: shapeOf([[0, 0.5, 0.05]]) },               // rodilla
        { y: -11.3, rx: 1.52 * kj, rz: 1.58 * kj, cz: 0.05, f: shapeOf([[0, 0.5, 0.04]]) },              // anillo compartido con la pantorrilla
      ];
      const th = tube(thighRings, { segs: 16, uv: uvReg(REG.thigh) });
      rings.thigh = { v: th.userData.ringV, names: ['cap', 'dome', 'dome2', 'top', 'hip', 'mid', 'low', 'hem', 'skin', 'lower', 'knee', 'joint'] };
      // Pantorrilla: gemelos (dos cabezas, la interna más baja), tibia plana al frente, tendón de
      // Aquiles y maléolos; media pintada
      const cf = 0.07 + 0.035 * mu;
      const shinRings = [
        { y: 0.0, rx: 1.52 * kj, rz: 1.58 * kj, cz: 0.05, f: shapeOf([[0, 0.5, 0.04]]) },               // mismo anillo que el muslo (sin costura)
        { y: -1.3, rx: 1.58 * kjm, rz: 1.84 * k, cz: -0.3, f: shapeOf([[PI - 0.55, 0.5, cf * 0.8], [0, 0.4, -0.04]]) },
        { y: -3.1, rx: 1.66 * k, rz: 1.98 * k, cz: -0.5, f: shapeOf([[PI - 0.52, 0.5, cf], [0, 0.35, -0.04]]) },   // vientre de los gemelos
        { y: -5.0, rx: 1.42 * k, rz: 1.66 * k, cz: -0.4, f: shapeOf([[PI - 0.4, 0.5, cf * 0.5], [0, 0.35, -0.03]]) },
        { y: -7.0, rx: 1.14 * kjm, rz: 1.26 * kjm, cz: -0.2, f: shapeOf([[PI, 0.5, 0.05]]) },            // alto de la media
        { y: -9.2, rx: 1.0 * kj, rz: 1.1 * kj, cz: -0.08, f: shapeOf([[PI, 0.4, 0.06]]) },               // tendón de Aquiles
        { y: -11.0, rx: 1.0 * kj, rz: 1.1 * kj, cz: 0, f: shapeOf([[OUT, 0.45, 0.07]]) },                // tobillo (maléolos)
        cap(-11.8, 0),
      ];
      const sh = tube(shinRings, { segs: 16, uv: uvReg(REG.shin) });
      rings.shin = { v: sh.userData.ringV, names: ['knee', 'calf', 'calf2', 'calf3', 'sockTop', 'sock', 'ankle', 'cap2'] };
      // Normales promediadas en el anillo compartido (sin salto de tono entre muslo y pantorrilla)
      {
        const na = th.attributes.normal, nb = sh.attributes.normal, base = 11 * 17;
        for (let j = 0; j <= 16; j++) {
          const x = na.getX(base + j) + nb.getX(j), y = na.getY(base + j) + nb.getY(j), z = na.getZ(base + j) + nb.getZ(j), l = Math.hypot(x, y, z) || 1;
          na.setXYZ(base + j, x / l, y / l, z / l); nb.setXYZ(j, x / l, y / l, z / l);
        }
      }
      if (mir) { mirrorX(th); mirrorX(sh); }
      // Pesos rígidos: muslo y pantorrilla giran alrededor de la rótula como un codo de caño (sin estrangular)
      add(bindTo(th, I('thigh' + s)), 'thigh' + s);
      add(bindTo(sh, I('knee' + s)), 'knee' + s);
      // Rótula: elipsoide del mismo radio que los anillos de la rodilla (queda al ras; al flexionar
      // completa la curva en lugar de asomar como una bola)
      {
        const g = new T.SphereGeometry(1.56 * kj, 14, 10); g.scale(1, 1, 1.03); g.translate(0, 0, 0.1);
        add(bindTo(flatUV(g, 0.5, 1 - (REG.shin[0] + 6) / ATLAS), I('knee' + s)), 'knee' + s);
      }
      // Zapatilla de básquet (caña alta): empeine, puntera redondeada, talón; suela aparte con labio
      const shoeRings = [
        cap(2.7, -1.2),
        { y: 2.45, rx: 1.25, rz: 1.15, cz: -1.15, f: shapeOf([[0, 0.6, 0.06]]) },   // talón (contrafuerte)
        { y: 1.2, rx: 1.6, rz: 1.72, cz: -0.95 },                                   // tobillo / caña
        { y: 0.0, rx: 1.72, rz: 1.6, cz: -1.2 },                                    // empeine
        { y: -1.6, rx: 1.78, rz: 1.35, cz: -1.5 },
        { y: -3.4, rx: 1.72, rz: 1.05, cz: -1.9, f: shapeOf([[0, 0.7, 0.05]]) },    // caja de los dedos
        { y: -5.0, rx: 1.45, rz: 0.78, cz: -2.12, f: shapeOf([[0, 0.8, 0.08]]) },   // puntera
        cap(-5.75, -2.3),
      ];
      const shoeG = tube(shoeRings, { segs: 16, uv: uvReg(REG.shoe) });
      shoeG.rotateX(-PI / 2); // y → -z: el talón queda atrás, la punta adelante; cz pasa a ser altura
      shoeG.scale(k > 1 ? 1.06 : 1, 1, 1);
      rings.shoe = { v: shoeG.userData.ringV, names: ['heelCap', 'heel', 'collar', 'instep', 'mid', 'toeBox', 'toe', 'toeCap'] };
      const shoePieces = [shoeG];
      // Suela: losa aplanada un poco más ancha que el corte, con punta levantada
      const soleRings = [
        cap(2.85, -2.45),
        { y: 2.5, rx: 1.42, rz: 0.46, cz: -2.45 },
        { y: 1.2, rx: 1.78, rz: 0.46, cz: -2.46 },
        { y: 0.0, rx: 1.9, rz: 0.46, cz: -2.46 },
        { y: -1.6, rx: 1.95, rz: 0.46, cz: -2.46 },
        { y: -3.4, rx: 1.88, rz: 0.44, cz: -2.4 },
        { y: -5.0, rx: 1.58, rz: 0.4, cz: -2.25 },
        cap(-5.95, -2.1),
      ];
      const soleG = tube(soleRings, { segs: 14, uv: uvReg(REG.sole) });
      soleG.rotateX(-PI / 2); soleG.scale(k > 1 ? 1.06 : 1, 1, 1);
      shoePieces.push(soleG);
      // Lengüeta y cuello acolchado del tobillo
      const tongue = new T.SphereGeometry(0.9, 8, 6); tongue.scale(0.95, 0.42, 1.25); tongue.rotateX(-0.55); tongue.translate(0, 0.45, 0.35);
      shoePieces.push(flatUV(tongue, darkUV[0], darkUV[1]));
      const collar = new T.TorusGeometry(1.12, 0.24, 6, 16); collar.rotateX(PI / 2); collar.scale(1, 1, 1.1); collar.translate(0, 0.75, -0.8);
      shoePieces.push(flatUV(collar, darkUV[0], darkUV[1]));
      const shoeAll = merge(shoePieces);
      if (mir) mirrorX(shoeAll);
      add(bindTo(shoeAll, I('ankle' + s)), 'ankle' + s);
      // Brazo: deltoides (cae en punta hacia el costado del brazo), bíceps al frente, tríceps atrás;
      // se afina hacia el codo. El extremo de arriba es media esfera centrada en la articulación.
      const dl = 0.1 * mu, bi = 0.085 * mu, tri = 0.065 * mu;
      const uaRings = [
        cap(1.85, 0),
        { y: 1.7, rx: 0.75 * k, rz: 0.78 * k },
        { y: 1.35, rx: 1.3 * k, rz: 1.34 * k, f: shapeA([[OUT, 0.8, 0.04]]) },
        { y: 0.7, rx: 1.62 * k, rz: 1.68 * k, f: shapeA([[OUT, 0.8, 0.04 + dl * 0.4]]) },
        { y: -0.3, rx: 1.72 * k, rz: 1.8 * k, f: shapeA([[OUT, 0.9, dl], [IN, 0.6, -0.06]]) },                                    // deltoides
        { y: -1.8, rx: 1.66 * k, rz: 1.76 * k, f: shapeA([[OUT, 0.85, dl * 0.9], [IN, 0.6, -0.05], [PI, 0.6, tri * 0.5]]) },
        { y: -3.3, rx: 1.48 * k, rz: 1.6 * k, f: shapeA([[OUT, 0.7, dl * 0.3], [0, 0.5, bi * 0.6], [PI - 0.3, 0.6, tri]]) },       // inserción del deltoides
        { y: -5.2, rx: 1.36 * k, rz: 1.5 * k, f: shapeA([[0, 0.5, bi], [PI - 0.2, 0.6, tri * 0.9]]) },                             // bíceps / tríceps
        { y: -7.2, rx: 1.2 * kjm, rz: 1.26 * kjm, f: shapeA([[0, 0.5, bi * 0.4], [PI, 0.5, 0.03]]) },
        { y: -9.0, rx: 1.1 * kj, rz: 1.12 * kj },                                                                                   // codo
      ];
      const ua = tube(uaRings, { segs: 14, uv: skinSw(SW.upperArm) });
      // Antebrazo: braquiorradial arriba y afuera, muñeca aplanada
      const faRings = [
        { y: 0.0, rx: 1.1 * kj, rz: 1.12 * kj },                                                                                    // mismo anillo que el brazo (sin costura)
        { y: -1.5, rx: 1.24 * k, rz: 1.2 * k, f: shapeA([[OUT + 0.3, 0.7, 0.06 + 0.03 * mu], [0, 0.5, 0.02]]) },
        { y: -4.0, rx: 1.04 * k, rz: 0.98 * k, f: shapeA([[OUT + 0.2, 0.7, 0.04]]) },
        { y: -6.4, rx: 0.93 * kjm, rz: 0.76 * kjm },
        { y: -8.3, rx: 0.93 * k, rz: 0.6 * k },
        cap(-8.9, 0),
      ];
      const fa = tube(faRings, { segs: 14, uv: skinSw(SW.forearm) });
      {
        const na = ua.attributes.normal, nb = fa.attributes.normal, base = 9 * 15;
        for (let j = 0; j <= 14; j++) {
          const x = na.getX(base + j) + nb.getX(j), y = na.getY(base + j) + nb.getY(j), z = na.getZ(base + j) + nb.getZ(j), l = Math.hypot(x, y, z) || 1;
          na.setXYZ(base + j, x / l, y / l, z / l); nb.setXYZ(j, x / l, y / l, z / l);
        }
      }
      if (mir) { mirrorX(ua); mirrorX(fa); }
      add(bindTo(ua, I('shoulder' + s)), 'shoulder' + s);
      add(bindTo(fa, I('elbow' + s)), 'elbow' + s);
      add(jointSphere(1.1 * kj, armUV, I('elbow' + s), 1.0), 'elbow' + s);
      if (!mir) { rings.armL = { ua: uaRings, fa: faRings }; }
      // Mano: palma con forma, nudillos, cuatro dedos separados y curvados, pulgar del lado interno
      const handRings = [
        cap(0.5, 0),
        { y: 0.0, rx: 0.95 * k, rz: 0.6 * k },
        { y: -1.2, rx: 1.42 * k, rz: 0.7 * k, cx: 0.1, f: shapeOf([[0, 0.8, 0.06]]) },
        { y: -2.5, rx: 1.55 * k, rz: 0.66 * k, cx: 0.15, f: shapeOf([[0, 0.8, 0.08]]) },
        { y: -3.0, rx: 1.45 * k, rz: 0.58 * k, cx: 0.15 },
        cap(-3.25, 0),
      ];
      const handPieces = [tube(handRings, { segs: 12, uv: skinSw(SW.hand) })];
      for (let i = 0; i < 4; i++) {
        const len = [1.55, 1.85, 1.75, 1.35][i];
        const x = -1.12 * k + i * 0.75 * k;
        const f = new T.CapsuleGeometry(0.3 * k, len, 3, 7);
        f.scale(1, 1, 0.85);
        f.translate(0, -len / 2 - 0.15, 0); f.rotateX(-0.35 - i * 0.04); f.rotateY((i - 1.5) * 0.06); f.translate(x, -2.85, 0.1);
        handPieces.push(flatUV(f, handUV[0], handUV[1]));
        const kn = new T.SphereGeometry(0.34 * k, 6, 5); kn.scale(1, 0.8, 0.9); kn.translate(x, -2.85, 0.15);
        handPieces.push(flatUV(kn, handUV[0], handUV[1]));
      }
      const thumb = new T.CapsuleGeometry(0.34 * k, 1.5, 3, 7);
      thumb.translate(0, -0.75, 0); thumb.rotateZ(0.8); thumb.rotateX(-0.5); thumb.translate(-1.0 * k, -0.8, 0.55);
      handPieces.push(flatUV(thumb, handUV[0], handUV[1]));
      const hd = merge(handPieces);
      if (mir) mirrorX(hd);
      add(bindTo(hd, I('wrist' + s)), 'wrist' + s);
    }

    // --- Pelo (en coordenadas de la cabeza)
    const hairUV = swUV(SW.hair), hairReg = uvReg(REG.hair);
    const style = L.style;
    const hairPieces = [];
    const r = rng(L.seed ^ 0x9e37);
    const noise = [];
    for (let i = 0; i < 400; i++) noise.push(r());
    const nz = (i, j) => noise[(i * 29 + j * 11) % 400];
    if (style === 'corto') {
      // Corto con degradado: los costados y la nuca van pintados al ras (fade); arriba un casquete
      // con volumen que termina sobre las sienes, más alto al frente (jopo) y con mechones.
      const th = (a, el, i, j) => { const e = el / HAIRLINE_TOP(a); return 0.1 * (1 - e * e) + 0.05 * G(a, 0.7) * (1 - e * e) * smooth(e * 3) + 0.012 * nz(i, j) + 0.008 * Math.sin(a * 13 + el * 11); };
      const scalpUV = Object.assign({ ringV: rings.head.v }, uvReg(REG.head));
      hairPieces.push(hairCap(HEAD_C, HEAD_R, 0.01, HAIRLINE_TOP, th, scalpUV, 40, 12));
    } else if (style === 'mono') {
      // Pelo tirante hacia atrás (casquete fino hasta la línea de pelo) y moño alto con base y gomita
      const hl = (a) => HAIRLINE_STD(a) - 0.03;
      const th = (a, el, i, j) => 0.018 + 0.03 * G(Math.abs(a) - PI, 1.2) * (1 - el / hl(a)) + 0.006 * nz(i, j);
      hairPieces.push(hairCap(HEAD_C, HEAD_R, 0.012, hl, th, hairReg, 36, 12));
      const c = onHead(0.62, PI, 1.0);
      const nrm = new T.Vector3(0, Math.cos(0.62) / HEAD_R.y, -Math.sin(0.62) / HEAD_R.z).normalize();
      const bun = new T.SphereGeometry(1.12, 14, 10); bun.scale(1.08, 0.92, 1.0);
      const bc = c.clone().addScaledVector(nrm, 1.05); bun.translate(bc.x, bc.y, bc.z);
      hairPieces.push(flatUV(bun, hairUV[0], hairUV[1]));
      const band = new T.TorusGeometry(0.72, 0.14, 5, 16); band.lookAt(nrm); const kc = c.clone().addScaledVector(nrm, 0.3); band.translate(kc.x, kc.y, kc.z);
      hairPieces.push(flatUV(band, swUV(SW.trim)[0], swUV(SW.trim)[1]));
    } else if (style === 'rapado') {
      // Rapado: pelo al ras, solo pintado en el cuero cabelludo (sin volumen)
    } else if (style === 'rulos') {
      // Rulos: volumen corto y redondeado (no un casco), con muchos rizos chicos que rompen la silueta
      const hl = (a) => HAIRLINE_STD(a) - 0.05;
      const thk = (a, el) => { const e = el / hl(a); return 0.17 * (1 - 0.55 * e * e) * (0.75 + 0.25 * G(a, 1.4)); };
      hairPieces.push(hairCap(HEAD_C, HEAD_R, 0.02, hl, (a, el, i, j) => thk(a, el) + 0.03 * nz(i, j), hairUV, 36, 13));
      for (let i = 0; i < 140; i++) {
        const a = -PI + r() * PI * 2, el = Math.sqrt(r()) * (hl(a) - 0.06);
        const rad = 0.24 + r() * 0.13;
        const cg = new T.IcosahedronGeometry(rad, 0); cg.rotateX(r() * 3); cg.rotateY(r() * 3); cg.scale(1, 0.85, 1);
        { const pp = cg.attributes.position, nn = cg.attributes.normal; for (let vi = 0; vi < pp.count; vi++) { const l = Math.hypot(pp.getX(vi), pp.getY(vi), pp.getZ(vi)) || 1; nn.setXYZ(vi, pp.getX(vi) / l, pp.getY(vi) / l, pp.getZ(vi) / l); } }
        const c = onHead(el, a, 1 + thk(a, el) * 0.92); cg.translate(c.x, c.y, c.z);
        hairPieces.push(flatUV(cg, hairUV[0], hairUV[1]));
      }
    } else if (style === 'trenzas') {
      hairPieces.push(hairCap(HEAD_C, HEAD_R, 0.03, (a) => HAIRLINE_STD(a) - 0.02, null, hairReg, 36, 12));
      // Trenzas pegadas (cornrows): 7 filas gruesas de la frente a la nuca. Desde ahí cuelgan en
      // mechones con volumen: trenzas más anchas que se afinan hacia la punta, con nudos, de largos
      // distintos y en dos capas (las de abajo, más cortas, rellenan), recogidas hacia el centro.
      const braid = (pts, segsT, rad, radial, taper, ph) => {
        const tb = new T.TubeGeometry(new T.CatmullRomCurve3(pts, false, 'centripetal'), segsT, rad, radial, false);
        const pp = tb.attributes.position, nn = tb.attributes.normal, per = radial + 1;
        for (let vi = 0; vi < pp.count; vi++) {
          const seg = Math.floor(vi / per), u = seg / segsT;
          const kR = (1 - taper * u * u) * (1 + 0.2 * Math.sin(seg * 2.3 + ph)) - 1;
          pp.setXYZ(vi, pp.getX(vi) + nn.getX(vi) * rad * kR, pp.getY(vi) + nn.getY(vi) * rad * kR, pp.getZ(vi) + nn.getZ(vi) * rad * kR);
        }
        return flatUV(tb, hairUV[0], hairUV[1]);
      };
      const ends = [];
      for (let i = 0; i < 7; i++) {
        const xi = (i - 3) * 0.6 * HS;
        const kk = 1.05, q = Math.sqrt(Math.max(0.05, 1 - (xi / (HEAD_R.x * kk)) * (xi / (HEAD_R.x * kk))));
        const ry = HEAD_R.y * kk * q, rz = HEAD_R.z * kk * q;
        const th0 = HAIRLINE_STD(0) - 0.06 + Math.abs(i - 3) * 0.06, th1 = -(PI - 1.45);
        const pts = [];
        for (let j = 0; j <= 7; j++) { const th = lerp(th0, th1, j / 7); pts.push(new T.Vector3(xi, HEAD_C.y + Math.cos(th) * ry, HEAD_C.z + Math.sin(th) * rz)); }
        hairPieces.push(braid(pts, 14, 0.27, 5, 0, i));
        ends.push(pts[pts.length - 1]);
      }
      for (let i = 0; i < 11; i++) {
        const under = i >= 7;                                   // capa de abajo: entre dos filas
        const e = under ? ends[i - 6].clone().lerp(ends[i - 5], 0.5) : ends[i];
        const len = (under ? 2.6 : 3.6) + 1.5 * nz(i, 5), sg = e.x / HEAD_R.x, zb = under ? 0.15 : -0.3;
        const pts = [
          new T.Vector3(e.x, e.y + 0.25, e.z + 0.12),
          new T.Vector3(e.x * 0.97, e.y - len * 0.3, e.z + zb - 0.25),
          new T.Vector3(e.x * 0.86 + sg * 0.1, e.y - len * 0.68, e.z + zb - 0.42),
          new T.Vector3(e.x * 0.78 + sg * 0.25 * (nz(i, 9) - 0.3), e.y - len, e.z + zb - 0.38),
        ];
        hairPieces.push(braid(pts, 8, under ? 0.34 : 0.38, 6, 0.6, i * 1.7));
      }
    }
    if (hairPieces.length) add(merge(hairPieces.map((g) => bindTo(g, I('head')))), 'head');

    // --- Accesorios
    const acc = L.accessory;
    const trimUV = swUV(SW.trim), jerseyUV = swUV(SW.jersey);
    if (acc === 'vincha') {
      // Vincha sobre la frente: sigue el cráneo a la altura y = 4,75 (más holgada sobre los rulos)
      const sk = skullAt(4.75), extra = L.style === 'rulos' ? 0.3 : L.style === 'corto' ? 0.12 : 0.05;
      const g = new T.TorusGeometry((sk.rx + 0.08 + extra) * HS, 0.3, 7, 30);
      g.rotateX(PI / 2); g.scale(1, 1, (sk.rz + 0.08 + extra) / (sk.rx + 0.08 + extra)); g.translate(0, 4.75 * HS, sk.cz * HS);
      add(bindTo(flatUV(g, trimUV[0], trimUV[1]), I('head')), 'head');
    } else if (acc === 'manga') {
      // Manga de compresión en el brazo izquierdo: los mismos anillos del brazo, un poco más anchos
      const grow = (r0, d, y) => Object.assign({}, r0, { rx: r0.rx + d, rz: r0.rz + d, y: y == null ? r0.y : y });
      const ua = rings.armL.ua, fa = rings.armL.fa;
      const g1 = tube([grow(ua[5], 0.1, -1.0), grow(ua[5], 0.1), grow(ua[6], 0.1), grow(ua[7], 0.1), grow(ua[8], 0.1), grow(ua[9], 0.1)], { segs: 14 });
      add(bindTo(flatUV(g1, jerseyUV[0], jerseyUV[1]), I('shoulderL')), 'shoulderL');
      const g2 = tube([grow(fa[0], 0.1), grow(fa[1], 0.1), grow(fa[2], 0.1), grow(fa[3], 0.09), grow(fa[4], 0.09, -7.8)], { segs: 14 });
      add(bindTo(flatUV(g2, jerseyUV[0], jerseyUV[1]), I('elbowL')), 'elbowL');
      add(jointSphere(1.2 * kj, jerseyUV, I('elbowL'), 1.0), 'elbowL');
    } else if (acc === 'munequeras') {
      for (const s of ['R', 'L']) {
        const g = tube([{ y: -6.4, rx: 1.02 * kj, rz: 0.88 * kj }, { y: -7.4, rx: 1.02 * kj, rz: 0.84 * kj }, { y: -8.3, rx: 0.97 * kj, rz: 0.74 * kj }], { segs: 12 });
        add(bindTo(flatUV(g, trimUV[0], trimUV[1]), I('elbow' + s)), 'elbow' + s);
      }
    } else if (acc === 'rodillera') {
      const g = tube([{ y: 1.9, rx: 1.92 * kjm, rz: 2.0 * kjm, cz: 0.05 }, { y: 0.0, rx: 1.74 * kj, rz: 1.82 * kj, cz: 0.08 }, { y: -1.5, rx: 1.74 * k, rz: 2.0 * k, cz: -0.32 }, { y: -2.7, rx: 1.78 * k, rz: 2.08 * k, cz: -0.45 }], { segs: 16 });
      add(bindBlend(flatUV(g, jerseyUV[0], jerseyUV[1]), I('kneeR'), I('thighR'), -1.2, 1.9, 0.2), 'kneeR');
    }

    return { bones, B, parts, rings, M };
  }

  // ------------------------------------------------------------------ Atlas: pintura
  function fontStack(px) { return `700 ${px}px "Barlow Condensed", "Arial Narrow", Impact, "Helvetica Neue", Arial, sans-serif`; }

  // y local de un anillo → v (0..1) interpolando en el perfil
  function yToV(ringsDef, v, y) {
    for (let i = 1; i < ringsDef.length; i++) {
      if (y <= ringsDef[i].y) {
        const k = (y - ringsDef[i - 1].y) / (ringsDef[i].y - ringsDef[i - 1].y);
        return lerp(v[i - 1], v[i], clamp(k, 0, 1));
      }
    }
    return v[v.length - 1];
  }

  function paintAtlas(ctx, L, rival, rings, headRingsDef) {
    const W = ATLAS;
    const jersey = L.colors[0], trim = L.colors[1], skin = L.skin, hair = L.hair;
    const skinD = shade(skin, -0.3), skinL = shade(skin, 0.1);
    const r = rng(L.seed ^ 0x51a7);
    ctx.save();
    ctx.fillStyle = skin; ctx.fillRect(0, 0, W, W);
    // Grano fino de la piel (poros): puntos deterministas muy tenues
    ctx.fillStyle = rgba(skinD, 0.16);
    for (let i = 0; i < 2600; i++) ctx.fillRect(r() * W, r() * REG.head[1], 1.5, 1.5);
    ctx.fillStyle = rgba(skinL, 0.12);
    for (let i = 0; i < 1400; i++) ctx.fillRect(r() * W, r() * REG.head[1], 1.5, 1.5);

    // ---------- Cabeza
    const HR = REG.head;
    const hv = rings.head.v, hn = rings.head.names;
    const row = (name) => rowOf(HR, hv[hn.indexOf(name)]);
    const yEyes = row('eyes'), yBrow = row('brow'), yMouth = row('mouth'), yNose = row('nose'), yChin = row('chin'), yJaw = row('jaw'), yForehead = row('forehead');
    const cx = W / 2;
    const radial = (x, y, r0, r1, c0, a0, c1, a1) => { const gg = ctx.createRadialGradient(x, y, r0, x, y, r1); gg.addColorStop(0, rgba(c0, a0)); gg.addColorStop(1, rgba(c1, a1)); return gg; };
    const blob = (x, y, rx, ry, color, a) => { ctx.save(); ctx.translate(x, y); ctx.scale(Math.max(0.01, rx), Math.max(0.01, ry)); ctx.fillStyle = radial(0, 0, 0, 1, color, a, color, 0); ctx.beginPath(); ctx.arc(0, 0, 1, 0, PI * 2); ctx.fill(); ctx.restore(); };
    // La cara se pinta en unidades reales de la cabeza (sin escalar, las mismas de faceDisp):
    // x = a · 2,25 (arco desde el eje, + = izquierda del jugador) e y = altura local. Así lo pintado
    // coincide con lo esculpido y la anisotropía del atlas (más píxeles a lo ancho) queda corregida.
    const PX = W / (2 * PI * 2.25);
    const X = (x) => cx + x * PX, Y = (y) => rowOf(HR, yToV(headRingsDef, hv, y * HS));
    const ppv = (y) => (Y(y - 0.05) - Y(y + 0.05)) / 0.1;
    const blobU = (x, y, rx, ry, color, a) => blob(X(x), Y(y), rx * PX, ry * ppv(y), color, a);
    const ellU = (x, y, rx, ry, rot) => { ctx.beginPath(); ctx.ellipse(X(x), Y(y), rx * PX, ry * ppv(y), rot || 0, 0, PI * 2); };
    // Trazo de puntos [x, y] o curvas [cx, cy, x, y] en unidades
    const path = (pts, close) => { ctx.beginPath(); pts.forEach((p, i) => { if (p.length === 2) { if (i) ctx.lineTo(X(p[0]), Y(p[1])); else ctx.moveTo(X(p[0]), Y(p[1])); } else ctx.quadraticCurveTo(X(p[0]), Y(p[1]), X(p[2]), Y(p[3])); }); if (close) ctx.closePath(); };
    const deep = mix(shade(skin, -0.5), '#3E1E16', 0.3);           // sombra cálida de cuencas y pliegues
    const lum = luminance(skin);
    // Variación suave del tono de la piel (manchas tenues) y sombra bajo la mandíbula
    for (let i = 0; i < 40; i++) blob(r() * W, HR[0] + r() * (HR[1] - HR[0]), 20 + r() * 40, 8 + r() * 16, i % 2 ? skinD : skinL, 0.06);
    let g = ctx.createLinearGradient(0, Y(0.9), 0, HR[1]);
    g.addColorStop(0, rgba(skinD, 0)); g.addColorStop(1, rgba(skinD, 0.55));
    ctx.fillStyle = g; ctx.fillRect(0, Y(0.9), W, HR[1] - Y(0.9));
    // Frente con brillo suave, sienes en sombra
    blobU(0, 4.75, 1.3, 0.55, skinL, 0.2);
    for (const s of [-1, 1]) blobU(s * 2.55, 3.95, 0.45, 0.7, skinD, 0.16);
    // Pómulos: luz sobre el hueso, sombra de contorno debajo, mejillas apenas cálidas
    const warm = mix(skin, '#C04A3E', 0.22);
    for (const s of [-1, 1]) {
      blobU(s * 1.6, 3.0, 0.55, 0.22, skinL, 0.24);
      blobU(s * 1.95, 2.15, 0.55, 0.4, skinD, 0.16);
      blobU(s * 1.3, 2.55, 0.6, 0.35, warm, 0.18);
    }
    // Barba de dos días (adulto): sombra tenue sobre mandíbula, mentón y bigote
    const stubble = !L.beard && L.style !== 'mono' && (L.seed % 3) !== 0;
    const beardPath = (k) => {
      // contorno de la barba (tablas BEARD_TOP/BOT); k > 1 la agranda un poco (borde difuminado)
      const pts = [];
      const n = 36;
      for (let i = 0; i <= n; i++) { const a = -BEARD_A + (2 * BEARD_A * i) / n; pts.push([a * 2.25, table(BEARD_TOP, Math.abs(a)) + (k - 1) * 0.6]); }
      for (let i = n; i >= 0; i--) { const a = -BEARD_A + (2 * BEARD_A * i) / n; pts.push([a * 2.25, table(BEARD_BOT, Math.abs(a)) - (k - 1)]); }
      path(pts, true);
    };
    if (stubble) {
      const sc = mix(hair, shade(skin, -0.25), luminance(hair) > 0.45 ? 0.75 : 0.45);
      ctx.save(); beardPath(1); ctx.clip();
      ctx.fillStyle = rgba(sc, 0.14); ctx.fillRect(0, Y(3.6), W, HR[1] - Y(3.6));
      ctx.fillStyle = rgba(sc, 0.22);
      for (let i = 0; i < 900; i++) ctx.fillRect(X((r() - 0.5) * 6.8), Y(0.05 + r() * 3.3), 1.4, 1.4);
      ctx.restore();
      ctx.fillStyle = rgba(sc, 0.16); path([[-0.62, 1.72], [-0.3, 2.02, 0, 1.98], [0.3, 2.02, 0.62, 1.72], [0, 1.76, -0.62, 1.72]], true); ctx.fill();
    }
    // Cuencas: sombra profunda bajo el arco superciliar y hacia el lagrimal
    for (const s of [-1, 1]) {
      blobU(s * 0.86, 3.6, 0.66, 0.34, deep, 0.36);
      blobU(s * 0.42, 3.5, 0.2, 0.22, deep, 0.28);
      blobU(s * 0.88, 3.28, 0.42, 0.1, deep, 0.16);        // ojera
    }
    // Ojos: almendra de 0,8 × 0,26 u (3 × 1 cm), canto externo apenas más alto, iris tapado por los
    // párpados, esclera en sombra arriba, pliegue del párpado y línea de pestañas finas.
    const iris = ['#3B2312', '#56381E', '#3D5A40', '#3F5672', '#21140C', '#5E5232'][L.seed % 6];
    const lidDark = mix(shade(skin, -0.7), '#120806', 0.4);
    const eh = rival ? 0.105 : 0.138;   // medio alto de la abertura (el rival entorna los ojos)
    for (const s of [-1, 1]) {
      const xi = s * 0.44, xo = s * 1.24, yc = 3.5;
      const up = [[xi, yc - 0.005], [s * 0.78, yc + eh * 2.05, xo, yc + 0.03]];
      const lo = [[s * 0.95, yc - 0.2, xi, yc - 0.005]];
      // piel del párpado superior apenas más oscura
      ctx.fillStyle = rgba(deep, 0.22); path([[xi, yc], [s * 0.8, yc + eh * 2 + 0.34, xo + s * 0.04, yc + 0.04], [s * 0.8, yc + eh * 2.05, xi, yc]], true); ctx.fill();
      ctx.save(); path(up.concat(lo), true); ctx.clip();
      const scl = mix('#E6E0D8', skin, 0.22);
      g = ctx.createLinearGradient(0, Y(yc + eh), 0, Y(yc - eh));
      g.addColorStop(0, mix(scl, deep, 0.4)); g.addColorStop(0.4, scl); g.addColorStop(1, mix(scl, skin, 0.15));
      ctx.fillStyle = g; ctx.fillRect(X(-1.4) , Y(yc + 0.3), X(1.4) - X(-1.4), Y(yc - 0.3) - Y(yc + 0.3));
      // rincones más oscuros
      blobU(xi, yc, 0.14, 0.12, mix(scl, '#B07060', 0.5), 0.7);
      blobU(xo, yc + 0.03, 0.16, 0.12, deep, 0.45);
      const ix = s * 0.82, iy = yc + 0.005, ir = 0.155;
      ctx.fillStyle = shade(iris, -0.45); ellU(ix, iy, ir, ir); ctx.fill();
      g = ctx.createRadialGradient(X(ix), Y(iy), 0, X(ix), Y(iy), ir * PX * 0.92);
      g.addColorStop(0, shade(iris, 0.25)); g.addColorStop(0.55, iris); g.addColorStop(1, shade(iris, -0.3));
      ctx.save(); ctx.translate(X(ix), Y(iy)); ctx.scale(1, ppv(iy) / PX); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, ir * PX * 0.9, 0, PI * 2); ctx.fill(); ctx.restore();
      ctx.fillStyle = '#060406'; ellU(ix, iy, 0.062, 0.062); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.85)'; ellU(ix - s * 0.05, iy + 0.05, 0.03, 0.03); ctx.fill();
      // sombra del párpado sobre el globo
      g = ctx.createLinearGradient(0, Y(yc + eh * 1.1), 0, Y(yc + eh * 0.1));
      g.addColorStop(0, rgba('#1A0C08', 0.45)); g.addColorStop(1, rgba('#1A0C08', 0));
      ctx.fillStyle = g; ctx.fillRect(X(-1.4), Y(yc + eh * 1.2), X(1.4) - X(-1.4), Y(yc) - Y(yc + eh * 1.2));
      ctx.restore();
      // línea de pestañas superior (más gruesa hacia afuera) y pliegue del párpado
      ctx.lineCap = 'round';
      ctx.strokeStyle = rgba(lidDark, 0.95); ctx.lineWidth = 2.2; path(up); ctx.stroke();
      ctx.lineWidth = 3; path([[s * 0.85, yc + eh * 1.55], [s * 1.08, yc + eh * 1.2, xo + s * 0.04, yc + 0.035]]); ctx.stroke();
      ctx.strokeStyle = rgba(deep, 0.5); ctx.lineWidth = 1.6;
      path([[s * 0.5, yc + 0.06], [s * 0.82, yc + eh * 2 + 0.3, s * 1.22, yc + 0.1]]); ctx.stroke();
      // párpado inferior: línea fina y luz debajo
      ctx.strokeStyle = rgba(deep, 0.55); ctx.lineWidth = 1.1; path([[xo, yc + 0.03], [s * 0.95, yc - 0.2, xi, yc - 0.005]]); ctx.stroke();
      ctx.strokeStyle = rgba(skinL, 0.35); ctx.lineWidth = 1.4; path([[xo - s * 0.06, yc - 0.03], [s * 0.95, yc - 0.27, xi + s * 0.06, yc - 0.06]]); ctx.stroke();
    }
    // Cejas: cabeza ancha junto al entrecejo, arco y cola fina; pegadas al arco superciliar.
    // Rival: cabeza más baja y junta (ceño de concentración).
    const browC = luminance(hair) > 0.5 ? mix(hair, '#4A3A28', 0.45) : mix(shade(hair, -0.05), skin, 0.18);
    for (const s of [-1, 1]) {
      const yi = rival ? 3.8 : 3.86, xIn = rival ? 0.3 : 0.34, yPk = rival ? 3.99 : 4.03;
      ctx.fillStyle = rgba(browC, 0.92);
      path([[s * xIn, yi - 0.06], [s * 0.6, yi + 0.12, s * 0.98, yPk], [s * 1.25, yPk - 0.03, s * 1.42, 3.88], [s * 1.2, yPk - 0.08, s * 0.95, yPk - 0.08], [s * 0.6, yi - 0.03, s * xIn, yi - 0.06]], true);
      ctx.fill();
      // pelos: trazos cortos inclinados hacia afuera y arriba
      ctx.strokeStyle = rgba(browC, 0.6); ctx.lineWidth = 1;
      for (let i = 0; i < 16; i++) {
        const t = i / 15, bx = lerp(xIn + 0.02, 1.35, t), by = lerp(yi + 0.02, 3.92, t) + (t < 0.6 ? 0.1 * Math.sin(t / 0.6 * PI / 2) : 0.1 - (t - 0.6) * 0.2);
        ctx.beginPath(); ctx.moveTo(X(s * bx), Y(by - 0.05)); ctx.lineTo(X(s * (bx + 0.09)), Y(by + 0.05)); ctx.stroke();
      }
    }
    if (rival) { // entrecejo: dos pliegues verticales y sombra
      ctx.strokeStyle = rgba(deep, 0.45); ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      for (const s of [-1, 1]) { path([[s * 0.12, 3.78], [s * 0.16, 3.9, s * 0.13, 4.02]]); ctx.stroke(); }
      blobU(0, 3.84, 0.3, 0.12, deep, 0.22);
    }
    // Nariz: sombras a los lados del puente, luz en el dorso y la punta, aletas, fosas y sombra debajo
    for (const s of [-1, 1]) blobU(s * 0.36, 2.95, 0.16, 0.6, skinD, 0.2);
    blobU(0, 2.95, 0.08, 0.55, skinL, 0.22);
    blobU(0, 2.4, 0.14, 0.1, skinL, 0.28);
    blobU(0, 2.02, 0.38, 0.07, deep, 0.4);
    ctx.fillStyle = rgba(mix(shade(skin, -0.65), '#1A0A06', 0.3), 0.9);
    for (const s of [-1, 1]) { ellU(s * 0.2, 2.11, 0.11, 0.045, s * 0.35); ctx.fill(); }
    ctx.strokeStyle = rgba(deep, 0.42); ctx.lineWidth = 1.5;
    for (const s of [-1, 1]) { path([[s * 0.3, 2.4], [s * 0.6, 2.35, s * 0.5, 2.1]]); ctx.stroke(); }
    // Surcos nasogenianos y filtro
    ctx.strokeStyle = rgba(deep, lum > 0.5 ? 0.08 : 0.12); ctx.lineWidth = 3;
    for (const s of [-1, 1]) { path([[s * 0.55, 2.12], [s * 0.82, 1.85, s * 0.8, 1.55]]); ctx.stroke(); }
    blobU(0, 1.85, 0.07, 0.13, skinD, 0.14);
    for (const s of [-1, 1]) blobU(s * 0.11, 1.86, 0.04, 0.12, skinL, 0.2);
    // Boca: labio superior más oscuro con arco de cupido, inferior más lleno con brillo, comisuras.
    const mw = rival ? 0.57 : 0.6, cy0 = 1.555, lift = rival ? -0.01 : 0.02;
    const lipUp = mix(shade(skin, -0.3), '#7E3436', lum > 0.5 ? 0.36 : 0.22), lipLo = mix(shade(skin, -0.14), '#A0504A', lum > 0.5 ? 0.36 : 0.2);
    ctx.fillStyle = rgba(lipUp, 0.85);
    path([[-mw, cy0 + lift], [-0.32, 1.66, -0.09, 1.7], [0, 1.67], [0.09, 1.7], [0.32, 1.66, mw, cy0 + lift], [0, cy0 - 0.03, -mw, cy0 + lift]], true); ctx.fill();
    ctx.fillStyle = rgba(lipLo, 0.8);
    path([[-mw * 0.88, cy0], [0, 1.24, mw * 0.88, cy0], [0, cy0 - 0.025, -mw * 0.88, cy0]], true); ctx.fill();
    blobU(0, 1.44, 0.24, 0.04, skinL, 0.32);
    ctx.strokeStyle = rgba(mix(shade(skin, -0.7), '#1A0808', 0.3), 0.9); ctx.lineWidth = 1.8;
    path([[-mw, cy0 + lift], [0, cy0 - 0.03, mw, cy0 + lift]]); ctx.stroke();
    for (const s of [-1, 1]) blobU(s * mw * 1.02, cy0 + lift, 0.07, 0.05, deep, 0.45);
    blobU(0, 1.24, 0.42, 0.07, deep, 0.28);                         // sombra bajo el labio inferior
    blobU(0, 0.62, 0.5, 0.2, skinL, 0.2);                           // luz del mentón
    // Barba recortada: rellena la región de la cáscara, con vello en trazos, bigote y borde difuminado
    if (L.beard) {
      const bc = luminance(hair) > 0.5 ? mix(hair, '#5A4530', 0.3) : hair;
      ctx.save(); beardPath(1.06); ctx.clip();
      ctx.fillStyle = rgba(bc, 0.35); ctx.fillRect(0, Y(3.8), W, HR[1] - Y(3.8));
      ctx.restore();
      ctx.save(); beardPath(1); ctx.clip();
      ctx.fillStyle = rgba(bc, 0.86); ctx.fillRect(0, Y(3.8), W, HR[1] - Y(3.8));
      ctx.strokeStyle = rgba(shade(bc, 0.3), 0.45); ctx.lineWidth = 1.1;
      for (let i = 0; i < 900; i++) { const x = (r() - 0.5) * 6.9, y = 0.05 + r() * 3.4; const a = PI / 2 + (r() - 0.5) * 0.9 + x * 0.12; ctx.beginPath(); ctx.moveTo(X(x), Y(y)); ctx.lineTo(X(x) + Math.cos(a) * 3, Y(y) + Math.sin(a) * 4); ctx.stroke(); }
      ctx.fillStyle = rgba(shade(bc, -0.4), 0.35);
      for (let i = 0; i < 500; i++) ctx.fillRect(X((r() - 0.5) * 6.9), Y(0.05 + r() * 3.4), 1.5, 1.5);
      blobU(0, 0.75, 0.6, 0.3, shade(bc, 0.35), 0.22);
      ctx.restore();
      // bigote que baja por las comisuras hasta la barba
      ctx.fillStyle = rgba(bc, 0.88);
      path([[-0.7, 1.42], [-0.72, 1.66, -0.5, 1.8], [-0.25, 1.98, 0, 1.95], [0.25, 1.98, 0.5, 1.8], [0.72, 1.66, 0.7, 1.42], [0.66, 1.42], [0.56, 1.62, 0.3, 1.71], [0, 1.73], [-0.3, 1.71], [-0.56, 1.62, -0.66, 1.42]], true);
      ctx.fill();
      ctx.strokeStyle = rgba(shade(bc, 0.25), 0.4); ctx.lineWidth = 1;
      for (let i = 0; i < 60; i++) { const x = (r() - 0.5) * 1.3, y = 1.72 + r() * 0.22; ctx.beginPath(); ctx.moveTo(X(x), Y(y)); ctx.lineTo(X(x) + Math.sign(x) * 2, Y(y) + 3); ctx.stroke(); }
      // la boca se vuelve a marcar encima
      ctx.strokeStyle = rgba(mix(shade(skin, -0.7), '#1A0808', 0.3), 0.9); ctx.lineWidth = 1.8;
      path([[-mw, cy0 + lift], [0, cy0 - 0.03, mw, cy0 + lift]]); ctx.stroke();
    }
    // Cuero cabelludo y línea de pelo según el peinado (pintado por columnas: u = ángulo)
    const style = L.style;
    const elY = (el) => Y(SKULL_C.y + Math.cos(el) * SKULL_R.y);   // fila de una elevación del cráneo
    const NC = 384, cw = W / NC + 1;
    const colA = (i) => ((i + 0.5) / NC - 0.5) * PI * 2;
    if (style !== 'pelado') {
      const hairD = shade(hair, -0.06);
      for (let i = 0; i < NC; i++) {
        const a = colA(i), x0 = (i / NC) * W, full = HAIRLINE_STD(a);
        if (style === 'corto') {
          // Degradado: arriba el color del pelo; en costados y nuca se aclara hacia la piel (máquina)
          const top = HAIRLINE_TOP(a) - 0.04, fk = smooth((Math.abs(a) - 0.75) / 0.45);
          ctx.fillStyle = hairD; ctx.fillRect(x0, HR[0], cw, elY(top) - HR[0] + 1);
          const B = 10;
          for (let k = 0; k < B; k++) {
            const e0 = lerp(top, full, k / B), e1 = lerp(top, full, (k + 1) / B);
            ctx.fillStyle = mix(hairD, mix(skin, hair, 0.18), fk * (0.12 + 0.62 * ((k + 0.5) / B)));
            ctx.fillRect(x0, elY(e0), cw, elY(e1) - elY(e0) + 1);
          }
        } else {
          ctx.fillStyle = style === 'rapado' ? mix(hair, skin, 0.42) : hairD;
          ctx.fillRect(x0, HR[0], cw, elY(full) - HR[0] + 1);
        }
      }
      if (style === 'corto') {
        // Arriba: mechones cortos peinados hacia atrás y arriba, con luces y sombras (lo ve el casquete)
        ctx.lineCap = 'round';
        for (let i = 0; i < 2200; i++) {
          const a = (r() - 0.5) * PI * 2, el = r() * (HAIRLINE_TOP(a) - 0.02), px = (a / (PI * 2) + 0.5) * W, py = elY(el);
          const l = 3 + r() * 5, dir = -PI / 2 + (r() - 0.5) * 0.9 + Math.sin(a) * 0.5;
          ctx.strokeStyle = rgba(r() < 0.62 ? shade(hair, -0.5) : shade(hair, 0.42), 0.2 + r() * 0.3); ctx.lineWidth = 1 + r() * 1.6;
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(dir) * l * 0.6, py + Math.sin(dir) * l); ctx.stroke();
        }
      }
      // Textura del pelo corto: puntitos del color del pelo (más densos arriba)
      ctx.fillStyle = rgba(shade(hair, -0.2), style === 'rapado' ? 0.45 : 0.3);
      for (let i = 0; i < 2600; i++) {
        const a = (r() - 0.5) * PI * 2, el = r() * HAIRLINE_STD(a);
        ctx.fillRect((a / (PI * 2) + 0.5) * W, elY(el), 1.3, 1.3);
      }
      // Borde de la línea de pelo: pelitos cortos que bajan y sombra fina debajo (no un corte recto)
      ctx.lineCap = 'round';
      for (let i = 0; i < 420; i++) {
        const a = (r() - 0.5) * PI * 2, el = HAIRLINE_STD(a), py = elY(el), px = (a / (PI * 2) + 0.5) * W;
        const fk = style === 'corto' ? smooth((Math.abs(a) - 0.75) / 0.45) : 0;
        ctx.strokeStyle = rgba(mix(hairD, skin, style === 'rapado' ? 0.45 : 0.1 + fk * 0.6), 0.55);
        ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(px, py - 2); ctx.lineTo(px + (r() - 0.5) * 3, py + 2 + r() * 3); ctx.stroke();
      }
      ctx.strokeStyle = rgba(skinD, 0.18); ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i <= NC; i++) { const a = ((i / NC) - 0.5) * PI * 2, py = elY(HAIRLINE_STD(a)) + 3; if (i) ctx.lineTo((i / NC) * W, py); else ctx.moveTo(0, py); }
      ctx.stroke();
    } else {
      // Pelado: brillo de la calva y una sombra apenas azulada de pelo afeitado a los costados
      g = ctx.createRadialGradient(cx, HR[0] + 30, 5, cx, HR[0] + 30, 170);
      g.addColorStop(0, rgba(skinL, 0.45)); g.addColorStop(1, rgba(skinL, 0));
      ctx.fillStyle = g; ctx.fillRect(0, HR[0], W, Y(4.95) - HR[0]);
    }

    // ---------- Tronco: camiseta sin mangas con vivos, número grande y nombre
    const TR = REG.torso;
    const tv = rings.torso.v, tn = rings.torso.names, tdef = rings.torso.def;
    const trow = (name) => rowOf(TR, tv[tn.indexOf(name)]);
    const yShoulders = trow('shoulders'), yPecs = trow('pecs'), yChest = trow('chest'), yWaist = trow('waist'), yShTop = trow('shTop');
    // píxeles por unidad: horizontal (circunferencia del pecho) y vertical (perfil)
    const chestRing = tdef[tn.indexOf('chest')];
    const ppuX = W / (Math.PI * (chestRing.rx + chestRing.rz));
    const ppuY = (yWaist - yPecs) / (tdef[tn.indexOf('pecs')].y - tdef[tn.indexOf('waist')].y);
    // tela
    g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, shade(jersey, -0.08)); g.addColorStop(0.25, shade(jersey, -0.14)); g.addColorStop(0.5, shade(jersey, 0.04)); g.addColorStop(0.75, shade(jersey, -0.14)); g.addColorStop(1, shade(jersey, -0.08));
    ctx.fillStyle = g; ctx.fillRect(0, TR[0], W, TR[1] - TR[0]);
    ctx.fillStyle = 'rgba(0,0,0,.035)';
    for (let y = TR[0]; y < TR[1]; y += 2) ctx.fillRect(0, y, W, 1);
    // Piel del cuello
    const yNeckBase = trow('neckBase');
    ctx.fillStyle = skin; ctx.fillRect(0, TR[0], W, yNeckBase - TR[0]);
    g = ctx.createLinearGradient(0, TR[0], 0, TR[0] + 30);
    g.addColorStop(0, rgba(skinD, 0.5)); g.addColorStop(1, rgba(skinD, 0));
    ctx.fillStyle = g; ctx.fillRect(0, TR[0], W, 30);
    // Escotes y sisas: vivo (más grande) y después piel
    const scoop = (x0, halfW, top, depth, color) => {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(x0 - halfW, top - 2);
      ctx.bezierCurveTo(x0 - halfW * 0.95, top + depth * 1.15, x0 + halfW * 0.95, top + depth * 1.15, x0 + halfW, top - 2);
      ctx.closePath(); ctx.fill();
    };
    const trimW = 11;
    const topY = yNeckBase - 1;
    const front = { x: cx, hw: 118, depth: yPecs - topY };
    const back = { hw: 90, depth: (yShTop - topY) * 1.05 };
    const hole = { hw: 100, depth: yChest - topY };
    for (const pass of [0, 1]) {
      const color = pass === 0 ? trim : skin;
      const d = pass === 0 ? trimW : 0;
      scoop(front.x, front.hw + d, topY, front.depth + d, color);
      scoop(0, back.hw + d, topY, back.depth + d, color); scoop(W, back.hw + d, topY, back.depth + d, color);
      scoop(W * 0.25, hole.hw + d, topY, hole.depth + d, color); scoop(W * 0.75, hole.hw + d, topY, hole.depth + d, color);
    }
    // tapa la fila del borde superior de los escotes (el antialias dejaba una línea clara alrededor del cuello)
    ctx.fillStyle = skin; ctx.fillRect(0, topY - 4, W, 5);
    g = ctx.createLinearGradient(0, yShTop, 0, yShTop + 40);
    g.addColorStop(0, rgba(skinD, 0.35)); g.addColorStop(1, rgba(skinD, 0));
    ctx.save(); ctx.beginPath(); ctx.rect(0, yShTop, W, 60); ctx.clip();
    scoop(front.x, front.hw, topY, front.depth, g); scoop(W * 0.25, hole.hw, topY, hole.depth, g); scoop(W * 0.75, hole.hw, topY, hole.depth, g); scoop(0, back.hw, topY, back.depth, g); scoop(W, back.hw, topY, back.depth, g);
    ctx.restore();
    // Vivos laterales bajo las sisas
    ctx.fillStyle = trim;
    for (const x of [W * 0.25, W * 0.75]) ctx.fillRect(x - 6, yChest, 12, TR[1] - yChest);
    ctx.fillStyle = rgba(jersey, 1);
    for (const x of [W * 0.25, W * 0.75]) ctx.fillRect(x - 2, yChest, 4, TR[1] - yChest);
    // Relieve pintado (se lee aunque la luz sea plana y de lejos): canal de la columna, omóplatos,
    // sombra bajo los dorsales y tela recogida en la cintura; al frente, sombra bajo los pectorales.
    const jD = shade(jersey, -0.55), jL = mix(jersey, '#FFFFFF', 0.4);
    const yRibs = trow('ribs');
    ctx.save(); ctx.beginPath(); ctx.rect(0, yShTop, W, TR[1] - yShTop); ctx.clip();
    for (const x0 of [0, W]) {
      blob(x0, (yShoulders + yWaist) / 2, 13, (yWaist - yShoulders) * 0.62, jD, 0.5);                // columna
      for (const sg of [-1, 1]) {
        blob(x0 + sg * 100, (yShoulders + yPecs) / 2, 62, (yPecs - yShoulders) * 0.75, jL, 0.36);     // omóplato
        blob(x0 + sg * 92, yPecs + (yChest - yPecs) * 0.45, 70, (yChest - yPecs) * 0.3, jD, 0.42);    // sombra bajo el omóplato
        blob(x0 + sg * 190, (yChest + yRibs) / 2, 30, (yRibs - yChest) * 0.8, jD, 0.3);             // bajo el dorsal
        blob(x0 + sg * 120, (yChest + yRibs) / 2, 50, (yRibs - yChest) * 0.7, jL, 0.18);              // dorsal
      }
    }
    for (const sg of [-1, 1]) blob(cx + sg * 78, yChest + (yRibs - yChest) * 0.1, 70, (yRibs - yChest) * 0.28, jD, 0.16); // bajo los pectorales
    for (let i = 0; i < 16; i++) {                                                                  // tela recogida en la cintura
      const x = (i + 0.5 + (r() - 0.5) * 0.6) / 16 * W;
      blob(x, yWaist - (yWaist - yRibs) * 0.55, 9 + r() * 8, (yWaist - yRibs) * (0.8 + r() * 0.9), i % 2 ? jL : jD, i % 2 ? 0.1 : 0.2);
    }
    ctx.restore();
    // Número al frente y atrás, nombre atrás. Se dibuja con la relación de aspecto real del torso
    // (el atlas tiene más píxeles por unidad a lo ancho que a lo alto) para que se lea grande y bien.
    const numStr = String(L.num);
    const numColor = trim, outline = luminance(trim) > 0.5 ? shade(jersey, -0.45) : shade(trim, 0.6);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const aspect = ppuX / ppuY;
    const drawNum = (x, y, hUnits, maxWUnits) => {
      const hPx = hUnits * ppuY;
      ctx.save(); ctx.translate(x, y);
      ctx.font = fontStack(Math.round(hPx));
      const natural = ctx.measureText(numStr).width / ppuX; // ancho natural en unidades (sin corregir)
      let sx = aspect; // corrige la anisotropía del atlas
      if (natural * aspect > maxWUnits) sx = maxWUnits / natural;
      ctx.scale(sx, 1);
      ctx.lineWidth = Math.max(4, hPx * 0.085); ctx.strokeStyle = outline; ctx.strokeText(numStr, 0, 0);
      ctx.fillStyle = numColor; ctx.fillText(numStr, 0, 0);
      ctx.restore();
    };
    drawNum(cx, yPecs + (yWaist - yPecs) * 0.5, 5.9, 8.8);
    for (const x of [0, W]) drawNum(x, yPecs + (yWaist - yPecs) * 0.56, 6.4, 9.6);
    // Escudo ficticio "JM" pequeño sobre el pecho izquierdo (a la derecha del número visto de frente)
    const crest = (x, y, hPx, color, out) => {
      ctx.save(); ctx.translate(x, y); ctx.scale(aspect * 0.9, 1); ctx.font = fontStack(hPx);
      ctx.lineWidth = 2; ctx.strokeStyle = out; ctx.strokeText('JM', 0, 0); ctx.fillStyle = color; ctx.fillText('JM', 0, 0); ctx.restore();
    };
    crest(cx + 2.6 * ppuX, yPecs - (yPecs - yShoulders) * 0.15, Math.round(1.3 * ppuY), numColor, outline);
    const nm = String(L.name || '').toUpperCase().slice(0, 12);
    if (nm) {
      const hPx = Math.round(1.55 * ppuY);
      ctx.save(); ctx.font = fontStack(hPx); ctx.fillStyle = numColor; ctx.strokeStyle = outline; ctx.lineWidth = 2.5;
      const natural = ctx.measureText(nm).width / ppuX;
      const sx = Math.min(aspect * 0.92, 9.5 / natural);
      for (const x of [0, W]) { ctx.save(); ctx.translate(x, yShoulders + (yPecs - yShoulders) * 0.4); ctx.scale(sx, 1); ctx.strokeText(nm, 0, 0); ctx.fillText(nm, 0, 0); ctx.restore(); }
      ctx.restore();
    }

    // ---------- Pelvis (short) y muslo (pernera + piel)
    const PR = REG.pelvis;
    g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, shade(jersey, -0.12)); g.addColorStop(0.5, shade(jersey, 0.02)); g.addColorStop(1, shade(jersey, -0.12));
    ctx.fillStyle = g; ctx.fillRect(0, PR[0], W, PR[1] - PR[0]);
    ctx.fillStyle = 'rgba(0,0,0,.035)'; for (let y = PR[0]; y < PR[1]; y += 2) ctx.fillRect(0, y, W, 1);
    ctx.fillStyle = shade(jersey, -0.35); ctx.fillRect(0, PR[0], W, 7); // cintura elástica
    ctx.fillStyle = shade(jersey, 0.25); ctx.fillRect(0, PR[0] + 7, W, 2);
    ctx.fillStyle = trim; for (const x of [W * 0.25, W * 0.75]) ctx.fillRect(x - 7, PR[0] + 9, 14, PR[1] - PR[0] - 9);
    // Pliegues de la tela: caen verticales desde la cintura (pares sombra/luz); surco entre los glúteos
    const foldsShort = (y0, y1, n) => {
      ctx.save(); ctx.beginPath(); ctx.rect(0, y0, W, y1 - y0); ctx.clip();
      for (let i = 0; i < n; i++) {
        const x = (i + 0.5 + (r() - 0.5) * 0.7) / n * W, wd = 10 + r() * 12;
        blob(x, (y0 + y1) / 2 + (r() - 0.5) * (y1 - y0) * 0.5, wd, (y1 - y0) * (0.6 + r() * 0.5), jD, 0.2);
        blob(x + wd * 1.1, (y0 + y1) / 2, wd * 0.8, (y1 - y0) * 0.6, jL, 0.1);
      }
      ctx.restore();
    };
    foldsShort(PR[0] + 9, PR[1], 12);
    for (const x0 of [0, W]) blob(x0, PR[1], 18, (PR[1] - PR[0]) * 0.75, jD, 0.3);
    // fondo del short (entrepierna) oscuro
    ctx.fillStyle = shade(jersey, -0.22); ctx.fillRect(0, PR[1] - 4, W, 4);
    const THR = REG.thigh;
    const thv = rings.thigh.v, thn = rings.thigh.names;
    const yHem = rowOf(THR, thv[thn.indexOf('hem')]), ySkin = rowOf(THR, thv[thn.indexOf('skin')]);
    ctx.fillStyle = g; ctx.fillRect(0, THR[0], W, yHem - THR[0]);
    ctx.fillStyle = 'rgba(0,0,0,.035)'; for (let y = THR[0]; y < yHem; y += 2) ctx.fillRect(0, y, W, 1);
    ctx.fillStyle = trim; ctx.fillRect(W * 0.75 - 7, THR[0], 14, yHem - THR[0]); // franja lateral
    ctx.save(); ctx.translate(W * 0.75 + 34, yHem - 22); ctx.scale(1.6, 1); ctx.font = fontStack(16); ctx.lineWidth = 1.5; ctx.strokeStyle = outline; ctx.strokeText('JM', 0, 0); ctx.fillStyle = trim; ctx.fillText('JM', 0, 0); ctx.restore();
    foldsShort(THR[0], yHem - 4, 7);
    blob(W * 0.25, (THR[0] + yHem) / 2, 120, (yHem - THR[0]) * 0.75, jD, 0.26);  // sombra entre las piernas
    ctx.fillStyle = shade(jersey, -0.3); ctx.fillRect(0, yHem - 4, W, 4);        // dobladillo
    ctx.fillStyle = skin; ctx.fillRect(0, yHem, W, THR[1] - yHem);
    g = ctx.createLinearGradient(0, ySkin, 0, ySkin + 18);
    g.addColorStop(0, rgba(skinD, 0.55)); g.addColorStop(1, rgba(skinD, 0));
    ctx.fillStyle = g; ctx.fillRect(0, ySkin, W, 18);

    // ---------- Pantorrilla: piel y media
    const SR = REG.shin;
    const sv = rings.shin.v, sn = rings.shin.names;
    const ySock = rowOf(SR, sv[sn.indexOf('sockTop')]);
    ctx.fillStyle = skin; ctx.fillRect(0, SR[0], W, SR[1] - SR[0]);
    {
      const sD = skinD, sL = skinL, yCalf = rowOf(SR, sv[sn.indexOf('calf2')]);
      for (const x0 of [0, W]) { blob(x0, yCalf + 8, 9, (ySock - SR[0]) * 0.5, sD, 0.3); for (const sg of [-1, 1]) blob(x0 + sg * 88, yCalf, 60, (ySock - SR[0]) * 0.4, sL, 0.3); }
      blob(W * 0.25, (SR[0] + ySock) / 2, 90, (ySock - SR[0]) * 0.7, sD, 0.16);
    }
    ctx.fillStyle = '#F1F0EB'; ctx.fillRect(0, ySock, W, SR[1] - ySock);
    ctx.fillStyle = trim; ctx.fillRect(0, ySock, W, 6);
    ctx.fillStyle = jersey; ctx.fillRect(0, ySock + 8, W, 3);
    ctx.fillStyle = 'rgba(0,0,0,.05)'; for (let y = ySock; y < SR[1]; y += 2) ctx.fillRect(0, y, W, 1);
    g = ctx.createLinearGradient(0, SR[1] - 14, 0, SR[1]);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.25)');
    ctx.fillStyle = g; ctx.fillRect(0, SR[1] - 14, W, 14);

    // ---------- Zapatilla: u = 0/1 abajo (junto a la suela), 0.25/0.75 laterales, 0.5 arriba (cordones).
    // v: talón (abajo del atlas) → punta (arriba). La suela es otra pieza (región sole).
    const ZR = REG.shoe, zh = ZR[1] - ZR[0];
    const shoeDark = '#1E1E26', shoeMid = '#2C2C36';
    const zv = rings.shoe.v, zn = rings.shoe.names;
    const zrow = (name) => rowOf(ZR, zv[zn.indexOf(name)]);
    const yInstep = zrow('instep'), yToeBox = zrow('toeBox'), yCollar = zrow('collar'), yToe = zrow('toe');
    ctx.fillStyle = shoeDark; ctx.fillRect(0, ZR[0], W, zh);
    // Paneles: empeine/caña con un gris más claro; puntera y talón con brillo de cuero sintético
    ctx.fillStyle = shoeMid; ctx.fillRect(W * 0.3, yToeBox, W * 0.4, yCollar - yToeBox);
    g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.25, 'rgba(255,255,255,.12)'); g.addColorStop(0.5, 'rgba(255,255,255,.05)'); g.addColorStop(0.75, 'rgba(255,255,255,.12)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, ZR[0], W, zh);
    // Puntera: banda clara (goma) y costura
    ctx.fillStyle = '#E9E6DE'; ctx.fillRect(0, ZR[0], W, yToe - ZR[0]);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(0, yToe - 2, W, 3);
    // Franja baja de color del equipo sobre la suela (entresuela)
    ctx.fillStyle = trim; ctx.fillRect(0, yToe, 26, ZR[1] - yToe); ctx.fillRect(W - 26, yToe, 26, ZR[1] - yToe);
    // Logo ficticio: ala estilizada en ambos laterales
    ctx.strokeStyle = trim; ctx.lineWidth = 10; ctx.lineCap = 'round';
    for (const x of [W * 0.25, W * 0.75]) {
      ctx.beginPath(); ctx.moveTo(x - 95, yInstep + 6); ctx.quadraticCurveTo(x + 5, yInstep - 2, x + 70, yToeBox + 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 70, yInstep + 20); ctx.quadraticCurveTo(x + 10, yInstep + 10, x + 55, yToeBox + 12); ctx.stroke();
    }
    // Cordones: cruzados sobre el empeine, con ojales oscuros
    ctx.fillStyle = '#141419'; ctx.fillRect(cx - 44, yToeBox, 88, yCollar - yToeBox);
    ctx.strokeStyle = '#ECEAE4'; ctx.lineWidth = 5;
    const nL = 5, stepL = (yCollar - yToeBox) / (nL + 0.5);
    for (let i = 0; i < nL; i++) {
      const y0 = yToeBox + 8 + i * stepL;
      ctx.beginPath(); ctx.moveTo(cx - 38, y0); ctx.lineTo(cx + 38, y0 + stepL * 0.55); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + 38, y0); ctx.lineTo(cx - 38, y0 + stepL * 0.55); ctx.stroke();
      ctx.fillStyle = '#0B0B0E'; ctx.beginPath(); ctx.arc(cx - 42, y0, 3, 0, PI * 2); ctx.arc(cx + 42, y0, 3, 0, PI * 2); ctx.fill();
    }
    // Talón: contrafuerte con logo pequeño
    ctx.fillStyle = shoeMid; ctx.fillRect(0, yCollar, W, ZR[1] - yCollar);
    ctx.fillStyle = trim; ctx.fillRect(cx - 5, yCollar + 4, 10, ZR[1] - yCollar - 8);
    // ---------- Suela: crema con entresuela del color del equipo y dibujo de la banda de rodadura
    const SO = REG.sole;
    ctx.fillStyle = '#EFEBE2'; ctx.fillRect(0, SO[0], W, SO[1] - SO[0]);
    ctx.fillStyle = trim; ctx.fillRect(W * 0.3, SO[0], W * 0.12, SO[1] - SO[0]); ctx.fillRect(W * 0.58, SO[0], W * 0.12, SO[1] - SO[0]);
    ctx.fillStyle = '#C9C4B8'; ctx.fillRect(0, SO[0], W * 0.12, SO[1] - SO[0]); ctx.fillRect(W * 0.88, SO[0], W * 0.12, SO[1] - SO[0]);
    ctx.fillStyle = '#A9A49A'; for (let y = SO[0] + 2; y < SO[1]; y += 4) { ctx.fillRect(0, y, W * 0.12, 1); ctx.fillRect(W * 0.88, y, W * 0.12, 1); }

    // ---------- Pelo: textura según el peinado (u = ángulo, v = de la coronilla al borde)
    const HREG = REG.hair, hh = HREG[1] - HREG[0];
    const hairBase = style === 'rapado' ? mix(hair, skin, 0.3) : hair;
    ctx.fillStyle = hairBase; ctx.fillRect(0, HREG[0], W, hh);
    if (style === 'corto' || style === 'rulos') {
      // corto: mechones cortos y apelmazados (no vetas largas que converjan en la coronilla)
      for (let i = 0; i < 1500; i++) {
        const x = r() * W, y = HREG[0] + r() * hh, l = 3 + r() * 6, a = (r() - 0.5) * (style === 'rulos' ? 6 : 1.2);
        ctx.strokeStyle = rgba(i % 3 ? shade(hair, -0.45) : shade(hair, 0.38), 0.18 + r() * 0.25); ctx.lineWidth = 1 + r() * 1.5;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.sin(a) * l, y + Math.cos(a) * l * 0.5); ctx.stroke();
      }
    } else {
      for (let i = 0; i < 420; i++) {
        const x = r() * W, w = 1 + r() * 2.5, a = 0.12 + r() * 0.3;
        ctx.fillStyle = rgba(i % 3 ? shade(hair, -0.45) : shade(hair, 0.35), a);
        ctx.fillRect(x, HREG[0], w, hh);
      }
    }
    g = ctx.createLinearGradient(0, HREG[0], 0, HREG[1]);
    g.addColorStop(0, rgba(shade(hair, 0.3), 0.2)); g.addColorStop(0.5, rgba(hair, 0)); g.addColorStop(1, rgba(shade(hair, -0.4), 0.3));
    ctx.fillStyle = g; ctx.fillRect(0, HREG[0], W, hh);
    // ---------- Muestras
    const sw = (s, color) => { ctx.fillStyle = color; ctx.fillRect(s[0], s[2], s[1] - s[0], s[3] - s[2]); };
    sw(SW.upperArm, skin); sw(SW.forearm, skin); sw(SW.hand, skin);
    g = ctx.createLinearGradient(0, SW.upperArm[2], 0, SW.upperArm[3]);
    g.addColorStop(0, rgba(skinD, 0.25)); g.addColorStop(0.5, rgba(skinD, 0)); g.addColorStop(1, rgba(skinD, 0));
    ctx.fillStyle = g; ctx.fillRect(0, SW.upperArm[2], W, 30);
    {
      const sD = skinD;
      ctx.save(); ctx.beginPath(); ctx.rect(0, SW.upperArm[2], SW.forearm[1], 30); ctx.clip();
      blob(85, SW.upperArm[2] + 15, 70, 40, sD, 0.24); blob(340 + 85, SW.upperArm[2] + 15, 70, 40, sD, 0.2);
      ctx.restore();
    }
    sw(SW.hair, style === 'rapado'  ? mix(hair, skin, 0.3) : hair); sw(SW.trim, trim); sw(SW.jersey, jersey); sw(SW.white, '#F1F0EB'); sw(SW.dark, '#22222A');
    ctx.restore();
  }

  // Mapa de rugosidad (un cuarto de resolución): gris = rugosidad
  function paintRoughness(ctx, L) {
    const s = 0.25, W = ATLAS * s;
    const fill = (reg, v) => { ctx.fillStyle = `rgb(${v * 255},${v * 255},${v * 255})`; ctx.fillRect(0, reg[0] * s, W, (reg[1] - reg[0]) * s); };
    const fillSw = (sw, v) => { ctx.fillStyle = `rgb(${v * 255},${v * 255},${v * 255})`; ctx.fillRect(sw[0] * s, sw[2] * s, (sw[1] - sw[0]) * s, (sw[3] - sw[2]) * s); };
    fill([0, ATLAS], 0.8);
    fill(REG.head, L.style === 'pelado' ? 0.5 : 0.62);
    fill(REG.torso, 0.88); fill(REG.pelvis, 0.9); fill(REG.thigh, 0.78); fill(REG.shin, 0.8); fill(REG.shoe, 0.42); fill(REG.sole, 0.65); fill(REG.hair, 0.55);
    fillSw(SW.upperArm, 0.62); fillSw(SW.forearm, 0.62); fillSw(SW.hand, 0.64);
    fillSw(SW.hair, 0.55); fillSw(SW.trim, 0.85); fillSw(SW.jersey, 0.9); fillSw(SW.white, 0.9); fillSw(SW.dark, 0.45);
  }

  // Mapa de normales (mitad de resolución) a partir de un mapa de alturas pintado en canvas:
  // trama de la tela, pliegues del short y de la camiseta, medias acanaladas, costuras y cordones
  // de la zapatilla, poros de la piel. Las muestras planas (pelo, manos...) quedan lisas.
  const NM = 512;
  function paintNormal(ctx, L, rings) {
    const s = NM / ATLAS, W = NM;
    const r = rng(L.seed ^ 0x3c6e);
    ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, W);
    const reg = (R) => [R[0] * s, R[1] * s];
    const weave = (R, amp, period) => {
      const [y0, y1] = reg(R);
      ctx.fillStyle = `rgba(255,255,255,${amp})`;
      for (let y = y0; y < y1; y += period) ctx.fillRect(0, y, W, 1);
      for (let x = 0; x < W; x += period) ctx.fillRect(x, y0, 1, y1 - y0);
    };
    const folds = (R, n, amp, wid) => {
      const [y0, y1] = reg(R);
      for (let i = 0; i < n; i++) {
        const x = r() * W, ph = r() * 6.28, len = (0.5 + r() * 0.5) * (y1 - y0), top = y0 + r() * (y1 - y0 - len);
        for (let k = 0; k < 2; k++) {
          const g = ctx.createLinearGradient(x - wid, 0, x + wid, 0);
          g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.3, `rgba(0,0,0,${amp})`); g.addColorStop(0.5, `rgba(255,255,255,${amp})`); g.addColorStop(0.8, `rgba(0,0,0,${amp * 0.5})`); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.save(); ctx.translate(x, top); ctx.rotate(Math.sin(ph) * 0.12); ctx.fillRect(-wid, 0, wid * 2, len); ctx.restore();
        }
      }
    };
    const grain = (R, n, a) => { const [y0, y1] = reg(R); for (let i = 0; i < n; i++) { ctx.fillStyle = `rgba(${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},${a})`; ctx.fillRect(r() * W, y0 + r() * (y1 - y0), 1, 1); } };
    // piel: poros
    grain(REG.head, 5000, 0.08);
    // camiseta: trama + pliegues suaves en la cintura y bajo las sisas
    weave(REG.torso, 0.035, 2); folds(REG.torso, 10, 0.22, 7);
    // short: trama y pliegues verticales marcados; cintura elástica (surcos)
    weave(REG.pelvis, 0.035, 2); folds(REG.pelvis, 12, 0.22, 12);
    const [p0] = reg(REG.pelvis); ctx.fillStyle = 'rgba(0,0,0,.3)'; for (let x = 0; x < W; x += 6) ctx.fillRect(x, p0, 2, 3);
    const thv = rings.thigh.v, thn = rings.thigh.names, THR = REG.thigh;
    const yHem = rowOf(THR, thv[thn.indexOf('hem')]) * s;
    weave([THR[0], yHem / s], 0.035, 2); folds([THR[0], yHem / s], 9, 0.22, 12);
    ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillRect(0, yHem - 3, W, 2); ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, yHem - 1, W, 1);
    // piel del cuello, hombros y sisas: lisa (mismos escotes que en el atlas)
    const tv = rings.torso.v, tn = rings.torso.names, TR = REG.torso;
    const trow = (name) => rowOf(TR, tv[tn.indexOf(name)]) * s;
    const topY = trow('neckBase') - 1, yPecs = trow('pecs'), yShoulders = trow('shoulders'), yChest = trow('chest');
    ctx.fillStyle = '#808080'; ctx.fillRect(0, TR[0] * s, W, topY - TR[0] * s);
    const scoop = (x0, halfW, top, depth) => { ctx.beginPath(); ctx.moveTo(x0 - halfW, top - 2); ctx.bezierCurveTo(x0 - halfW * 0.95, top + depth * 1.15, x0 + halfW * 0.95, top + depth * 1.15, x0 + halfW, top - 2); ctx.closePath(); ctx.fill(); };
    scoop(W / 2, 59, topY, yPecs - topY); scoop(0, 45, topY, (trow('shTop') - topY) * 1.05); scoop(W, 45, topY, (trow('shTop') - topY) * 1.05); scoop(W * 0.25, 50, topY, yChest - topY); scoop(W * 0.75, 50, topY, yChest - topY);
    // pelo: mechones (surcos verticales irregulares)
    const [h0, h1] = reg(REG.hair);
    for (let i = 0; i < 160; i++) { ctx.fillStyle = `rgba(${i % 2 ? 255 : 0},${i % 2 ? 255 : 0},${i % 2 ? 255 : 0},${0.25 + r() * 0.35})`; const x = r() * W; ctx.fillRect(x, h0, 1, h1 - h0); }
    // medias: acanaladas (líneas verticales finas) y puño
    const sv = rings.shin.v, sn = rings.shin.names, SR = REG.shin;
    const ySock = rowOf(SR, sv[sn.indexOf('sockTop')]) * s;
    ctx.fillStyle = 'rgba(255,255,255,.35)'; for (let x = 0; x < W; x += 3) ctx.fillRect(x, ySock, 1, SR[1] * s - ySock);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; for (let y = ySock; y < ySock + 6; y += 2) ctx.fillRect(0, y, W, 1);
    // zapatilla: puntera de goma (surcos), ojales y cordones en relieve, costura del talón
    const zv = rings.shoe.v, zn = rings.shoe.names, ZR = REG.shoe;
    const zrow = (name) => rowOf(ZR, zv[zn.indexOf(name)]) * s;
    const yToe = zrow('toe'), yToeBox = zrow('toeBox'), yCollar = zrow('collar');
    ctx.fillStyle = 'rgba(0,0,0,.5)'; for (let x = 0; x < W; x += 5) ctx.fillRect(x, ZR[0] * s, 2, yToe - ZR[0] * s);
    ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(0, yToe - 1, W, 2);
    ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    const nL = 5, stepL = (yCollar - yToeBox) / (nL + 0.5), cx = W / 2;
    for (let i = 0; i < nL; i++) { const y0 = yToeBox + 4 + i * stepL; ctx.beginPath(); ctx.moveTo(cx - 19, y0); ctx.lineTo(cx + 19, y0 + stepL * 0.55); ctx.moveTo(cx + 19, y0); ctx.lineTo(cx - 19, y0 + stepL * 0.55); ctx.stroke(); }
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, yCollar - 1, W, 2);
    // suela: banda de rodadura
    const [s0, s1] = reg(REG.sole);
    ctx.fillStyle = 'rgba(0,0,0,.6)'; for (let y = s0 + 1; y < s1; y += 3) ctx.fillRect(0, y, W, 1);
  }
  // Convierte el mapa de alturas (canal R) en un mapa de normales tangentes (Sobel)
  function heightToNormal(canvas, strength) {
    const W = canvas.width, H = canvas.height, ctx = canvas.getContext('2d');
    const src = ctx.getImageData(0, 0, W, H), d = src.data;
    const out = ctx.createImageData(W, H), o = out.data;
    const h = (x, y) => d[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = (h(x + 1, y - 1) + 2 * h(x + 1, y) + h(x + 1, y + 1)) - (h(x - 1, y - 1) + 2 * h(x - 1, y) + h(x - 1, y + 1));
      const dy = (h(x - 1, y + 1) + 2 * h(x, y + 1) + h(x + 1, y + 1)) - (h(x - 1, y - 1) + 2 * h(x, y - 1) + h(x + 1, y - 1));
      let nx = -dx * strength, ny = dy * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const i = (y * W + x) * 4;
      o[i] = (nx * 0.5 + 0.5) * 255; o[i + 1] = (ny * 0.5 + 0.5) * 255; o[i + 2] = (nz * 0.5 + 0.5) * 255; o[i + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
    return canvas;
  }

  // Caché de texturas por aspecto (comparten jugadores iguales)
  const texCache = new Map();
  function lookKey(L, rival) {
    return [L.colors[0], L.colors[1], L.skin, L.hair, L.style, L.beard, rival, L.num, L.name, L.body].join('|');
  }
  function getTextures(L, rival, rings, headRingsDef) {
    const key = lookKey(L, rival);
    let e = texCache.get(key);
    if (e) { e.refs++; return e; }
    const c = document.createElement('canvas'); c.width = c.height = ATLAS;
    paintAtlas(c.getContext('2d'), L, rival, rings, headRingsDef);
    const map = new T.CanvasTexture(c);
    map.colorSpace = T.SRGBColorSpace; map.anisotropy = 4;
    const rc = document.createElement('canvas'); rc.width = rc.height = ATLAS / 4;
    paintRoughness(rc.getContext('2d'), L);
    const rough = new T.CanvasTexture(rc);
    const nc = document.createElement('canvas'); nc.width = nc.height = NM;
    paintNormal(nc.getContext('2d'), L, rings);
    const normal = new T.CanvasTexture(heightToNormal(nc, 1.6));
    normal.anisotropy = 4;
    e = { key, map, rough, normal, refs: 1 };
    texCache.set(key, e);
    if (texCache.size > 48) {
      for (const [k2, e2] of texCache) { if (e2.refs <= 0) { e2.map.dispose(); e2.rough.dispose(); e2.normal.dispose(); texCache.delete(k2); if (texCache.size <= 36) break; } }
    }
    return e;
  }
  function releaseTextures(e) { if (e) e.refs--; }

  // ------------------------------------------------------------------ Cinemática inversa de 2 huesos
  // Orienta `upper` (hueso que cuelga a lo largo de -y local) y dobla `lower` (rotación x) para que
  // el extremo quede en `target` (coordenadas del padre de `upper`). `hint` dice hacia dónde se
  // desplaza la articulación intermedia (codo atrás, rodilla adelante). Devuelve el defecto de alcance.
  const _t = new T.Vector3(), _h = new T.Vector3(), _u = new T.Vector3(), _z = new T.Vector3(), _x = new T.Vector3(), _y = new T.Vector3(), _m = new T.Matrix4();
  function solveLimb(upper, lower, target, hint, L1, L2) {
    _t.copy(target).sub(upper.position);
    let d = _t.length();
    if (d < 1e-4) { _t.set(0, -1, 0); d = 1; }
    const dc = clamp(d, Math.abs(L1 - L2) + 0.2, L1 + L2 - 0.02);
    _t.normalize();
    _h.copy(hint).addScaledVector(_t, -hint.dot(_t));
    if (_h.lengthSq() < 1e-6) { _h.set(0, 0, -1).addScaledVector(_t, _t.z); if (_h.lengthSq() < 1e-6) _h.set(1, 0, 0); }
    _h.normalize();
    const bend = Math.PI - Math.acos(clamp((L1 * L1 + L2 * L2 - dc * dc) / (2 * L1 * L2), -1, 1));
    const alpha = Math.acos(clamp((L1 * L1 + dc * dc - L2 * L2) / (2 * L1 * dc), -1, 1));
    _u.copy(_t).multiplyScalar(Math.cos(alpha)).addScaledVector(_h, Math.sin(alpha));
    _y.copy(_u).negate();
    _z.copy(_t).multiplyScalar(Math.sin(alpha)).addScaledVector(_h, -Math.cos(alpha)).normalize();
    _x.crossVectors(_y, _z).normalize();
    _m.makeBasis(_x, _y, _z);
    upper.quaternion.setFromRotationMatrix(_m);
    lower.rotation.set(-bend, 0, 0);
    return d - dc;
  }

  // ------------------------------------------------------------------ Poses
  // Canales numéricos (se mezclan linealmente en la transición). Espacio del jugador: pies en el
  // origen, mira a +z, su derecha es −x. Ángulos en grados.
  //   hips: x, y, z (desplazamiento), lean (+ adelante), twist, tilt · spineX/Y · chestX · neckX/Y/Z · headX/Z
  //   armR/L: wx, wy, wz (muñeca), hx, hy, hz (hacia dónde va el codo), flex (muñeca: + dedos hacia la palma),
  //           twist (giro sobre el antebrazo), dev (desviación lateral)
  //   legR/L: ax, ay, az (tobillo), kx, ky, kz (hacia dónde va la rodilla), toe (+ punta hacia abajo)
  const CH = ['hips.x', 'hips.y', 'hips.z', 'hips.lean', 'hips.twist', 'hips.tilt', 'spineX', 'spineY', 'spineZ', 'chestX', 'neckX', 'neckY', 'neckZ', 'headX', 'headZ'];
  for (const a of ['armR', 'armL']) for (const c of ['wx', 'wy', 'wz', 'hx', 'hy', 'hz', 'flex', 'twist', 'dev']) CH.push(a + '.' + c);
  for (const l of ['legR', 'legL']) for (const c of ['ax', 'ay', 'az', 'kx', 'ky', 'kz', 'toe']) CH.push(l + '.' + c);
  function blank() { const P = {}; for (const k of CH) P[k] = 0; return P; }
  function set(P, prefix, vals) { for (const k in vals) P[prefix + '.' + k] = vals[k]; }
  // s = -1 derecha, +1 izquierda. wrist/hint en espacio del jugador.
  function arm(P, s, wrist, hint, flex, twist, dev) {
    set(P, s < 0 ? 'armR' : 'armL', { wx: wrist[0], wy: wrist[1], wz: wrist[2], hx: hint[0], hy: hint[1], hz: hint[2], flex: flex || 0, twist: twist || 0, dev: dev || 0 });
  }
  function leg(P, s, ankle, hint, toe) {
    toe = toe || 0;
    // con la punta hacia abajo el tobillo sube (el pie gira sobre la punta, que queda en el piso)
    const lift = toe > 0 ? 5.2 * Math.sin(toe * DEG) : 0;
    set(P, s < 0 ? 'legR' : 'legL', { ax: ankle[0], ay: ankle[1] + lift, az: ankle[2], kx: hint[0], ky: hint[1], kz: hint[2], toe });
  }
  const SH_Y = 25.2 + 3.3 + 6.0 + 3.5;   // altura del hombro de pie (38)
  const ANK = 2.9;                       // altura del tobillo con el pie apoyado
  const R = -1, Lf = 1;

  const POSE_FN = {
    // Parado con el peso en la pierna izquierda (contrapposto), respiración y mirada que recorre
    idle(P, t, M) {
      const br = Math.sin(t * 2.2), sw = Math.sin(t * 0.9), sx = M.shoulder.x;
      set(P, 'hips', { x: 1.3 + 0.3 * sw, y: -0.7 + 0.2 * br, lean: 3 + 0.5 * br, tilt: -3.5, twist: -4 });
      P.spineZ = 3; P.spineY = 2; P.chestX = -2 + 1.2 * br; P.neckX = -3; P.neckY = 8 * Math.sin(t * 0.7); P.headZ = 2 * Math.sin(t * 0.5);
      // brazos relajados a los costados, un poco separados, palmas hacia los muslos
      arm(P, R, [-(sx + 3.2), SH_Y - 17.2 + 0.3 * br, 2.4 + 0.3 * sw], [-0.7, 0, -1], 12, 70, 6);
      arm(P, Lf, [sx + 2.6, SH_Y - 17.6 + 0.3 * br, 1.6 - 0.3 * sw], [0.7, 0, -1], 12, -70, -6);
      // pierna derecha libre, un poco adelante y hacia afuera con la rodilla apenas flexionada
      leg(P, R, [-6.8, ANK, 1.8], [-0.35, 0, 1]);
      leg(P, Lf, [4.2, ANK, -0.4], [0.15, 0, 1]);
    },
    // Carrera: zancada larga, rodilla alta, brazos opuestos a 90°, tronco inclinado y rebote
    run(P, t, M) {
      const c = (t / 0.55) * Math.PI * 2, sx = M.shoulder.x;
      const hy = -3.2 + 1.4 * Math.abs(Math.sin(c)), lean = 15;
      set(P, 'hips', { y: hy, lean, twist: 7 * Math.sin(c), tilt: 2.5 * Math.sin(c) });
      P.chestX = -3; P.neckX = -12; P.spineY = -6 * Math.sin(c); P.spineX = 3;
      const shy = SH_Y + hy - 12.8 * (1 - Math.cos(lean * DEG)), shz = 12.8 * Math.sin(lean * DEG) + 0.2;
      for (const s of [R, Lf]) {
        const p = c + (s > 0 ? Math.PI : 0);
        const swing = Math.max(0, -Math.sin(p - 0.35));                // 1 en mitad del vuelo
        const heel = Math.max(0, -Math.sin(p + 0.5));                  // talón atrás al despegar
        leg(P, s, [s * 4.4, ANK + swing * swing * 10.0 + heel * 2.4, 12.5 * Math.cos(p) - 1.0], [s * 0.1, 0.1, 1], 28 * heel - 10 * swing);
        // brazos opuestos: péndulo desde el hombro con el codo a ~90°, puños semicerrados
        const a = -Math.cos(p) * 52 * DEG;
        arm(P, s, [s * (sx + 2.2), shy - 9 * Math.cos(a) + 6.5 * Math.sin(a) - 2.6, shz + 9 * Math.sin(a) + 8.8 * Math.cos(a) - 1.2], [s * 0.55, 0.05, -1], 55, -s * 70, 0);
      }
    },
    // Defensa (se ve de frente a la cámara): postura atlética baja, pies algo más anchos que los
    // hombros, una mano arriba que tapa el tiro y la otra baja y abierta que niega el pase; vaivén
    guard(P, t) {
      const sw = Math.sin(t * 2.6), bob = Math.sin(t * 5.2);
      set(P, 'hips', { y: -3.4 + 0.3 * bob, x: 2.0 * sw, lean: 19, tilt: -2.5 * sw, twist: 4 * sw - 5 });
      P.chestX = -5; P.neckX = -15; P.neckY = 5 * sw; P.spineY = 4;
      arm(P, R, [-11.5 - 0.6 * sw, SH_Y + 1.5 + 0.5 * bob, 12.5], [-0.8, -0.8, -0.3], -30, -20, 8);
      arm(P, Lf, [16.5 - 0.6 * sw, SH_Y - 13.5, 8.5], [0.5, -0.4, -1], -22, 40, -12);
      leg(P, R, [-8.2 + 1.2 * sw, ANK, 2.6], [-0.35, 0, 1]);
      leg(P, Lf, [8.4 + 1.2 * sw, ANK, -1.8], [0.35, 0, 1]);
    },
    // Pique (se ve de espaldas): parado atlético, casi erguido, pies al ancho de los hombros y
    // alternados; la mano derecha empuja la pelota y el cuerpo acompaña bajando; el brazo izquierdo
    // va flexionado delante del cuerpo para protegerla; la cabeza mira al frente
    dribble(P, t) {
      const b = 0.5 + 0.5 * Math.cos((t / 0.5) * Math.PI * 2); // 1 = mano arriba, 0 = mano abajo
      const d = 1 - b;                                           // el cuerpo acompaña el empuje hacia abajo
      set(P, 'hips', { x: -0.5, y: -2.4 - d * 3.2, lean: 11 + d * 7, twist: -8, tilt: 1.5 + d * 8 });
      P.chestX = -2 - d * 4; P.neckX = -8 - d * 4; P.neckY = 5; P.neckZ = -(1 + d * 6); P.spineX = 2 + d * 13; P.spineY = -3; P.spineZ = 1 + d * 11;
      arm(P, R, [-8.2, 6.6 + b * 17.0, 9.6 - d * 1.2], [-0.9, 0.3, -1], 50 - b * 22, 180, 0);
      arm(P, Lf, [7.4, 26.5 - d * 2.5, 9.0], [0.9, -0.7, -0.5], 14, -50, -12);
      leg(P, R, [-5.2, ANK, -3.0], [-0.12, 0, 1]);
      leg(P, Lf, [5.0, ANK, 4.4], [0.1, 0, 1]);
    },
    // Pase de pecho: paso adelante con la izquierda, brazos extendidos al frente con las palmas afuera
    pass(P) {
      set(P, 'hips', { y: -2.4, lean: 12 });
      P.chestX = 1; P.neckX = -8;
      arm(P, R, [-5.6, SH_Y - 7.5, 17.5], [-1, -0.35, 0], -18, 0, 12);
      arm(P, Lf, [5.6, SH_Y - 7.5, 17.5], [1, -0.35, 0], -18, 0, -12);
      leg(P, R, [-5.5, ANK, -5], [-0.1, 0, 1], 16);
      leg(P, Lf, [5.5, ANK, 10], [0.1, 0, 1]);
    },
    // Recibir: manos abiertas a la altura de la cabeza como blanco para el pase, codos flexionados,
    // rodillas blandas y un pie adelantado; mirada a la pelota
    catch(P) {
      set(P, 'hips', { y: -2.2, lean: 6, twist: 5 });
      P.chestX = -6; P.neckX = -10; P.spineY = -3;
      arm(P, R, [-8.2, SH_Y + 5.0, 9.5], [-1, -0.5, -0.5], -30, 0, 8);
      arm(P, Lf, [8.6, SH_Y + 3.6, 10.5], [1, -0.5, -0.5], -30, 0, -8);
      leg(P, R, [-6.0, ANK, -1.6], [-0.25, 0, 1]);
      leg(P, Lf, [5.8, ANK, 3.0], [0.2, 0, 1]);
    },
    // Tiro: cuerpo estirado, brazo derecho arriba con la muñeca quebrada, mano guía al costado
    shoot(P, t, M, J) {
      const air = clamp((J || 0) / 6, 0, 1);
      set(P, 'hips', { y: 0, lean: -4, twist: -7 });
      P.chestX = -5; P.neckX = -22; P.neckY = 3;
      arm(P, R, [-3.0, SH_Y + 16.4, 5.6], [-0.15, 0.25, 1], 78, 180, 0);
      arm(P, Lf, [6.0, SH_Y + 11.0, 8.6], [1, 0.3, 0.3], 12, 0, -22);
      leg(P, R, [-4.6, ANK + air * 6, 0.8 + air * 2.5], [-0.1, 0, 1], 38 * air);
      leg(P, Lf, [4.8, ANK + air * 4.5, -1 - air * 2.5], [0.1, 0, 1], 48 * air);
    },
    // Festejo: puño derecho al cielo, el izquierdo apretado a la altura de la cabeza, pecho arriba
    // y saltitos (los brazos bombean con el salto)
    celebrate(P, t) {
      const j = Math.max(0, Math.sin((t / 0.62) * Math.PI * 2));
      set(P, 'hips', { y: j * 4.5, lean: -8, tilt: 3, twist: 6 });
      P.chestX = -8; P.neckX = -20; P.spineZ = -3;
      arm(P, R, [-9.5, SH_Y + 15.8 + j * 0.8, 1.5], [-1, 0.2, -0.5], 50, 170, 0);
      arm(P, Lf, [12.5, SH_Y + 6.5 + j * 3.5, 3.5], [1, -0.6, -0.4], 55, -150, 0);
      leg(P, R, [-6.0, ANK + j * 3.5, -0.5 - j], [-0.2, 0, 1], 25 * j);
      leg(P, Lf, [6.2, ANK + j * 3.5, 0.6 - j], [0.2, 0, 1], 25 * j);
    },
    // Robo: estocada larga hacia adelante, brazo derecho extendido bajo, izquierdo atrás para equilibrar
    steal(P) {
      set(P, 'hips', { y: -7.5, lean: 30, twist: -14 });
      P.chestX = 2; P.neckX = -24; P.spineY = -6;
      arm(P, R, [-6, 17.5, 25.5], [-0.6, -1, 0], -18, 180, 0);
      arm(P, Lf, [14, 30, -9], [1, -0.3, -0.4], 12, -60, 0);
      leg(P, R, [-8, ANK, 15], [-0.2, 0, 1]);
      leg(P, Lf, [6, ANK, -12], [0.2, 0, 1], 30);
    },
    // Lamento: cabeza baja, hombros caídos, brazos colgando, balanceo lento
    sad(P, t) {
      const br = Math.sin(t * 1.6);
      set(P, 'hips', { y: -1.2, lean: 10, tilt: 2.5, twist: 3 });
      P.chestX = 14; P.neckX = 28; P.headX = 8; P.neckY = 4 * br; P.spineZ = -2;
      arm(P, R, [-8.0, 19.5 + 0.2 * br, 4.0], [-0.8, 0, -1], 18, 60, 10);
      arm(P, Lf, [8.2, 19.8 + 0.2 * br, 3.6], [0.8, 0, -1], 18, -60, -10);
      leg(P, R, [-3.8, ANK, 0.4], [-0.05, 0, 1]);
      leg(P, Lf, [4.3, ANK, -0.3], [0.1, 0, 1]);
    },
  };

  function evalPose(name, t, M, jump) { const P = blank(); (POSE_FN[name] || POSE_FN.idle)(P, t, M, jump); return P; }
  function blendPose(A, B, k) { const P = {}; for (const key of CH) P[key] = A[key] + (B[key] - A[key]) * k; return P; }

  // ------------------------------------------------------------------ Geometrías/materiales compartidos
  let starGeo = null, starMat = null;
  function getStar() {
    if (!starGeo) {
      const sh = new T.Shape();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 1.5 : 3.4, a = Math.PI / 2 + i * Math.PI / 5; sh[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); }
      sh.closePath();
      const s1 = new T.ExtrudeGeometry(sh, { depth: 0.7, bevelEnabled: true, bevelThickness: 0.2, bevelSize: 0.2, bevelSegments: 1 });
      s1.center();
      const s2 = s1.clone(); s2.rotateY(Math.PI / 2);
      s1.setAttribute('uv', new T.Float32BufferAttribute(new Float32Array(s1.attributes.position.count * 2), 2));
      s2.setAttribute('uv', new T.Float32BufferAttribute(new Float32Array(s2.attributes.position.count * 2), 2));
      // dos estrellas cruzadas: desde cualquier ángulo se lee la silueta
      starGeo = merge([toIndexed(s1), toIndexed(s2)]);
      starGeo.deleteAttribute('skinIndex'); starGeo.deleteAttribute('skinWeight');
      starMat = new T.MeshStandardMaterial({ color: 0xFFC53D, emissive: 0xE09A10, emissiveIntensity: 0.7, roughness: 0.35, metalness: 0.4 });
    }
    return { geo: starGeo, mat: starMat };
  }
  let ringGeo = null;
  function getRingGeo() { if (!ringGeo) { ringGeo = new T.RingGeometry(9.6, 12.0, 48); ringGeo.rotateX(-Math.PI / 2); } return ringGeo; }
  let depthMat = null;
  function getDepthMat() { if (!depthMat) depthMat = new T.MeshBasicMaterial({ colorWrite: false }); return depthMat; }

  // ------------------------------------------------------------------ Jugador
  const _q = new T.Quaternion(), _q2 = new T.Quaternion(), _mi = new T.Matrix4(), _v = new T.Vector3(), _hv = new T.Vector3(), _hw = new T.Vector3();
  const _ee = new T.Euler();
  class Player {
    constructor(look, opts) {
      opts = opts || {};
      this.rival = !!opts.rival;
      this.object = new T.Group();
      this.object.name = 'jugador';
      this.pose = 'idle'; this.prevPose = null; this.poseT0 = -1e9;
      this.jump = 0; this.alpha = 1; this.ringMesh = null; this.starMesh = null; this.ringColor = null; this.starScale = 1;
      this.facing = 0;
      this.lastNow = 0;
      this._build(look);
    }
    _build(look) {
      const L = this.L = defaults(look);
      const body = buildBody(L);
      this.bones = body.bones; this.B = body.B; this.M = body.M;
      body.bones[0].updateMatrixWorld(true);
      const geos = body.parts.map((p) => { const g = p.geo; g.applyMatrix4(p.bone.matrixWorld); return g; });
      const geo = merge(geos);
      geos.forEach((g) => g.dispose());
      const tex = this.tex = getTextures(L, this.rival, body.rings, body.rings.headDef);
      const mat = this.mat = new T.MeshStandardMaterial({ map: tex.map, roughnessMap: tex.rough, normalMap: tex.normal, normalScale: new T.Vector2(0.7, 0.7), roughness: 1, metalness: 0 });
      const mesh = this.mesh = new T.SkinnedMesh(geo, mat);
      mesh.add(body.bones[0]);
      const skeleton = new T.Skeleton(body.bones);
      mesh.bind(skeleton);
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
      mesh.name = 'cuerpo';
      this.object.add(mesh);
      // Pre-pasada de profundidad para los fantasmas (alpha < 1): evita que se vean las partes de atrás
      const dm = this.depthMesh = new T.SkinnedMesh(geo, getDepthMat());
      dm.bind(skeleton, mesh.bindMatrix); dm.frustumCulled = false; dm.visible = false; dm.castShadow = false; dm.receiveShadow = false;
      dm.renderOrder = -1; dm.name = 'profundidad';
      this.object.add(dm);
      this.object.scale.setScalar(L.h);
      // Punto de la mano (centro de la palma, un poco hacia los dedos)
      this.handPts = {};
      for (const s of ['R', 'L']) { const o = new T.Object3D(); o.position.set(0, -3.1, 0.9); this.B['wrist' + s].add(o); this.handPts[s] = o; }
      this.setStar(L.star);
      this.setAlpha(this.alpha);
      if (this.ringColor) this.setRing(this.ringColor);
      this.mesh.position.y = this.jump / L.h; dm.position.y = this.mesh.position.y;
      this.update(this.lastNow || 0);
    }
    setLook(look) {
      const star = this.L.star || (look && look.star);
      this._teardown();
      this._build(Object.assign({}, look, { star: star && (look == null || look.star !== false) }));
      return this;
    }
    _teardown() {
      if (this.mesh) {
        this.object.remove(this.mesh); this.object.remove(this.depthMesh);
        this.mesh.geometry.dispose(); this.mat.dispose(); this.mesh.skeleton.dispose(); releaseTextures(this.tex); this.mesh = null; this.depthMesh = null;
      }
      if (this.starMesh) { this.object.remove(this.starMesh); this.starMesh = null; }
    }
    dispose() {
      this._teardown();
      if (this.ringMesh) { this.object.remove(this.ringMesh); this.ringMesh.material.dispose(); this.ringMesh = null; }
      if (this.object.parent) this.object.parent.remove(this.object);
    }
    setCourtPosition(x, y) { this.object.position.set(x - 180, 0, y - 300); return this; }
    setWorldPosition(v) { this.object.position.copy(v); return this; }
    faceCourt(x, y) {
      const dx = (x - 180) - this.object.position.x, dz = (y - 300) - this.object.position.z;
      if (dx * dx + dz * dz > 1e-6) this.setFacing(Math.atan2(dx, dz));
      return this;
    }
    setFacing(a) { this.facing = a; this.object.rotation.y = a; return this; }
    setPose(pose) {
      if (!POSE_FN[pose] || pose === this.pose) return this;
      this.prevPose = this.pose; this.pose = pose; this.poseT0 = this.lastNow;
      return this;
    }
    setJump(h) { this.jump = Math.max(0, h || 0); if (this.mesh) { this.mesh.position.y = this.jump / this.L.h; this.depthMesh.position.y = this.mesh.position.y; } return this; }
    setRing(color) {
      this.ringColor = color || null;
      if (!color) { if (this.ringMesh) { this.object.remove(this.ringMesh); this.ringMesh.material.dispose(); this.ringMesh = null; } return this; }
      if (!this.ringMesh) {
        this.ringMesh = new T.Mesh(getRingGeo(), new T.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false, side: T.DoubleSide, toneMapped: false }));
        this.ringMesh.position.y = 0.4; this.ringMesh.renderOrder = 2;
        this.ringMesh.scale.setScalar(1 / this.L.h);
        this.object.add(this.ringMesh);
      } else this.ringMesh.material.color.set(color);
      return this;
    }
    setStar(on) {
      this.L.star = !!on;
      if (!on) { if (this.starMesh) { this.object.remove(this.starMesh); this.starMesh = null; } return this; }
      if (!this.starMesh) {
        const s = getStar();
        this.starMesh = new T.Mesh(s.geo, s.mat);
        this.starMesh.position.y = HEIGHT + 7; this.starMesh.castShadow = false;
        this.object.add(this.starMesh);
      }
      return this;
    }
    setAlpha(a) {
      this.alpha = clamp(a == null ? 1 : a, 0, 1);
      if (this.mat) {
        const ghost = this.alpha < 1;
        this.mat.transparent = ghost; this.mat.opacity = this.alpha; this.mat.depthWrite = !ghost; this.mat.needsUpdate = true;
        this.depthMesh.visible = ghost;
        this.mesh.castShadow = this.alpha > 0.6;
      }
      if (this.starMesh) this.starMesh.visible = this.alpha > 0.6;
      return this;
    }
    handWorld(side) {
      const s = side === 'izquierda' ? 'L' : 'R';
      this.object.updateMatrixWorld(true);
      return this.handPts[s].getWorldPosition(new T.Vector3());
    }
    // Aplica un conjunto de canales a los huesos (IK en brazos y piernas, pies planos y apoyados).
    _apply(P) {
      const B = this.B, M = this.M;
      const hips = B.hips, spine = B.spine, chest = B.chest;
      let hy = M.hipY + P['hips.y'];
      hips.position.set(P['hips.x'], hy, P['hips.z']);
      hips.rotation.set(P['hips.lean'] * DEG, P['hips.twist'] * DEG, P['hips.tilt'] * DEG);
      spine.rotation.set(P.spineX * DEG, P.spineY * DEG, P.spineZ * DEG);
      chest.rotation.set(P.chestX * DEG, 0, 0);
      B.neck.rotation.set(P.neckX * 0.45 * DEG, P.neckY * 0.45 * DEG, P.neckZ * 0.45 * DEG);
      B.head.rotation.set((P.neckX * 0.55 + P.headX) * DEG, P.neckY * 0.55 * DEG, (P.neckZ * 0.55 + P.headZ) * DEG);
      // Apoyo garantizado: si una pierna no alcanza su tobillo, la cadera baja lo que falte
      hips.updateMatrix();
      const reach = M.thigh + M.shin - 0.05;
      for (const s of ['R', 'L']) {
        const l = 'leg' + s + '.';
        _v.set(P[l + 'ax'], P[l + 'ay'], P[l + 'az']);
        _hw.copy(B['thigh' + s].position).applyMatrix4(hips.matrix); // cadera en espacio del jugador
        const d = _hw.distanceTo(_v);
        if (d > reach) {
          // baja la cadera verticalmente hasta que la pierna llegue
          const dx = _hw.x - _v.x, dz = _hw.z - _v.z;
          const vy = Math.sqrt(Math.max(0, reach * reach - dx * dx - dz * dz));
          const newY = _v.y + vy;
          hy -= (_hw.y - newY);
          hips.position.y = hy; hips.updateMatrix();
        }
      }
      spine.updateMatrix(); chest.updateMatrix();
      // Brazos: objetivo en espacio del jugador → espacio del pecho
      _mi.multiplyMatrices(hips.matrix, spine.matrix).multiply(chest.matrix).invert();
      for (const s of ['R', 'L']) {
        const a = 'arm' + s + '.';
        _v.set(P[a + 'wx'], P[a + 'wy'], P[a + 'wz']).applyMatrix4(_mi);
        _hv.set(P[a + 'hx'], P[a + 'hy'], P[a + 'hz']).transformDirection(_mi);
        solveLimb(B['shoulder' + s], B['elbow' + s], _v, _hv, M.upperArm, M.forearm);
        // muñeca: giro sobre el antebrazo (Y), luego flexión (X) y desviación (Z)
        B['wrist' + s].rotation.set(-P[a + 'flex'] * DEG, P[a + 'twist'] * DEG, P[a + 'dev'] * DEG, 'YXZ');
      }
      // Piernas: objetivo en espacio del jugador → espacio de la cadera
      _q.copy(hips.quaternion).invert();
      for (const s of ['R', 'L']) {
        const l = 'leg' + s + '.';
        _v.set(P[l + 'ax'], P[l + 'ay'], P[l + 'az']).sub(hips.position).applyQuaternion(_q);
        _hv.set(P[l + 'kx'], P[l + 'ky'], P[l + 'kz']).applyQuaternion(_q);
        solveLimb(B['thigh' + s], B['knee' + s], _v, _hv, M.thigh, M.shin);
        // el pie se mantiene horizontal en el espacio del jugador (con la punta más o menos baja)
        _q2.copy(hips.quaternion).multiply(B['thigh' + s].quaternion).multiply(B['knee' + s].quaternion).invert();
        B['ankle' + s].quaternion.copy(_q2).multiply(_q.setFromEuler(_ee.set(P[l + 'toe'] * DEG, 0, 0)));
        _q.copy(hips.quaternion).invert();
      }
    }
    update(now, opts) {
      now = now || 0; this.lastNow = now;
      const t = now / 1000 + this.L.phase;
      let P = evalPose(this.pose, t, this.M, this.jump);
      const k = (now - this.poseT0) / TRANSITION;
      if (this.prevPose && k < 1) P = blendPose(evalPose(this.prevPose, t, this.M, this.jump), P, smooth(k));
      else this.prevPose = null;
      this._apply(P);
      if (this.starMesh) {
        if (opts && opts.camera) this._fitStar(opts);
        const sc = this.starScale;
        this.starMesh.scale.setScalar(sc);
        this.starMesh.rotation.y = now / 900;
        this.starMesh.position.y = HEIGHT + 3.2 + 3.8 * sc + Math.sin(now / 500) * 0.8 + this.jump / this.L.h;
      }
      return this;
    }
    // Ajusta la escala de la estrella para que en pantalla mida entre starMinPx y starMaxPx de alto
    // (píxeles CSS). opts: { camera, viewportHeight, starMinPx = 16, starMaxPx = 34 }.
    _fitStar(opts) {
      const cam = opts.camera, vh = opts.viewportHeight || (typeof innerHeight === 'number' ? innerHeight : 800);
      const minPx = opts.starMinPx == null ? 16 : opts.starMinPx, maxPx = Math.max(minPx, opts.starMaxPx == null ? 34 : opts.starMaxPx);
      this.object.updateWorldMatrix(true, false);
      _v.set(0, HEIGHT + 7, 0).applyMatrix4(this.object.matrixWorld);
      let pxPerUnit;
      if (cam.isOrthographicCamera) pxPerUnit = vh * (cam.zoom || 1) / Math.max(1e-6, cam.top - cam.bottom);
      else {
        cam.getWorldDirection(_hv);
        _hw.setFromMatrixPosition(cam.matrixWorld);
        const depth = Math.max(1, _v.sub(_hw).dot(_hv));
        pxPerUnit = vh * (cam.zoom || 1) / (2 * depth * Math.tan((cam.fov || 50) * DEG / 2));
      }
      const natural = 6.8 * this.object.scale.y * pxPerUnit;   // alto de la estrella sin corregir
      this.starScale = clamp(clamp(natural, minPx, maxPx) / Math.max(1e-6, natural), 0.35, 8);
    }
    // Caja envolvente aproximada en el espacio del objeto (sin escala): a partir de los huesos
    bounds() {
      const box = new T.Box3();
      this.object.updateMatrixWorld(true);
      const inv = new T.Matrix4().copy(this.object.matrixWorld).invert();
      const pad = { head: 6.9, wrist: 4.3, ankle: 3.4, elbow: 2.2, knee: 2.4, shoulder: 3.0, hips: 5, spine: 5, chest: 6, neck: 3 };
      const v = new T.Vector3();
      for (const b of this.bones) {
        b.getWorldPosition(v).applyMatrix4(inv);
        const key = Object.keys(pad).find((k) => b.name.startsWith(k));
        const r = (pad[key] || 3) * this.L.h;
        box.expandByPoint(v.clone().addScalar(r)); box.expandByPoint(v.clone().subScalar(r));
      }
      if (this.starMesh) { const s = this.starMesh.position.clone().multiplyScalar(this.L.h); const rs = 4.6 * this.starScale; box.expandByPoint(s.clone().addScalar(rs)); box.expandByPoint(s.clone().subScalar(rs)); }
      box.min.y = Math.max(box.min.y, 0);
      return box;
    }
  }

  // ------------------------------------------------------------------ Retratos
  let portrait = null;
  function getPortraitRig() {
    if (portrait) return portrait;
    const canvas = document.createElement('canvas');
    const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    const scene = new T.Scene();
    const bg = document.createElement('canvas'); bg.width = 4; bg.height = 128;
    const g = bg.getContext('2d'); const grd = g.createLinearGradient(0, 0, 0, 128);
    grd.addColorStop(0, '#22385F'); grd.addColorStop(1, '#101D36'); g.fillStyle = grd; g.fillRect(0, 0, 4, 128);
    const bgTex = new T.CanvasTexture(bg); bgTex.colorSpace = T.SRGBColorSpace; scene.background = bgTex;
    scene.add(new T.HemisphereLight(0xcfe0ff, 0x3a2a1a, 0.9));
    const key = new T.DirectionalLight(0xfff2e0, 2.4); key.position.set(-30, 60, 60); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); Object.assign(key.shadow.camera, { left: -40, right: 40, top: 70, bottom: -10, near: 1, far: 300 }); key.shadow.bias = -0.0005; key.shadow.normalBias = 0.3;
    scene.add(key);
    const fill = new T.DirectionalLight(0xbcd0ff, 0.7); fill.position.set(50, 20, 40); scene.add(fill);
    const rim = new T.DirectionalLight(0xffd9a0, 1.4); rim.position.set(20, 40, -60); scene.add(rim);
    const floor = new T.Mesh(new T.CircleGeometry(40, 32), new T.ShadowMaterial({ opacity: 0.35 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const camera = new T.PerspectiveCamera(28, 1, 1, 500);
    // Pelota con gajos para el retrato con pique
    const bc = document.createElement('canvas'); bc.width = 128; bc.height = 64;
    const bctx = bc.getContext('2d'); bctx.fillStyle = '#E8731F'; bctx.fillRect(0, 0, 128, 64);
    bctx.strokeStyle = '#2A1408'; bctx.lineWidth = 3;
    bctx.beginPath(); bctx.moveTo(0, 32); bctx.lineTo(128, 32); bctx.moveTo(32, 0); bctx.lineTo(32, 64); bctx.moveTo(96, 0); bctx.lineTo(96, 64); bctx.stroke();
    const btex = new T.CanvasTexture(bc); btex.colorSpace = T.SRGBColorSpace;
    const ball = new T.Mesh(new T.SphereGeometry(3.2, 16, 12), new T.MeshStandardMaterial({ map: btex, roughness: 0.75 }));
    ball.castShadow = true; scene.add(ball);
    portrait = { canvas, renderer, scene, camera, ball, player: null };
    return portrait;
  }
  function renderPortrait(canvas, look, pose) {
    const rig = getPortraitRig();
    pose = pose || 'dribble';
    const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: 0, height: 0 };
    const w = Math.max(16, Math.round(rect.width || canvas.width || 104)), h = Math.max(16, Math.round(rect.height || canvas.height || 132));
    const k = Math.min(3, window.devicePixelRatio || 1);
    rig.renderer.setPixelRatio(1);
    rig.renderer.setSize(Math.round(w * k), Math.round(h * k), false);
    if (rig.player) { rig.player.dispose(); rig.player = null; }
    const p = rig.player = new Player(look, {});
    rig.scene.add(p.object);
    p.setPose(pose); p.poseT0 = -1e9; p.setFacing(0.32); p.update(1250);
    let ballOn = false;
    if (pose === 'dribble') {
      const hp = p.handWorld('derecha');
      rig.ball.visible = ballOn = true; rig.ball.position.set(hp.x, Math.max(3.4, hp.y - 3.3), hp.z);
    } else rig.ball.visible = false;
    // Encuadre por caja envolvente: el personaje llena la tarjeta sin cortar manos ni estrella
    const box = p.bounds();
    if (ballOn) { box.expandByPoint(rig.ball.position.clone().addScalar(3.3)); box.expandByPoint(rig.ball.position.clone().subScalar(3.3)); }
    const size = box.getSize(new T.Vector3()), center = box.getCenter(new T.Vector3());
    rig.camera.aspect = w / h; rig.camera.fov = 28; rig.camera.updateProjectionMatrix();
    const tanV = Math.tan(rig.camera.fov * DEG / 2), tanH = tanV * rig.camera.aspect;
    const dist = Math.max((size.y / 2 + 1.2) / tanV, (Math.hypot(size.x, size.z) / 2 + 1.0) / tanH) * 1.0;
    rig.camera.position.set(center.x + dist * 0.1, center.y + size.y * 0.1, center.z + dist);
    rig.camera.lookAt(center.x, center.y - size.y * 0.02, center.z);
    rig.renderer.render(rig.scene, rig.camera);
    canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(rig.canvas, 0, 0, canvas.width, canvas.height);
    rig.scene.remove(p.object); p.dispose(); rig.player = null;
    return canvas;
  }

  // ------------------------------------------------------------------ API pública
  window.Players3D = {
    create(look, opts) { return new Player(look, opts); },
    renderPortrait,
    SKINS, HAIRS, STYLES, STYLE_NAMES, BODIES, BODY_NAMES, ACCESSORIES, ACCESSORY_NAMES, POSES, HEIGHT,
    _internals: { hash, tube, merge, measures, evalPose, solveLimb, CH },
  };
})();
