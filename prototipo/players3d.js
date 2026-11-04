/* players3d.js — Jugadores 3D procedimentales para "Jugada Maestra" (Contrato B). Versión final.
 * Dirección de arte "deportista realista estilizado": proporciones de ~7,3 cabezas, hombros anchos,
 * muslos potentes, piel mate con poros, camiseta de tela con número grande, zapatillas con brillo.
 *
 * Construcción: cada jugador es UN SkinnedMesh (una sola llamada de dibujo) con un esqueleto de
 * THREE.Bone (cadera → columna → pecho → cuello → cabeza; pecho → hombro → codo → muñeca;
 * cadera → muslo → rodilla → tobillo). Toda la ropa, la piel, la cara y el número viven en un atlas
 * de textura de canvas (1024 × 1024) por aspecto (con caché), más un mapa de rugosidad.
 * Pesos de piel mezclados en codos, rodillas y cuello + esferas en las articulaciones.
 *
 * Animación: poses escritas por intención como OBJETIVOS (muñecas y tobillos en el espacio del
 * jugador) resueltos con cinemática inversa de dos huesos; los pies quedan siempre horizontales y
 * apoyados (la cadera baja sola si una pierna no llega). Las poses se mezclan por canales (~150 ms).
 * Sin Math.random: todo lo "aleatorio" sale de hash(look.name + look.num) o de look.phase.
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
  // rings: [{ y, rx, rz, cx, cz }] recorridos en orden. uv: { u0, u1, v0, v1 } región del atlas;
  // v se reparte por longitud de arco del perfil. Devuelve BufferGeometry indexada y, en
  // geo.userData.ringV, el v (0..1) de cada anillo (0 = anillo más bajo).
  function tube(rings, opts) {
    opts = opts || {};
    const segs = opts.segs || 14;
    const uv = opts.uv || { u0: 0, u1: 1, v0: 0, v1: 1 };
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
        const a = -Math.PI + (j / segs) * Math.PI * 2; // a = 0 → +z (frente)
        const x = (r.cx || 0) + r.rx * Math.sin(a), z = (r.cz || 0) + r.rz * Math.cos(a);
        pos.push(x, r.y, z);
        nor.push(0, 0, 0);
        uvs.push(lerp(uv.u0, uv.u1, j / segs), vv);
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
    // Cose las normales de la costura
    const na = g.attributes.normal;
    for (let i = 0; i < n; i++) {
      const a = i * (segs + 1), b = a + segs;
      const x = (na.getX(a) + na.getX(b)) / 2, y = (na.getY(a) + na.getY(b)) / 2, z = (na.getZ(a) + na.getZ(b)) / 2;
      na.setXYZ(a, x, y, z); na.setXYZ(b, x, y, z);
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
        pos.push(c.x + d.x * R.x * k, c.y + d.y * R.y * k, c.z + d.z * R.z * k);
        nor.push(nx / nl, ny / nl, nz / nl);
        uvs.push(uvPoint[0], uvPoint[1]);
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
    head: [0, 300], torso: [300, 560], pelvis: [560, 640], thigh: [640, 760], shin: [760, 840], shoe: [840, 920],
  };
  // Muestras (color plano): [x0, x1, y0, y1]
  const SW = {
    upperArm: [0, 340, 920, 960], forearm: [340, 680, 920, 960], hand: [680, 1024, 920, 960],
    hair: [0, 340, 960, 1000], trim: [340, 680, 960, 1000], jersey: [680, 1024, 960, 1000],
    white: [0, 512, 1000, 1024], dark: [512, 1024, 1000, 1024],
  };
  function uvReg(r) { return { u0: 0, u1: 1, v0: 1 - r[1] / ATLAS, v1: 1 - r[0] / ATLAS }; }
  function swUV(s) { return [((s[0] + s[1]) / 2) / ATLAS, 1 - ((s[2] + s[3]) / 2) / ATLAS]; }
  function rowOf(r, v) { return r[1] - v * (r[1] - r[0]); }

  // ------------------------------------------------------------------ Medidas del cuerpo
  // Todo en unidades de mundo con h = 1. El personaje mira a +z; su derecha es −x.
  function measures(body) {
    const k = body === 'delgado' ? 0.8 : body === 'fornido' ? 1.26 : 1;    // grosor de extremidades
    const kt = body === 'delgado' ? 0.86 : body === 'fornido' ? 1.2 : 1;   // ancho del tronco
    const kc = body === 'delgado' ? 0.92 : body === 'fornido' ? 1.12 : 1;  // profundidad del pecho
    const sh = body === 'fornido' ? 1.0 : body === 'delgado' ? -0.55 : 0;  // hombros extra
    return {
      k, kt, kc,
      hipY: 25.2, hipX: 3.5,
      spineY: 3.3, chestY: 6.0, neckY: 6.2, headY: 0.4,
      shoulder: { x: 4.7 * kt + sh, y: 3.5, z: 0.2 },
      upperArm: 9.0, forearm: 8.6, hand: 3.6,
      thigh: 11.3, shin: 11.0, ankle: 2.9,
    };
  }

  // Perfil de la cabeza (local del hueso 'head', que está en la base del cráneo)
  const HS = 0.97; // escala de la cabeza
  const HEAD_RINGS = [
    cap(0.2, 0.85),
    { y: 0.45, rx: 1.15, rz: 1.05, cz: 0.85 },   // mentón
    { y: 1.15, rx: 1.95, rz: 2.15, cz: 0.5 },    // mandíbula
    { y: 1.95, rx: 2.2, rz: 2.5, cz: 0.3 },      // boca
    { y: 2.75, rx: 2.32, rz: 2.65, cz: 0.15 },   // base de la nariz / pómulos
    { y: 3.6, rx: 2.35, rz: 2.7, cz: 0.05 },     // ojos
    { y: 4.4, rx: 2.35, rz: 2.7, cz: -0.05 },    // cejas
    { y: 5.3, rx: 2.22, rz: 2.6, cz: -0.25 },    // frente
    { y: 6.15, rx: 1.8, rz: 2.15, cz: -0.5 },    // coronilla
    cap(6.8, -0.65),
  ].map((r) => ({ y: r.y * HS, rx: r.rx * HS, rz: r.rz * HS, cz: (r.cz || 0) * HS }));
  const HEAD_NAMES = ['cap0', 'chin', 'jaw', 'mouth', 'nose', 'eyes', 'brow', 'forehead', 'crown', 'top'];
  // Elipsoide del cráneo (para el pelo y la vincha)
  const HEAD_C = new T.Vector3(0, 4.05 * HS, -0.25 * HS), HEAD_R = new T.Vector3(2.38 * HS, 2.85 * HS, 2.8 * HS);
  // Línea de pelo: elevación máxima según el ángulo (a = 0 frente). front/side/back en radianes.
  function hairline(front, side, back) {
    return (a) => {
      const c = Math.cos(a), f = (c + 1) / 2, s = Math.sin(a) * Math.sin(a);
      const fb = lerp(back, front, smooth(f));
      return fb * (1 - s) + side * s;
    };
  }
  const HAIRLINE_STD = hairline(1.27, 1.55, 1.9);
  // Punto sobre el elipsoide a una elevación/ángulo dados, con factor de radio kk
  function onHead(el, a, kk) {
    return new T.Vector3(HEAD_C.x + Math.sin(el) * Math.sin(a) * HEAD_R.x * kk, HEAD_C.y + Math.cos(el) * HEAD_R.y * kk, HEAD_C.z + Math.sin(el) * Math.cos(a) * HEAD_R.z * kk);
  }

  // Construye las piezas del cuerpo en coordenadas locales de su hueso.
  function buildBody(L) {
    const M = measures(L.body);
    const k = M.k, kt = M.kt, kc = M.kc;
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

    // --- Cabeza: cráneo + mandíbula, con cara en el atlas
    const headGeo = tube(HEAD_RINGS, { segs: 24, uv: uvReg(REG.head) });
    rings.head = { v: headGeo.userData.ringV, names: HEAD_NAMES };
    rings.headDef = HEAD_RINGS;
    const earUV = swUV(SW.upperArm); // piel lisa
    const pieces = [headGeo];
    for (const sg of [-1, 1]) {
      // Oreja: elipsoide achatado pegado a la sien, ligeramente girado hacia atrás
      const ear = new T.SphereGeometry(0.66, 8, 6);
      ear.scale(0.42, 1.12, 0.85); ear.rotateY(sg * 0.3); ear.translate(sg * 2.34 * HS, 3.5 * HS, -0.25 * HS);
      pieces.push(flatUV(ear, earUV[0], earUV[1]));
    }
    // Nariz: puente + punta (dos elipsoides parcialmente dentro de la cara)
    const nose = new T.SphereGeometry(0.46, 8, 6);
    nose.scale(0.9, 1.0, 1.1); nose.translate(0, 2.9 * HS, 2.6 * HS);
    pieces.push(flatUV(nose, earUV[0], earUV[1]));
    const bridge = new T.SphereGeometry(0.32, 6, 5);
    bridge.scale(0.8, 2.2, 0.9); bridge.translate(0, 3.5 * HS, 2.45 * HS);
    pieces.push(flatUV(bridge, earUV[0], earUV[1]));
    add(merge(pieces.map((g) => bindTo(g, I('head')))), 'head');

    // --- Tronco: desde adentro del short hasta el cuello (camiseta pintada en el atlas)
    const torsoRings = [
      { y: -3.2, rx: 4.0 * kt, rz: 2.8 * kc, cz: 0.1 },
      { y: 0.0, rx: 4.3 * kt, rz: 2.95 * kc, cz: 0.15 },   // cintura
      { y: 2.6, rx: 4.8 * kt, rz: 3.3 * kc, cz: 0.25 },
      { y: 5.0, rx: 5.4 * kt, rz: 3.6 * kc, cz: 0.35 },    // pecho
      { y: 7.2, rx: 5.7 * kt, rz: 3.55 * kc, cz: 0.3 },
      { y: 9.0, rx: 5.9 * kt + (M.shoulder.x - 4.8 * kt), rz: 3.2 * kc, cz: 0.15 }, // hombros
      { y: 9.9, rx: 5.1 * kt + (M.shoulder.x - 4.8 * kt) * 0.6, rz: 2.8 * kc, cz: 0.05 },
      { y: 10.9, rx: 3.0 * kt, rz: 2.2 * kc, cz: -0.05 },  // trapecios
      { y: 11.5, rx: 1.45, rz: 1.4, cz: 0 },               // base del cuello
      { y: 13.0, rx: 1.3, rz: 1.3, cz: 0.1 },              // cuello (entra en la cabeza)
    ];
    const torsoGeo = tube(torsoRings, { segs: 22, uv: uvReg(REG.torso) });
    rings.torso = { v: torsoGeo.userData.ringV, names: ['in', 'waist', 'ribs', 'chest', 'pecs', 'shoulders', 'shTop', 'traps', 'neckBase', 'neckTop'], def: torsoRings };
    // El cuello sigue en parte al hueso del cuello
    add(bindBlend(torsoGeo, I('spine'), I('neck'), 10.9, 13.0, 0.85), 'spine');

    // --- Pelvis (parte alta del short), cerrada por abajo
    const pelvisRings = [
      cap(-4.0, 0.1),
      { y: -3.6, rx: 6.0 * kt, rz: 4.1 * kc, cz: 0.1 },
      { y: -1.5, rx: 6.1 * kt, rz: 4.15 * kc, cz: 0.1 },
      { y: 1.0, rx: 5.7 * kt, rz: 3.9 * kc, cz: 0.1 },
      { y: 3.6, rx: 5.1 * kt, rz: 3.5 * kc, cz: 0.15 },
      { y: 5.0, rx: 4.6 * kt, rz: 3.15 * kc, cz: 0.15 }, // cintura del short
      { y: 5.6, rx: 4.3 * kt, rz: 2.95 * kc, cz: 0.15 },
    ];
    add(bindTo(tube(pelvisRings, { segs: 18, uv: uvReg(REG.pelvis) }), I('hips')), 'hips');

    // --- Extremidades
    const skinSw = (s) => ({ u0: s[0] / ATLAS, u1: s[1] / ATLAS, v0: 1 - s[3] / ATLAS, v1: 1 - s[2] / ATLAS });
    const jointSphere = (r, uvp, bi) => { const g = new T.SphereGeometry(r, 10, 8); return bindTo(flatUV(g, uvp[0], uvp[1]), bi); };
    const handUV = swUV(SW.hand), armUV = swUV(SW.upperArm);
    for (const s of ['R', 'L']) {
      const mir = s === 'R';
      // Muslo con la pernera del short y la piel debajo del ruedo
      const thighRings = [
        { y: 0.8, rx: 2.7 * k, rz: 2.8 * k, cz: -0.1 },
        { y: 0.0, rx: 3.25 * k, rz: 3.3 * k, cz: 0 },
        { y: -3.0, rx: 3.3 * k, rz: 3.35 * k, cz: 0 },
        { y: -6.0, rx: 3.2 * k, rz: 3.25 * k, cz: 0 },
        { y: -7.3, rx: 3.15 * k, rz: 3.2 * k, cz: 0 },      // ruedo
        { y: -7.45, rx: 2.35 * k, rz: 2.45 * k, cz: 0 },    // piel bajo el ruedo
        { y: -9.5, rx: 2.0 * k, rz: 2.1 * k, cz: 0 },
        { y: -11.3, rx: 1.7 * k, rz: 1.8 * k, cz: 0 },      // rodilla
        cap(-12.2, 0),
      ];
      const th = tube(thighRings, { segs: 14, uv: uvReg(REG.thigh) });
      rings.thigh = { v: th.userData.ringV, names: ['top', 'hip', 'mid', 'low', 'hem', 'skin', 'lower', 'knee', 'cap'] };
      if (mir) mirrorX(th);
      add(bindBlend(th, I('thigh' + s), I('knee' + s), -9.8, -12.2, 0.5), 'thigh' + s);
      // Pantorrilla con la media pintada
      const shinRings = [
        cap(1.2, 0),
        { y: 0.6, rx: 1.6 * k, rz: 1.65 * k, cz: 0 },
        { y: -1.5, rx: 1.75 * k, rz: 2.0 * k, cz: -0.35 },  // gemelo
        { y: -4.0, rx: 1.65 * k, rz: 1.9 * k, cz: -0.35 },
        { y: -6.5, rx: 1.3 * k, rz: 1.45 * k, cz: -0.2 },   // alto de la media
        { y: -9.0, rx: 1.1 * k, rz: 1.2 * k, cz: -0.1 },
        { y: -11.0, rx: 1.05 * k, rz: 1.15 * k, cz: 0 },    // tobillo
        cap(-11.8, 0),
      ];
      const sh = tube(shinRings, { segs: 12, uv: uvReg(REG.shin) });
      rings.shin = { v: sh.userData.ringV, names: ['cap', 'knee', 'calf', 'calf2', 'sockTop', 'sock', 'ankle', 'cap2'] };
      if (mir) mirrorX(sh);
      add(bindBlend(sh, I('knee' + s), I('thigh' + s), -0.8, 1.2, 0.5), 'knee' + s);
      // Rótula: esfera en la articulación (cubre el hueco al doblar)
      add(jointSphere(1.62 * k, [0.5, 1 - (REG.shin[0] + 8) / ATLAS], I('knee' + s)), 'knee' + s);
      // Zapatilla: tubo a lo largo del pie (se genera en y y se gira a z)
      const shoeRings = [
        cap(2.6, -1.3),
        { y: 2.3, rx: 1.3, rz: 1.1, cz: -1.3 },   // talón
        { y: 1.0, rx: 1.65, rz: 1.75, cz: -1.0 },
        { y: -1.0, rx: 1.7, rz: 1.55, cz: -1.3 },
        { y: -3.2, rx: 1.65, rz: 1.1, cz: -1.9 },
        { y: -5.0, rx: 1.45, rz: 0.8, cz: -2.15 }, // punta
        cap(-5.7, -2.3),
      ];
      const shoeG = tube(shoeRings, { segs: 14, uv: uvReg(REG.shoe) });
      shoeG.rotateX(-Math.PI / 2); // y → -z: el talón queda atrás, la punta adelante; cz pasa a ser altura
      shoeG.scale(k > 1 ? 1.06 : 1, 1, 1);
      rings.shoe = { v: shoeG.userData.ringV, names: ['heelCap', 'heel', 'instep', 'mid', 'toeBox', 'toe', 'toeCap'] };
      if (mir) mirrorX(shoeG);
      add(bindTo(shoeG, I('ankle' + s)), 'ankle' + s);
      // Brazo: deltoides arriba, bíceps, codo
      const uaRings = [
        cap(1.4, 0),
        { y: 0.7, rx: 1.85 * k, rz: 1.8 * k },
        { y: -0.6, rx: 2.0 * k, rz: 1.95 * k },   // deltoides
        { y: -3.0, rx: 1.85 * k, rz: 1.8 * k },
        { y: -5.5, rx: 1.6 * k, rz: 1.65 * k },   // bíceps
        { y: -8.0, rx: 1.35 * k, rz: 1.35 * k },
        { y: -9.2, rx: 1.25 * k, rz: 1.25 * k },
        cap(-9.9, 0),
      ];
      const ua = tube(uaRings, { segs: 12, uv: skinSw(SW.upperArm) });
      if (mir) mirrorX(ua);
      add(bindBlend(ua, I('shoulder' + s), I('elbow' + s), -7.6, -9.9, 0.5), 'shoulder' + s);
      // Antebrazo
      const faRings = [
        cap(1.0, 0),
        { y: 0.3, rx: 1.3 * k, rz: 1.3 * k },
        { y: -2.0, rx: 1.35 * k, rz: 1.3 * k },
        { y: -5.0, rx: 1.05 * k, rz: 1.0 * k },
        { y: -8.3, rx: 0.8 * k, rz: 0.72 * k },
        cap(-9.0, 0),
      ];
      const fa = tube(faRings, { segs: 10, uv: skinSw(SW.forearm) });
      if (mir) mirrorX(fa);
      add(bindBlend(fa, I('elbow' + s), I('shoulder' + s), -1.2, 1.0, 0.5), 'elbow' + s);
      add(jointSphere(1.3 * k, armUV, I('elbow' + s)), 'elbow' + s);
      // Mano: palma con forma, cuatro dedos levemente curvados y pulgar del lado interno
      const handRings = [
        cap(0.5, 0),
        { y: 0.0, rx: 0.95 * k, rz: 0.62 * k },
        { y: -1.3, rx: 1.45 * k, rz: 0.72 * k, cx: 0.1 },
        { y: -2.4, rx: 1.5 * k, rz: 0.66 * k, cx: 0.15 },
        { y: -2.9, rx: 1.35 * k, rz: 0.55 * k, cx: 0.15 },
        cap(-3.2, 0),
      ];
      const handPieces = [tube(handRings, { segs: 10, uv: skinSw(SW.hand) })];
      for (let i = 0; i < 4; i++) {
        const len = [1.5, 1.75, 1.65, 1.3][i];
        const f = new T.CapsuleGeometry(0.33 * k, len, 2, 6);
        f.translate(0, -len / 2 - 0.1, 0); f.rotateX(-0.28); f.translate(-1.05 * k + i * 0.72 * k, -2.75, 0.15);
        handPieces.push(flatUV(f, handUV[0], handUV[1]));
      }
      const thumb = new T.CapsuleGeometry(0.36 * k, 1.5, 2, 6);
      thumb.translate(0, -0.75, 0); thumb.rotateZ(0.75); thumb.rotateX(-0.45); thumb.translate(-1.0 * k, -0.9, 0.5);
      handPieces.push(flatUV(thumb, handUV[0], handUV[1]));
      const hd = merge(handPieces);
      if (mir) mirrorX(hd);
      add(bindTo(hd, I('wrist' + s)), 'wrist' + s);
    }

    // --- Pelo (en coordenadas de la cabeza)
    const hairUV = swUV(SW.hair);
    const style = L.style;
    const hairPieces = [];
    if (style === 'corto' || style === 'mono') {
      // Casquete con volumen en la coronilla y leve "flequillo" al frente
      const bump = (a, el) => 0.1 * Math.max(0, Math.cos(el * 1.5)) + 0.05 * Math.max(0, Math.cos(a)) * Math.pow(Math.sin(el), 2);
      hairPieces.push(hairCap(HEAD_C, HEAD_R, 0.14, HAIRLINE_STD, bump, hairUV, 26, 10));
      if (style === 'mono') {
        // Moño alto y atrás, visible de frente por encima de la coronilla
        const bun = new T.SphereGeometry(1.45, 12, 9); bun.scale(1.05, 0.9, 1.0); bun.translate(0, 7.45 * HS, -1.1 * HS);
        hairPieces.push(flatUV(bun, hairUV[0], hairUV[1]));
        const base = new T.SphereGeometry(0.8, 8, 6); base.scale(1.35, 0.6, 1.05); base.translate(0, 6.65 * HS, -0.95 * HS);
        hairPieces.push(flatUV(base, hairUV[0], hairUV[1]));
      }
    } else if (style === 'rapado') {
      hairPieces.push(hairCap(HEAD_C, HEAD_R, 0.03, hairline(1.22, 1.5, 1.9), null, hairUV));
    } else if (style === 'rulos') {
      const r = rng(L.seed ^ 0x9e37);
      const noise = [];
      for (let i = 0; i < 400; i++) noise.push(r());
      // Afro: casquete grueso con ruido determinista
      const bump = (a, el, i, j) => 0.22 + 0.16 * noise[(i * 31 + j * 7) % 400] + 0.07 * Math.sin(a * 9 + el * 7);
      hairPieces.push(hairCap(HEAD_C, HEAD_R, 0.3, hairline(1.22, 1.58, 1.95), bump, hairUV, 28, 12));
      // Rizos sueltos como esferitas, repartidos por todo el casquete
      for (let i = 0; i < 44; i++) {
        const a = -Math.PI + r() * Math.PI * 2, el = Math.pow(r(), 0.75) * (Math.abs(a) < 1.0 ? 1.1 : 1.45);
        const sp = new T.SphereGeometry(0.55 + r() * 0.35, 7, 5);
        const c = onHead(el, a, 1.42); sp.translate(c.x, c.y, c.z);
        hairPieces.push(flatUV(sp, hairUV[0], hairUV[1]));
      }
    } else if (style === 'trenzas') {
      hairPieces.push(hairCap(HEAD_C, HEAD_R, 0.07, HAIRLINE_STD, null, hairUV));
      // Trenzas pegadas (cornrows): filas paralelas que siguen el cráneo de la frente a la nuca
      // (intersección del elipsoide con planos x = cte) y cuelgan por detrás hasta los hombros
      for (let i = 0; i < 7; i++) {
        const xi = (i - 3) * 0.62 * HS;
        const kk = 1.1, q = Math.sqrt(Math.max(0.05, 1 - (xi / (HEAD_R.x * kk)) * (xi / (HEAD_R.x * kk))));
        const ry = HEAD_R.y * kk * q, rz = HEAD_R.z * kk * q;
        const th0 = 1.22 + Math.abs(i - 3) * 0.06, th1 = -(Math.PI - 1.4); // frente (θ > 0) → coronilla (0) → nuca (θ < 0)
        const pts = [];
        for (let kk2 = 0; kk2 <= 7; kk2++) {
          const th = lerp(th0, th1, kk2 / 7);
          pts.push(new T.Vector3(xi, HEAD_C.y + Math.cos(th) * ry, HEAD_C.z + Math.sin(th) * rz));
        }
        const last = pts[pts.length - 1];
        const sx = Math.sign(xi) * 0.35;
        pts.push(new T.Vector3(last.x + sx, last.y - 2.3, last.z - 0.3));
        pts.push(new T.Vector3(last.x + sx * 1.6, last.y - 4.8, last.z - 0.5));
        const tb = new T.TubeGeometry(new T.CatmullRomCurve3(pts, false, 'centripetal'), 26, 0.36, 5, false);
        hairPieces.push(flatUV(tb, hairUV[0], hairUV[1]));
      }
    }
    if (hairPieces.length) add(merge(hairPieces.map((g) => bindTo(g, I('head')))), 'head');

    // --- Accesorios
    const acc = L.accessory;
    const trimUV = swUV(SW.trim), jerseyUV = swUV(SW.jersey);
    if (acc === 'vincha') {
      const g = new T.TorusGeometry(2.4 * HS, 0.34, 7, 24);
      g.rotateX(Math.PI / 2); g.scale(1, 1, 1.17); g.translate(0, 4.95 * HS, -0.15 * HS);
      add(bindTo(flatUV(g, trimUV[0], trimUV[1]), I('head')), 'head');
    } else if (acc === 'manga') {
      // Manga de compresión en el brazo izquierdo (dos tubos)
      const g1 = tube([{ y: -0.2, rx: 2.05 * k, rz: 2.0 * k }, { y: -3.0, rx: 1.95 * k, rz: 1.9 * k }, { y: -8.3, rx: 1.45 * k, rz: 1.45 * k }, { y: -9.6, rx: 1.35 * k, rz: 1.35 * k }], { segs: 12 });
      add(bindBlend(flatUV(g1, jerseyUV[0], jerseyUV[1]), I('shoulderL'), I('elbowL'), -7.6, -9.9, 0.5), 'shoulderL');
      const g2 = tube([{ y: 0.9, rx: 1.4 * k, rz: 1.38 * k }, { y: -2.0, rx: 1.45 * k, rz: 1.4 * k }, { y: -5.0, rx: 1.15 * k, rz: 1.1 * k }, { y: -8.0, rx: 0.92 * k, rz: 0.85 * k }], { segs: 12 });
      add(bindBlend(flatUV(g2, jerseyUV[0], jerseyUV[1]), I('elbowL'), I('shoulderL'), -1.2, 1.0, 0.5), 'elbowL');
      add(jointSphere(1.38 * k, jerseyUV, I('elbowL')), 'elbowL');
    } else if (acc === 'munequeras') {
      for (const s of ['R', 'L']) {
        const g = tube([{ y: -6.9, rx: 1.02 * k, rz: 0.97 * k }, { y: -7.8, rx: 1.04 * k, rz: 0.98 * k }, { y: -8.7, rx: 1.0 * k, rz: 0.92 * k }], { segs: 12 });
        add(bindTo(flatUV(g, trimUV[0], trimUV[1]), I('elbow' + s)), 'elbow' + s);
      }
    } else if (acc === 'rodillera') {
      const g = tube([{ y: 1.8, rx: 1.8 * k, rz: 1.9 * k }, { y: 0.0, rx: 2.0 * k, rz: 2.1 * k }, { y: -2.2, rx: 1.95 * k, rz: 2.2 * k, cz: -0.3 }, { y: -3.2, rx: 1.78 * k, rz: 2.05 * k, cz: -0.3 }], { segs: 12 });
      add(bindBlend(flatUV(g, jerseyUV[0], jerseyUV[1]), I('kneeR'), I('thighR'), -0.8, 1.8, 0.5), 'kneeR');
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
    const eyeRing = headRingsDef[hn.indexOf('eyes')];
    const ppu = W / (Math.PI * (eyeRing.rx + eyeRing.rz)); // píxeles por unidad (horizontal) en los ojos
    // Sombra suave bajo la mandíbula
    let g = ctx.createLinearGradient(0, yJaw, 0, HR[1]);
    g.addColorStop(0, rgba(skinD, 0)); g.addColorStop(1, rgba(skinD, 0.55));
    ctx.fillStyle = g; ctx.fillRect(0, yJaw, W, HR[1] - yJaw);
    // Mejillas cálidas
    const warm = mix(skin, '#C8463C', 0.22);
    for (const s of [-1, 1]) {
      g = ctx.createRadialGradient(cx + s * 1.3 * ppu, (yNose + yMouth) / 2, 2, cx + s * 1.3 * ppu, (yNose + yMouth) / 2, 1.1 * ppu);
      g.addColorStop(0, rgba(warm, 0.5)); g.addColorStop(1, rgba(warm, 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, HR[1]);
    }
    // Cuenca de los ojos
    for (const s of [-1, 1]) {
      g = ctx.createRadialGradient(cx + s * 0.75 * ppu, yEyes + 2, 1, cx + s * 0.75 * ppu, yEyes + 2, 0.75 * ppu);
      g.addColorStop(0, rgba(skinD, 0.3)); g.addColorStop(1, rgba(skinD, 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, HR[1]);
    }
    // Nariz: sombra lateral y fosas
    g = ctx.createLinearGradient(cx - 0.35 * ppu, 0, cx + 0.35 * ppu, 0);
    g.addColorStop(0, rgba(skinD, 0.35)); g.addColorStop(0.5, rgba(skinL, 0.25)); g.addColorStop(1, rgba(skinD, 0.35));
    ctx.fillStyle = g; ctx.fillRect(cx - 0.35 * ppu, yEyes - 2, 0.7 * ppu, yNose - yEyes + 4);
    ctx.fillStyle = rgba(skinD, 0.75);
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + s * 0.2 * ppu, yNose + 3, 0.09 * ppu, 0.06 * ppu, 0, 0, Math.PI * 2); ctx.fill(); }
    // Ojos: almendra, iris, pupila, brillo, párpados
    const ex = 0.72 * ppu, ew = 0.37 * ppu, eh = 0.18 * ppu;
    const iris = ['#3B2314', '#5A3A1E', '#2E4A3A', '#3A4E78'][L.seed % 4];
    for (const s of [-1, 1]) {
      const x = cx + s * ex, y = yEyes;
      ctx.save();
      ctx.beginPath(); ctx.ellipse(x, y, ew, eh, 0, 0, Math.PI * 2); ctx.clip();
      g = ctx.createLinearGradient(0, y - eh, 0, y + eh);
      g.addColorStop(0, '#D9D6D0'); g.addColorStop(0.35, '#FBFAF7'); g.addColorStop(1, '#F1EEE8');
      ctx.fillStyle = g; ctx.fillRect(x - ew, y - eh, ew * 2, eh * 2);
      ctx.fillStyle = iris; ctx.beginPath(); ctx.arc(x - s * 0.02 * ppu, y + 1, 0.14 * ppu, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = shade(iris, -0.5); ctx.stroke();
      ctx.beginPath(); ctx.arc(x - s * 0.02 * ppu, y + 1, 0.068 * ppu, 0, Math.PI * 2); ctx.fillStyle = '#0B0806'; ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(x - s * 0.02 * ppu - 0.05 * ppu, y - 0.04 * ppu, 0.04 * ppu, 0, Math.PI * 2); ctx.fill();
      g = ctx.createLinearGradient(0, y - eh, 0, y - eh * 0.2);
      g.addColorStop(0, 'rgba(60,30,20,.5)'); g.addColorStop(1, 'rgba(60,30,20,0)');
      ctx.fillStyle = g; ctx.fillRect(x - ew, y - eh, ew * 2, eh);
      ctx.restore();
      ctx.strokeStyle = '#1A110B'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.ellipse(x, y, ew + 1, eh + 1, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
      ctx.strokeStyle = rgba(skinD, 0.8); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(x, y, ew + 1, eh + 1, 0, Math.PI * 0.1, Math.PI * 0.9); ctx.stroke();
      ctx.strokeStyle = rgba(skinD, 0.5); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x, y - 3, ew + 2, eh + 5, 0, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    }
    // Cejas (rival: fruncidas, más gruesas y bajas en el entrecejo)
    ctx.strokeStyle = shade(hair, 0.05); ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
      const x = cx + s * ex, y = yBrow + 2;
      const inner = rival ? 12 : -3;
      ctx.lineWidth = rival ? 11 : 7.5;
      ctx.beginPath();
      ctx.moveTo(x + s * ew * 1.15, y - (rival ? 4 : 1));
      ctx.quadraticCurveTo(x + s * ew * 0.1, y - (rival ? 6 : 9), x - s * ew * 0.95, y + inner);
      ctx.stroke();
    }
    if (rival) { // arrugas del entrecejo y sombra
      ctx.strokeStyle = rgba(skinD, 0.75); ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(cx - 5, yBrow + 8); ctx.lineTo(cx - 3, yBrow - 12); ctx.moveTo(cx + 5, yBrow + 8); ctx.lineTo(cx + 3, yBrow - 12); ctx.stroke();
      g = ctx.createRadialGradient(cx, yBrow + 4, 1, cx, yBrow + 4, 0.5 * ppu);
      g.addColorStop(0, rgba(skinD, 0.35)); g.addColorStop(1, rgba(skinD, 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, HR[1]);
    }
    // Boca serena (rival: recta y tensa)
    const mw = 0.5 * ppu, my = yMouth + 2;
    ctx.strokeStyle = shade(skin, -0.5); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx - mw, my - (rival ? -1 : 1)); ctx.quadraticCurveTo(cx, my + (rival ? 0 : 5), cx + mw, my - (rival ? -1 : 1)); ctx.stroke();
    ctx.fillStyle = rgba(mix(skin, '#B0463F', 0.35), 0.75);
    ctx.beginPath(); ctx.moveTo(cx - mw * 0.9, my + 1); ctx.quadraticCurveTo(cx, my + 12, cx + mw * 0.9, my + 1); ctx.quadraticCurveTo(cx, my + 5, cx - mw * 0.9, my + 1); ctx.fill();
    // Barba corta: mandíbula, mentón y bigote (con grano)
    if (L.beard) {
      ctx.save();
      ctx.beginPath();
      const bw = 2.55 * ppu;
      ctx.moveTo(cx - bw, yEyes + 6);
      ctx.quadraticCurveTo(cx - bw * 1.05, yMouth + 10, cx - bw * 0.55, yChin + 18);
      ctx.quadraticCurveTo(cx, yChin + 34, cx + bw * 0.55, yChin + 18);
      ctx.quadraticCurveTo(cx + bw * 1.05, yMouth + 10, cx + bw, yEyes + 6);
      ctx.lineTo(cx + bw - 0.25 * ppu, yEyes + 6);
      ctx.quadraticCurveTo(cx + bw * 0.75, yMouth, cx + mw * 1.3, yMouth - 12);
      ctx.lineTo(cx - mw * 1.3, yMouth - 12);
      ctx.quadraticCurveTo(cx - bw * 0.75, yMouth, cx - bw + 0.25 * ppu, yEyes + 6);
      ctx.closePath();
      ctx.fillStyle = rgba(hair, 0.82); ctx.fill();
      ctx.clip();
      ctx.fillStyle = rgba(hair, 0.9);
      ctx.beginPath(); ctx.ellipse(cx, yMouth - 9, mw * 1.25, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgba(skin, 0.35);
      for (let i = 0; i < 500; i++) { ctx.fillRect(cx - bw + r() * bw * 2, yEyes + r() * (yChin + 40 - yEyes), 1.5, 1.5); }
      ctx.restore();
      ctx.strokeStyle = shade(skin, -0.5); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx - mw, my); ctx.quadraticCurveTo(cx, my + (rival ? 0 : 5), cx + mw, my); ctx.stroke();
    }
    // Cuero cabelludo: encima de la línea de pelo (polígono suave), patillas afinadas
    const style = L.style;
    const scalpColor = style === 'pelado' ? skin : style === 'rapado' ? mix(hair, skin, 0.42) : shade(hair, -0.05);
    if (style !== 'pelado') {
      const hl = style === 'rapado' ? hairline(1.22, 1.5, 1.9) : style === 'rulos' ? hairline(1.22, 1.58, 1.95) : HAIRLINE_STD;
      ctx.fillStyle = scalpColor;
      ctx.beginPath(); ctx.moveTo(0, HR[0]);
      const N = 96;
      for (let i = 0; i <= N; i++) {
        const u = i / N, a = (u - 0.5) * Math.PI * 2;
        const yLocal = HEAD_C.y + Math.cos(hl(a) + 0.03) * HEAD_R.y;
        const v = yToV(headRingsDef, hv, yLocal);
        ctx.lineTo(u * W, rowOf(HR, v));
      }
      ctx.lineTo(W, HR[0]); ctx.closePath(); ctx.fill();
      // sombra fina bajo la línea de pelo (da volumen al casquete)
      ctx.strokeStyle = rgba(skinD, style === 'rapado' ? 0.25 : 0.45); ctx.lineWidth = 4;
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const u = i / N, a = (u - 0.5) * Math.PI * 2;
        const yLocal = HEAD_C.y + Math.cos(hl(a) + 0.03) * HEAD_R.y;
        const py = rowOf(HR, yToV(headRingsDef, hv, yLocal)) + 2;
        if (i) ctx.lineTo(u * W, py); else ctx.moveTo(u * W, py);
      }
      ctx.stroke();
      // Patillas: franja que se afina desde la línea de pelo hasta la altura de los ojos, delante de la oreja
      ctx.fillStyle = rgba(scalpColor, style === 'rapado' ? 0.75 : 0.95);
      for (const s of [-1, 1]) {
        const x = cx + s * 0.185 * W;
        const aTop = (0.185 * s) * Math.PI * 2;
        const yTop = rowOf(HR, yToV(headRingsDef, hv, HEAD_C.y + Math.cos(hl(aTop)) * HEAD_R.y)) - 2;
        ctx.beginPath(); ctx.moveTo(x - 9, yTop); ctx.lineTo(x + 9, yTop); ctx.lineTo(x + 3 + s * 2, yEyes + 10); ctx.lineTo(x - 3 + s * 2, yEyes + 10); ctx.closePath(); ctx.fill();
      }
    } else {
      g = ctx.createRadialGradient(cx, HR[0] + 40, 5, cx, HR[0] + 40, 160);
      g.addColorStop(0, rgba(skinL, 0.5)); g.addColorStop(1, rgba(skinL, 0));
      ctx.fillStyle = g; ctx.fillRect(0, HR[0], W, yForehead - HR[0]);
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
    const back = { hw: 112, depth: (yShoulders - topY) * 1.2 };
    const hole = { hw: 100, depth: yChest - topY };
    for (const pass of [0, 1]) {
      const color = pass === 0 ? trim : skin;
      const d = pass === 0 ? trimW : 0;
      scoop(front.x, front.hw + d, topY, front.depth + d, color);
      scoop(0, back.hw + d, topY, back.depth + d, color); scoop(W, back.hw + d, topY, back.depth + d, color);
      scoop(W * 0.25, hole.hw + d, topY, hole.depth + d, color); scoop(W * 0.75, hole.hw + d, topY, hole.depth + d, color);
    }
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
    const nm = String(L.name || '').toUpperCase().slice(0, 12);
    if (nm) {
      const hPx = Math.round(1.55 * ppuY);
      ctx.save(); ctx.font = fontStack(hPx); ctx.fillStyle = numColor; ctx.strokeStyle = outline; ctx.lineWidth = 2.5;
      const natural = ctx.measureText(nm).width / ppuX;
      const sx = Math.min(aspect * 0.92, 9.5 / natural);
      for (const x of [0, W]) { ctx.save(); ctx.translate(x, yShoulders + (yPecs - yShoulders) * 0.52); ctx.scale(sx, 1); ctx.strokeText(nm, 0, 0); ctx.fillText(nm, 0, 0); ctx.restore(); }
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
    // fondo del short (entrepierna) oscuro
    ctx.fillStyle = shade(jersey, -0.5); ctx.fillRect(0, PR[1] - 4, W, 4);
    const THR = REG.thigh;
    const thv = rings.thigh.v, thn = rings.thigh.names;
    const yHem = rowOf(THR, thv[thn.indexOf('hem')]), ySkin = rowOf(THR, thv[thn.indexOf('skin')]);
    ctx.fillStyle = g; ctx.fillRect(0, THR[0], W, yHem - THR[0]);
    ctx.fillStyle = 'rgba(0,0,0,.035)'; for (let y = THR[0]; y < yHem; y += 2) ctx.fillRect(0, y, W, 1);
    ctx.fillStyle = trim; ctx.fillRect(W * 0.75 - 7, THR[0], 14, yHem - THR[0]); // franja lateral
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
    ctx.fillStyle = '#F1F0EB'; ctx.fillRect(0, ySock, W, SR[1] - ySock);
    ctx.fillStyle = trim; ctx.fillRect(0, ySock, W, 6);
    ctx.fillStyle = jersey; ctx.fillRect(0, ySock + 8, W, 3);
    ctx.fillStyle = 'rgba(0,0,0,.05)'; for (let y = ySock; y < SR[1]; y += 2) ctx.fillRect(0, y, W, 1);
    g = ctx.createLinearGradient(0, SR[1] - 14, 0, SR[1]);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.25)');
    ctx.fillStyle = g; ctx.fillRect(0, SR[1] - 14, W, 14);

    // ---------- Zapatilla: suela en los bordes (u = 0 y 1), empeine al centro
    const ZR = REG.shoe;
    const shoeDark = '#22222A', sole = '#ECE9E2';
    ctx.fillStyle = shoeDark; ctx.fillRect(0, ZR[0], W, ZR[1] - ZR[0]);
    g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,.14)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, ZR[0], W, ZR[1] - ZR[0]);
    const soleW = 118;
    ctx.fillStyle = sole; ctx.fillRect(0, ZR[0], soleW, ZR[1] - ZR[0]); ctx.fillRect(W - soleW, ZR[0], soleW, ZR[1] - ZR[0]);
    ctx.fillStyle = '#B9B5AD'; ctx.fillRect(soleW - 10, ZR[0], 10, ZR[1] - ZR[0]); ctx.fillRect(W - soleW, ZR[0], 10, ZR[1] - ZR[0]);
    ctx.fillStyle = trim; ctx.fillRect(soleW - 16, ZR[0], 6, ZR[1] - ZR[0]); ctx.fillRect(W - soleW + 10, ZR[0], 6, ZR[1] - ZR[0]);
    ctx.strokeStyle = trim; ctx.lineWidth = 9; ctx.lineCap = 'round';
    for (const x of [W * 0.25, W * 0.75]) {
      ctx.beginPath(); ctx.moveTo(x - 90, ZR[1] - 12); ctx.quadraticCurveTo(x + 10, ZR[1] - 30, x + 60, ZR[0] + 18); ctx.stroke();
    }
    ctx.fillStyle = '#3A3A44'; ctx.fillRect(cx - 40, ZR[0] + 14, 80, 40);
    ctx.strokeStyle = '#E8E6E0'; ctx.lineWidth = 4;
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(cx - 34, ZR[0] + 18 + i * 9); ctx.lineTo(cx + 34, ZR[0] + 24 + i * 9); ctx.stroke(); }
    g = ctx.createLinearGradient(0, ZR[1] - 16, 0, ZR[1]);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,.4)');
    ctx.fillStyle = g; ctx.fillRect(soleW, ZR[1] - 16, W - 2 * soleW, 16);
    ctx.fillStyle = '#15151B'; ctx.fillRect(soleW, ZR[0], W - 2 * soleW, 8);

    // ---------- Muestras
    const sw = (s, color) => { ctx.fillStyle = color; ctx.fillRect(s[0], s[2], s[1] - s[0], s[3] - s[2]); };
    sw(SW.upperArm, skin); sw(SW.forearm, skin); sw(SW.hand, skin);
    g = ctx.createLinearGradient(0, SW.upperArm[2], 0, SW.upperArm[3]);
    g.addColorStop(0, rgba(skinD, 0.25)); g.addColorStop(0.5, rgba(skinD, 0)); g.addColorStop(1, rgba(skinD, 0));
    ctx.fillStyle = g; ctx.fillRect(0, SW.upperArm[2], W, 40);
    sw(SW.hair, style === 'rapado' ? mix(hair, skin, 0.3) : hair); sw(SW.trim, trim); sw(SW.jersey, jersey); sw(SW.white, '#F1F0EB'); sw(SW.dark, '#22222A');
    ctx.restore();
  }

  // Mapa de rugosidad (un cuarto de resolución): gris = rugosidad
  function paintRoughness(ctx, L) {
    const s = 0.25, W = ATLAS * s;
    const fill = (reg, v) => { ctx.fillStyle = `rgb(${v * 255},${v * 255},${v * 255})`; ctx.fillRect(0, reg[0] * s, W, (reg[1] - reg[0]) * s); };
    const fillSw = (sw, v) => { ctx.fillStyle = `rgb(${v * 255},${v * 255},${v * 255})`; ctx.fillRect(sw[0] * s, sw[2] * s, (sw[1] - sw[0]) * s, (sw[3] - sw[2]) * s); };
    fill([0, ATLAS], 0.8);
    fill(REG.head, L.style === 'pelado' ? 0.55 : 0.72);
    fill(REG.torso, 0.9); fill(REG.pelvis, 0.92); fill(REG.thigh, 0.88); fill(REG.shin, 0.86); fill(REG.shoe, 0.42);
    fillSw(SW.upperArm, 0.72); fillSw(SW.forearm, 0.72); fillSw(SW.hand, 0.72);
    fillSw(SW.hair, 0.62); fillSw(SW.trim, 0.85); fillSw(SW.jersey, 0.9); fillSw(SW.white, 0.9); fillSw(SW.dark, 0.5);
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
    e = { key, map, rough, refs: 1 };
    texCache.set(key, e);
    if (texCache.size > 48) {
      for (const [k2, e2] of texCache) { if (e2.refs <= 0) { e2.map.dispose(); e2.rough.dispose(); texCache.delete(k2); if (texCache.size <= 36) break; } }
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
  const CH = ['hips.x', 'hips.y', 'hips.z', 'hips.lean', 'hips.twist', 'hips.tilt', 'spineX', 'spineY', 'chestX', 'neckX', 'neckY', 'neckZ', 'headX', 'headZ'];
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
    idle(P, t, M) {
      const br = Math.sin(t * 2.2), sx = M.shoulder.x;
      set(P, 'hips', { x: 0.5, y: 0.2 * br, lean: 2.5 + 0.6 * br, tilt: 1.6 + 0.6 * Math.sin(t * 1.1) });
      P.chestX = -1.5 + 1.0 * br; P.neckY = 5 * Math.sin(t * 0.7); P.headZ = 2 * Math.sin(t * 0.5); P.neckX = -2;
      // brazos relajados a los costados, palmas hacia los muslos, leve flexión del codo
      arm(P, R, [-(sx + 2.4), SH_Y - 16.6 + 0.3 * br, 1.6], [-0.55, 0, -1], 10, 60, 0);
      arm(P, Lf, [sx + 2.6, SH_Y - 16.4 + 0.3 * br, 1.9], [0.55, 0, -1], 10, -60, 0);
      leg(P, R, [-4.8, ANK, 0.9], [-0.15, 0, 1]);
      leg(P, Lf, [5.4, ANK, -0.7], [0.2, 0, 1]);
    },
    run(P, t, M) {
      const c = (t / 0.55) * Math.PI * 2, sx = M.shoulder.x;
      const hy = -3.0 + 1.3 * Math.abs(Math.sin(c)), lean = 17;
      set(P, 'hips', { y: hy, lean, twist: 6 * Math.sin(c), tilt: 2 * Math.sin(c) });
      P.chestX = -2; P.neckX = -13; P.spineY = -4 * Math.sin(c); P.spineX = 3;
      // hombro estimado con la cadera baja y el tronco inclinado
      const shy = SH_Y + hy - 12.8 * (1 - Math.cos(lean * DEG)), shz = 12.8 * Math.sin(lean * DEG) + 0.2;
      for (const s of [R, Lf]) {
        const p = c + (s > 0 ? Math.PI : 0);
        const swing = Math.max(0, -Math.sin(p - 0.35));                // 1 en mitad del vuelo
        const heel = Math.max(0, -Math.sin(p + 0.5));                  // talón atrás al despegar
        leg(P, s, [s * 4.6, ANK + swing * swing * 10.5 + heel * 2.5, 10.5 * Math.cos(p) - 1.5], [s * 0.1, 0, 1], 28 * heel - 8 * swing);
        // brazos opuestos: péndulo desde el hombro con el codo a ~90°
        const a = -Math.cos(p) * 48 * DEG;
        arm(P, s, [s * (sx + 2.4), shy - 9 * Math.cos(a) + 6.0 * Math.sin(a) - 3.0, shz + 9 * Math.sin(a) + 8.6 * Math.cos(a) - 1.5], [s * 0.5, 0.05, -1], 62, -s * 60, 0);
      }
    },
    guard(P, t) {
      const sw = Math.sin(t * 2.6);
      set(P, 'hips', { y: -5.2, x: 2.2 * sw, lean: 14, tilt: -3 * sw });
      P.chestX = -4; P.neckX = -8; P.neckY = 5 * sw;
      // brazos abiertos a los lados con las palmas al frente, codos abajo
      arm(P, R, [-19.5 - 0.6 * sw, SH_Y - 6.5, 7.5], [-0.3, -1, -0.6], -20, -40, 0);
      arm(P, Lf, [19.5 - 0.6 * sw, SH_Y - 6.5, 7.5], [0.3, -1, -0.6], -20, 40, 0);
      leg(P, R, [-10.5 + 1.2 * sw, ANK, 1], [-0.35, 0, 1]);
      leg(P, Lf, [10.5 + 1.2 * sw, ANK, -1], [0.35, 0, 1]);
    },
    dribble(P, t) {
      // b: 1 = mano arriba (recibe la pelota), 0 = mano abajo (la empuja al piso)
      const b = 0.5 + 0.5 * Math.cos((t / 0.5) * Math.PI * 2);
      set(P, 'hips', { y: -7.0 - (1 - b) * 3.0, lean: 28 + (1 - b) * 14, twist: -10, tilt: -2 });
      P.chestX = -4; P.neckX = -22 - (1 - b) * 9; P.neckY = -4; P.spineX = 2;
      // mano derecha que pica (baja hasta cerca del piso), brazo izquierdo que protege la pelota
      arm(P, R, [-8.2, 6.8 + b * 16.2, 10.5 - (1 - b) * 1.5], [-0.75, 0.25, -1], 62 - b * 30, 180, 0);
      arm(P, Lf, [10.0, 24.5 - (1 - b) * 2.5, 12.0], [1, -0.1, -0.6], 15, -60, 0);
      leg(P, R, [-6.8, ANK, -4.5], [-0.2, 0, 1]);
      leg(P, Lf, [7.2, ANK, 3.5], [0.2, 0, 1]);
    },
    pass(P) {
      set(P, 'hips', { y: -1.8, lean: 10 });
      P.chestX = 2; P.neckX = -6;
      arm(P, R, [-5.8, SH_Y - 6, 16.5], [-1, -0.3, 0], 12, 0, 0);
      arm(P, Lf, [5.8, SH_Y - 6, 16.5], [1, -0.3, 0], 12, 0, 0);
      leg(P, R, [-5.5, ANK, -4], [-0.1, 0, 1], 18);
      leg(P, Lf, [5.5, ANK, 9], [0.1, 0, 1]);
    },
    catch(P) {
      set(P, 'hips', { y: -1.2, lean: 2 });
      P.chestX = -6; P.neckX = -12;
      arm(P, R, [-10.5, SH_Y + 9, 7], [-1, 0, -0.4], -25, 0, 0);
      arm(P, Lf, [10.5, SH_Y + 9, 7], [1, 0, -0.4], -25, 0, 0);
      leg(P, R, [-6.5, ANK, 0.8], [-0.2, 0, 1]);
      leg(P, Lf, [6.5, ANK, -0.4], [0.2, 0, 1]);
    },
    shoot(P, t, M, J) {
      const air = clamp((J || 0) / 6, 0, 1);
      set(P, 'hips', { y: 0, lean: -5, twist: -4 });
      P.chestX = -5; P.neckX = -24;
      // brazo de tiro extendido arriba con la muñeca quebrada; mano guía al costado de la pelota
      arm(P, R, [-3.2, SH_Y + 17.2, 5.0], [-0.1, 0.1, 1], 72, 180, 0);
      arm(P, Lf, [5.2, SH_Y + 12.5, 8.0], [1, 0.2, 0.3], 20, 0, 0);
      leg(P, R, [-4.8, ANK + air * 5.5, 0.5 + air * 2], [-0.1, 0, 1], 35 * air);
      leg(P, Lf, [5, ANK + air * 4, -1 - air * 2.5], [0.1, 0, 1], 45 * air);
    },
    celebrate(P, t) {
      const j = Math.max(0, Math.sin((t / 0.62) * Math.PI * 2));
      set(P, 'hips', { y: j * 4.5, lean: -8, tilt: 3, twist: 6 });
      P.chestX = -6; P.neckX = -20;
      arm(P, R, [-8, SH_Y + 17, -1], [-1, 0, -0.5], 55, 180, 0);          // puño al cielo
      arm(P, Lf, [19, SH_Y + 5, 1], [0.5, -1, -0.3], -15, 60, 0);          // brazo abierto
      leg(P, R, [-6, ANK + j * 3.5, -0.5 - j], [-0.2, 0, 1], 25 * j);
      leg(P, Lf, [6, ANK + j * 3.5, -0.5 - j], [0.2, 0, 1], 25 * j);
    },
    steal(P) {
      set(P, 'hips', { y: -6, lean: 32, twist: -10 });
      P.chestX = 2; P.neckX = -26;
      arm(P, R, [-7, 20.5, 24.5], [-0.6, -1, 0], -15, 180, 0);          // brazo extendido al frente
      arm(P, Lf, [13, 27, -8], [1, -0.4, -0.3], 10, -60, 0);
      leg(P, R, [-7.5, ANK, 13.5], [-0.2, 0, 1]);
      leg(P, Lf, [5.5, ANK, -10], [0.2, 0, 1], 25);
    },
    sad(P, t) {
      const br = Math.sin(t * 1.6);
      set(P, 'hips', { y: -0.8, lean: 9, tilt: 2 });
      P.chestX = 10; P.neckX = 26; P.headX = 8; P.neckY = 3 * br;
      arm(P, R, [-8.6, 27.0, 3.2 + 0.2 * br], [-1, 0.3, -0.7], -10, 0, 40);   // manos en la cintura
      arm(P, Lf, [8.6, 27.0, 3.2 + 0.2 * br], [1, 0.3, -0.7], -10, 0, -40);
      leg(P, R, [-4.5, ANK, 0.5], [-0.05, 0, 1]);
      leg(P, Lf, [4.8, ANK, -0.3], [0.1, 0, 1]);
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
      this.jump = 0; this.alpha = 1; this.ringMesh = null; this.starMesh = null; this.ringColor = null;
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
      const mat = this.mat = new T.MeshStandardMaterial({ map: tex.map, roughnessMap: tex.rough, roughness: 1, metalness: 0 });
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
      for (const s of ['R', 'L']) { const o = new T.Object3D(); o.position.set(0, -2.6, 0.9); this.B['wrist' + s].add(o); this.handPts[s] = o; }
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
      spine.rotation.set(P.spineX * DEG, P.spineY * DEG, 0);
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
    update(now) {
      now = now || 0; this.lastNow = now;
      const t = now / 1000 + this.L.phase;
      let P = evalPose(this.pose, t, this.M, this.jump);
      const k = (now - this.poseT0) / TRANSITION;
      if (this.prevPose && k < 1) P = blendPose(evalPose(this.prevPose, t, this.M, this.jump), P, smooth(k));
      else this.prevPose = null;
      this._apply(P);
      if (this.starMesh) { this.starMesh.rotation.y = now / 900; this.starMesh.position.y = HEIGHT + 7 + Math.sin(now / 500) * 0.8 + this.jump / this.L.h; }
      return this;
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
      if (this.starMesh) { const s = this.starMesh.position.clone().multiplyScalar(this.L.h); box.expandByPoint(s.clone().addScalar(4.6)); box.expandByPoint(s.clone().subScalar(4.6)); }
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
