// Escena 3D de "Jugada Maestra" (Contrato A): estadio cerrado de básquet, cancha de parqué con las
// líneas exactas del motor, aro con red, público instanciado, luces con sombras, pelota, cámara
// tipo Score! Hero y overlays dibujados sobre el piso.
// Requiere THREE (r158, build UMD) como global. Expone window.Scene3D.
(function (root) {
  'use strict';
  const T = root.THREE;

  // ------------------------------------------------------------------ Constantes del juego
  const COURT = { w: 360, h: 600 };        // media cancha jugable (unidades de cancha)
  const HOOP = { x: 180, y: 70 };          // aro en coordenadas de cancha
  const RANGE = 210;                       // línea de triple = alcance de tiro
  const WALL_T = 12;                       // grosor de los obstáculos
  const HOOP_H = 73;                       // 3,05 m
  const RIM_R = 5.4;                       // radio del aro
  const BOARD_W = 43, BOARD_H = 25;        // tablero 1,8 × 1,05 m
  const BOARD_Z = -230 - RIM_R - 3.6;      // plano frontal del tablero (15 cm detrás del aro)

  // Huella interior de la tribuna (el "bowl"): la cancha completa va de z = -300 a z = 900.
  const BOWL = { x: 250, z0: -370, z1: 970 };
  const ROOF_Y = 420;

  const FOV = 56;                          // fov vertical de la cámara de juego
  const CAM_ELEV = 0.56;                   // tan(29°): cuánto sube la cámara por unidad de distancia

  // ------------------------------------------------------------------ Utilidades
  function lcg(seed) {                     // generador determinista (sin Math.random)
    let s = (seed >>> 0) || 1;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  function courtToWorld(x, y, h, out) {
    return (out || new T.Vector3()).set(x - 180, h || 0, y - 300);
  }
  function worldToCourt(v) { return { x: v.x + 180, y: v.z + 300 }; }

  // Fusiona geometrías (con su matriz) en una sola, no indexada, con position/normal/uv.
  function mergeGeoms(items) {
    const pos = [], nor = [], uv = [];
    for (const it of items) {
      let g = it.geo.index ? it.geo.toNonIndexed() : it.geo.clone();
      if (it.matrix) g.applyMatrix4(it.matrix);
      const p = g.attributes.position.array, n = g.attributes.normal.array;
      const u = g.attributes.uv ? g.attributes.uv.array : new Float32Array((p.length / 3) * 2);
      for (let i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(n[i]); }
      for (let i = 0; i < u.length; i++) uv.push(u[i]);
      g.dispose();
    }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    out.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    return out;
  }
  const M4 = () => new T.Matrix4();
  function placed(geo, x, y, z, ry, sx, sy, sz) {
    const m = M4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(0, ry || 0, 0)), new T.Vector3(sx || 1, sy || 1, sz || 1));
    return { geo, matrix: m };
  }

  function canvasTex(w, h, draw, opts) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    tex.anisotropy = (opts && opts.aniso) || 1;
    if (opts && opts.repeat) { tex.wrapS = tex.wrapT = T.RepeatWrapping; }
    return tex;
  }

  // ------------------------------------------------------------------ Textura de la cancha
  // Reproduce exactamente paintCourt de game.js (parqué + líneas) a k píxeles por unidad.
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
        // veta fina a lo largo de la tabla
        g.fillStyle = 'rgba(110,64,22,.07)';
        for (let k = 0; k < 3; k++) g.fillRect(x + 3 + rnd() * 12, y, 0.6, len);
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
    const R = RANGE;
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
  function courtTexture(k, aniso) {
    return canvasTex(COURT.w * k, COURT.h * k, (g) => { g.setTransform(k, 0, 0, k, 0, 0); paintCourt(g, COURT.w, COURT.h); }, { aniso });
  }

  // ------------------------------------------------------------------ Textura de la pelota
  function ballTexture() {
    return canvasTex(512, 256, (g, w, h) => {
      const grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, '#F08A3C'); grd.addColorStop(.5, '#E8702A'); grd.addColorStop(1, '#C9551A');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
      // poros
      const rnd = lcg(11);
      g.fillStyle = 'rgba(80,30,5,.12)';
      for (let i = 0; i < 2500; i++) g.fillRect(rnd() * w, rnd() * h, 1.5, 1.5);
      g.strokeStyle = '#1E0C04'; g.lineWidth = 5; g.lineCap = 'round';
      // ecuador y dos meridianos
      g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
      for (const u of [0.25, 0.75]) { g.beginPath(); g.moveTo(u * w, 0); g.lineTo(u * w, h); g.stroke(); }
      // dos gajos curvos
      for (const s of [1, -1]) {
        g.beginPath();
        for (let i = 0; i <= 200; i++) {
          const u = i / 200;
          const v = 0.5 + s * 0.27 * Math.sin(u * Math.PI * 2);
          if (i === 0) g.moveTo(u * w, v * h); else g.lineTo(u * w, v * h);
        }
        g.stroke();
      }
    });
  }

  // ------------------------------------------------------------------ Carteles LED (marcas ficticias)
  const BRANDS = [
    ['JUGADA MAESTRA', '#F26B1D', '#FFFFFF'], ['LIGA MAESTRA', '#0E1A31', '#FFC53D'],
    ['HALCONES BC', '#B3202A', '#F5F0E6'], ['CAFÉ PIVOT', '#4A2A12', '#F7EEDF'],
    ['BANCO DEL SUR', '#1F3C88', '#FFFFFF'], ['ZAPATILLAS RAYO', '#111111', '#F2C230'],
    ['TOROS BC', '#1C1C1C', '#E8B04B'], ['AGUA CRISTAL', '#2AA3C9', '#FFFFFF'],
    ['CÓNDORES BC', '#3A2E73', '#FFFFFF'], ['RADIO ESTADIO', '#F2C230', '#22223B'],
  ];
  function ledTexture() {
    const W = 2048, H = 80;
    return canvasTex(W, H, (g) => {
      const n = BRANDS.length, pw = W / n;
      for (let i = 0; i < n; i++) {
        const [name, bg, fg] = BRANDS[i];
        g.fillStyle = bg; g.fillRect(i * pw, 0, pw, H);
        g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(i * pw, 0, pw, H / 2);
        g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
        fitText(g, name, pw - 24, 44, 'bold', '"Barlow Condensed", "Arial Narrow", Impact, sans-serif');
        g.fillText(name, i * pw + pw / 2, H / 2 + 2);
        g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(i * pw + pw - 2, 0, 2, H);
      }
    }, { repeat: true });
  }
  // Pancarta grande para la pared de la tribuna
  // Elige el tamaño de fuente más grande (≤ max) con el que el texto entra en maxW.
  function fitText(g, text, maxW, max, weight, family) {
    let size = max;
    for (; size > 10; size -= 4) { g.font = `${weight} ${size}px ${family}`; if (g.measureText(text).width <= maxW) break; }
  }
  function bannerTexture(text, bg, fg) {
    return canvasTex(1024, 256, (g, w, h) => {
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.strokeStyle = fg; g.lineWidth = 10; g.strokeRect(14, 14, w - 28, h - 28);
      g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
      fitText(g, text, w - 90, 150, 'bold', '"Barlow Condensed", "Arial Narrow", Impact, sans-serif');
      g.fillText(text, w / 2, h / 2 + 8);
    });
  }
  function scoreboardTexture() {
    return canvasTex(512, 256, (g, w, h) => {
      g.fillStyle = '#05070D'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#F26B1D'; g.textAlign = 'center'; g.textBaseline = 'middle';
      fitText(g, 'JUGADA MAESTRA', w - 40, 60, 'bold', '"Barlow Condensed", Impact, sans-serif');
      g.fillText('JUGADA MAESTRA', w / 2, 52);
      g.fillStyle = '#FFC53D'; g.font = 'bold 120px "Barlow Condensed", Impact, sans-serif';
      g.fillText('0   :   0', w / 2, 160);
      g.fillStyle = '#F7EEDF'; g.font = 'bold 34px "Barlow Condensed", Impact, sans-serif';
      g.fillText('LOCAL                         VISITA', w / 2, 232);
    });
  }
  function haloTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,245,220,1)'); grd.addColorStop(.18, 'rgba(255,240,205,.85)');
    grd.addColorStop(.5, 'rgba(255,230,180,.18)'); grd.addColorStop(1, 'rgba(255,220,160,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace; return tex;
  }

  // ------------------------------------------------------------------ Creación de la escena
  function create(opts) {
    opts = opts || {};
    const canvas = opts.canvas;
    const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    const maxAniso = renderer.capabilities.getMaxAnisotropy();

    const scene = new T.Scene();
    scene.background = new T.Color(0x06080f);
    scene.fog = new T.Fog(0x0a0d18, 700, 2600);

    const camera = new T.PerspectiveCamera(FOV, 390 / 560, 2, 3200);
    camera.position.set(0, 160, 520);
    camera.lookAt(0, 20, -230);

    let cssW = 390, cssH = 560;
    const disposables = [];                 // geometrías/materiales/texturas a liberar
    const track = (o) => { disposables.push(o); return o; };

    const world = new T.Group(); scene.add(world);     // estadio fijo
    const dyn = new T.Group(); scene.add(dyn);         // jugadores (add/remove)
    const wallsGroup = new T.Group(); scene.add(wallsGroup);
    const overlayGroup = new T.Group(); scene.add(overlayGroup);

    // ---------------------------------------------------------------- Luces
    const hemi = new T.HemisphereLight(0xcfe0ff, 0x6b4a2a, 1.25);
    scene.add(hemi);
    const sun = new T.DirectionalLight(0xfff2e0, 2.6);
    sun.position.set(-170, 420, 170);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -420, right: 420, top: 420, bottom: -420, near: 50, far: 1000 });
    sun.shadow.bias = -0.00035;
    sun.shadow.normalBias = 1.4;
    sun.shadow.radius = 2;
    scene.add(sun); scene.add(sun.target);
    // relleno frío desde el lado opuesto (sin sombra) para que las caras en sombra no queden negras
    const fill = new T.DirectionalLight(0xbfd4ff, 0.55);
    fill.position.set(220, 300, -260);
    scene.add(fill);
    // puntos cálidos: reflejo de los focos sobre el parqué
    const warm1 = new T.PointLight(0xffd9a0, 260000, 900, 2); warm1.position.set(90, 300, -120); scene.add(warm1);
    const warm2 = new T.PointLight(0xffd9a0, 200000, 900, 2); warm2.position.set(-110, 300, 190); scene.add(warm2);

    // ---------------------------------------------------------------- Cancha
    const courtMat = track(new T.MeshStandardMaterial({ map: track(courtTexture(3, maxAniso)), roughness: 0.42, metalness: 0.0 }));
    const courtGeo = track(new T.PlaneGeometry(COURT.w, COURT.h));
    const court = new T.Mesh(courtGeo, courtMat);
    court.rotation.x = -Math.PI / 2;
    court.receiveShadow = true;
    world.add(court);
    // mitad de cancha del fondo (espejada, textura chica)
    const farMat = track(new T.MeshStandardMaterial({ map: track(courtTexture(1, 4)), roughness: 0.45 }));
    const farCourt = new T.Mesh(courtGeo, farMat);
    farCourt.rotation.set(-Math.PI / 2, 0, Math.PI);
    farCourt.position.z = COURT.h;
    farCourt.receiveShadow = true;
    world.add(farCourt);
    // piso perimetral (goma azul oscura) y banda clara
    const apronMat = track(new T.MeshStandardMaterial({ color: 0x1b2742, roughness: 0.85 }));
    const apron = new T.Mesh(track(new T.PlaneGeometry(BOWL.x * 2, BOWL.z1 - BOWL.z0)), apronMat);
    apron.rotation.x = -Math.PI / 2; apron.position.set(0, -0.25, (BOWL.z0 + BOWL.z1) / 2);
    apron.receiveShadow = true;
    world.add(apron);
    const trimMat = track(new T.MeshStandardMaterial({ color: 0x3b4f80, roughness: 0.8 }));
    const trim = new T.Mesh(track(mergeGeoms([
      placed(new T.PlaneGeometry(COURT.w + 16, 4), 0, 0, -304), placed(new T.PlaneGeometry(COURT.w + 16, 4), 0, 0, 904),
      placed(new T.PlaneGeometry(4, COURT.h * 2 + 12), -186, 0, 300), placed(new T.PlaneGeometry(4, COURT.h * 2 + 12), 186, 0, 300),
    ].map((it) => { it.matrix.multiply(M4().makeRotationX(-Math.PI / 2)); return it; }))), trimMat);
    trim.position.y = -0.1;
    world.add(trim);

    // ---------------------------------------------------------------- Tribunas (anillos escalonados)
    const ROWS = [];                       // { off, y, depth } por fila (off = distancia desde el borde interior)
    {
      let off = 10, y = 16;                 // la primera fila arranca sobre la pared frontal
      for (let k = 0; k < 13; k++) { ROWS.push({ off, y, depth: 16 }); off += 16; y += 9; }
      off += 28;                            // pasillo entre tribuna baja y alta
      for (let k = 0; k < 18; k++) { ROWS.push({ off, y, depth: 15, upper: true }); off += 15; y += 11; }
      ROWS.walkOff = ROWS[12].off + 16; ROWS.walkY = ROWS[12].y; ROWS.topOff = off; ROWS.topY = y;
    }
    function ringBoxes(off0, off1, y0, y1) {       // cuatro cajas que forman un anillo rectangular
      const cx = 0, cz = (BOWL.z0 + BOWL.z1) / 2;
      const hx0 = BOWL.x + off0, hx1 = BOWL.x + off1, hz0 = (BOWL.z1 - BOWL.z0) / 2 + off0, hz1 = (BOWL.z1 - BOWL.z0) / 2 + off1;
      const h = y1 - y0, ym = (y0 + y1) / 2;
      return [
        placed(new T.BoxGeometry(hx1 - hx0, h, hz1 * 2), cx - (hx0 + hx1) / 2, ym, cz),
        placed(new T.BoxGeometry(hx1 - hx0, h, hz1 * 2), cx + (hx0 + hx1) / 2, ym, cz),
        placed(new T.BoxGeometry(hx0 * 2, h, hz1 - hz0), cx, ym, cz - (hz0 + hz1) / 2),
        placed(new T.BoxGeometry(hx0 * 2, h, hz1 - hz0), cx, ym, cz + (hz0 + hz1) / 2),
      ];
    }
    const standParts = [];
    standParts.push(...ringBoxes(0, 10, 0, 16));                                  // pared frontal
    for (const r of ROWS) standParts.push(...ringBoxes(r.off, r.off + r.depth, 0, r.y));
    standParts.push(...ringBoxes(ROWS.walkOff, ROWS[13].off, 0, ROWS.walkY));     // pasillo
    standParts.push(...ringBoxes(ROWS.topOff, ROWS.topOff + 20, 0, ROWS.topY + 64)); // pared superior
    const standMat = track(new T.MeshStandardMaterial({ color: 0x8e95a3, roughness: 0.95 }));
    const stands = new T.Mesh(track(mergeGeoms(standParts)), standMat);
    world.add(stands);
    // pared frontal oscura + baranda del pasillo + baranda superior (merged, material oscuro)
    const darkMat = track(new T.MeshStandardMaterial({ color: 0x1a2238, roughness: 0.7 }));
    const railParts = ringBoxes(ROWS.walkOff - 1.5, ROWS.walkOff + 1.5, ROWS.walkY, ROWS.walkY + 10)
      .concat(ringBoxes(-1.5, 0, 15.2, 16.6))
      .concat(ringBoxes(ROWS[13].off - 2.5, ROWS[13].off - 0.5, ROWS[13].y - 11, ROWS[13].y + 10));
    const rails = new T.Mesh(track(mergeGeoms(railParts)), darkMat);
    world.add(rails);

    // carteles LED sobre la pared frontal (una sola malla, una textura)
    const ledTex = track(ledTexture());
    const ledMat = track(new T.MeshBasicMaterial({ map: ledTex, toneMapped: false }));
    {
      const cz = (BOWL.z0 + BOWL.z1) / 2, L = BOWL.z1 - BOWL.z0, Wd = BOWL.x * 2;
      const strip = (len, x, z, ry) => {
        const g = new T.PlaneGeometry(len, 11.5);
        const uv = g.attributes.uv; const rep = len / 520;
        for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * rep + (x + z) * 0.001);
        return placed(g, x, 8.2, z, ry);
      };
      const led = new T.Mesh(track(mergeGeoms([
        strip(L, -BOWL.x + 0.3, cz, Math.PI / 2), strip(L, BOWL.x - 0.3, cz, -Math.PI / 2),
        strip(Wd, 0, BOWL.z0 + 0.3, 0), strip(Wd, 0, BOWL.z1 - 0.3, Math.PI),
      ])), ledMat);
      world.add(led);
      // anillo LED grande sobre la pared superior (cierra el encuadre por arriba, como el anillo de un pabellón)
      const to = ROWS.topOff, L2 = L + to * 2, W2 = Wd + to * 2;
      const strip2 = (len, x, z, ry) => {
        const g = new T.PlaneGeometry(len, 20);
        const uv = g.attributes.uv; const rep = len / 900;
        for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * rep + 0.37);
        return placed(g, x, ROWS.topY + 48, z, ry);
      };
      world.add(new T.Mesh(track(mergeGeoms([
        strip2(L2, -BOWL.x - to + 0.6, cz, Math.PI / 2), strip2(L2, BOWL.x + to - 0.6, cz, -Math.PI / 2),
        strip2(W2, 0, BOWL.z0 - to + 0.6, 0), strip2(W2, 0, BOWL.z1 + to - 0.6, Math.PI),
      ])), ledMat));
    }
    // pancartas en la pared superior (fondo y laterales)
    const bannerDefs = [
      ['JUGADA MAESTRA', '#F26B1D', '#FFFFFF', 0, BOWL.z0 - ROWS.topOff + 0.6, 0, 300],
      ['LIGA MAESTRA', '#0E1A31', '#FFC53D', 0, BOWL.z1 + ROWS.topOff - 0.6, Math.PI, 300],
      ['HALCONES', '#B3202A', '#F5F0E6', -BOWL.x - ROWS.topOff + 0.6, 150, Math.PI / 2, 260],
      ['TOROS', '#1C1C1C', '#E8B04B', BOWL.x + ROWS.topOff - 0.6, 450, -Math.PI / 2, 260],
    ];
    for (const b of bannerDefs) {
      const m = new T.Mesh(track(new T.PlaneGeometry(b[6], b[6] / 4)), track(new T.MeshBasicMaterial({ map: track(bannerTexture(b[0], b[1], b[2])), toneMapped: false })));
      m.position.set(b[3], ROWS.topY + 18, b[4]); m.rotation.y = b[5];
      world.add(m);
    }

    // ---------------------------------------------------------------- Público (InstancedMesh)
    const SEATS = [];                      // { x, z, y, ry, edge, row, k }
    {
      const cz = (BOWL.z0 + BOWL.z1) / 2;
      ROWS.forEach((r, row) => {
        const off = r.off + r.depth * 0.55, y = r.y;
        const hx = BOWL.x + off, hz = (BOWL.z1 - BOWL.z0) / 2 + off;
        const step = 11;
        const nz = Math.floor((hz * 2) / step), nx = Math.floor((hx * 2) / step);
        for (let i = 0; i < nz; i++) {
          const z = cz - hz + (i + 0.5) * step;
          SEATS.push({ x: -hx, z, y, ry: Math.PI / 2, edge: 0, row, k: i });
          SEATS.push({ x: hx, z, y, ry: -Math.PI / 2, edge: 1, row, k: i });
        }
        for (let i = 0; i < nx; i++) {
          const x = -hx + (i + 0.5) * step;
          if (Math.abs(x) >= hx - 8) continue;
          SEATS.push({ x, z: cz - hz, y, ry: 0, edge: 2, row, k: i });
          SEATS.push({ x, z: cz + hz, y, ry: Math.PI, edge: 3, row, k: i });
        }
      });
      // orden determinista mezclado para que al bajar la calidad queden asientos vacíos repartidos
      const rnd = lcg(99);
      for (let i = SEATS.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = SEATS[i]; SEATS[i] = SEATS[j]; SEATS[j] = t; }
    }
    // geometría de un espectador sentado: torso + cabeza (aSkin = 1 en la cabeza)
    // Geometría de un espectador (≈34 triángulos): torso de 5 lados sin tapa inferior + cabeza icosaédrica.
    function personGeometry(count, seedOffset) {
      const body = placed(new T.CylinderGeometry(5.6, 4.6, 17, 5), 0, 8.5, 0);
      const head = placed(new T.IcosahedronGeometry(4.2, 0), 0, 20.5, 0);
      const m = mergeGeoms([body, head]);
      const nb = body.geo.index.count;
      const P = m.attributes.position.array, N = m.attributes.normal.array, U = m.attributes.uv.array;
      const pos = [], nor = [], uv = [], skin = [];
      for (let t = 0; t < P.length / 9; t++) {
        if (N[t * 9 + 1] < -0.9 && N[t * 9 + 4] < -0.9) continue;          // tapa inferior: nunca se ve
        for (let k = 0; k < 9; k++) { pos.push(P[t * 9 + k]); nor.push(N[t * 9 + k]); }
        for (let k = 0; k < 6; k++) uv.push(U[t * 6 + k]);
        for (let k = 0; k < 3; k++) skin.push(t * 3 >= nb ? 1 : 0);
      }
      m.dispose();
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      g.setAttribute('aSkin', new T.Float32BufferAttribute(skin, 1));
      const seeds = new Float32Array(count), rnd = lcg(5 + seedOffset);
      for (let i = 0; i < count; i++) seeds[i] = rnd();
      g.setAttribute('aSeed', new T.InstancedBufferAttribute(seeds, 1));
      return g;
    }
    const crowdUniforms = { uTime: { value: 0 } };
    const crowdMat = track(new T.MeshStandardMaterial({ roughness: 0.95, metalness: 0 }));
    crowdMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = crowdUniforms.uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aSkin;\nattribute float aSeed;\nuniform float uTime;')
        .replace('#include <color_vertex>', `#include <color_vertex>
          float sk = fract(aSeed * 7.31);
          vec3 skin = mix(vec3(0.93, 0.74, 0.58), vec3(0.32, 0.18, 0.10), sk);
          float hairy = step(0.25, fract(aSeed * 5.3)) * smoothstep(20.8, 23.0, position.y);
          vec3 hair = mix(vec3(0.08, 0.05, 0.03), vec3(0.45, 0.30, 0.15), fract(aSeed * 3.7)) ;
          vColor.rgb = mix(vColor.rgb, mix(skin, hair, hairy), aSkin);`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float ph = aSeed * 40.0;
          float lively = step(0.78, fract(aSeed * 13.7));
          transformed.y += (0.5 + 0.5 * sin(uTime * 2.4 + ph)) * 1.4 * lively + sin(uTime * 1.1 + ph) * 0.25;`);
    };
    // Dos mallas instanciadas (mitad cercana al aro / mitad lejana) para que el frustum culling descarte
    // la que queda detrás de la cámara en las vistas de juego.
    // La mitad lejana va ordenada por z: en las vistas de juego (mirando al aro) se recorta con `count`
    // lo que queda detrás de la cámara, sin partir el público en más mallas.
    const SEAT_SETS = [SEATS.filter((st) => st.z < 300), SEATS.filter((st) => st.z >= 300).sort((a, b) => a.z - b.z)];
    const FAR_Z = SEAT_SETS[1].map((st) => st.z);
    const crowds = SEAT_SETS.map((set, idx) => {
      const mesh = new T.InstancedMesh(track(personGeometry(set.length, idx * 1000)), crowdMat, set.length);
      const m = M4(), q = new T.Quaternion(), p = new T.Vector3(), s = new T.Vector3();
      const rnd = lcg(31 + idx);
      for (let i = 0; i < set.length; i++) {
        const st = set[i];
        p.set(st.x, st.y + 0.2, st.z);
        q.setFromEuler(new T.Euler(0, st.ry + (rnd() - 0.5) * 0.5, 0));
        const sc = 0.82 + rnd() * 0.3;
        s.set(sc, 0.9 + rnd() * 0.35, sc);
        mesh.setMatrixAt(i, m.compose(p, q, s));
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.boundingSphere.radius += 30;     // margen por el bamboleo y la escala
      world.add(mesh);
      return mesh;
    });
    let teams = [['#B3202A', '#F5F0E6'], ['#1C1C1C', '#E8B04B']];
    function colorCrowd() {
      const col = new T.Color(), rnd = lcg(17);
      const home = new T.Color(teams[0][0]), home2 = new T.Color(teams[0][1]);
      const away = new T.Color(teams[1][0]);
      for (let c = 0; c < crowds.length; c++) for (let i = 0; i < SEAT_SETS[c].length; i++) {
        const st = SEAT_SETS[c][i], crowd = crowds[c];
        // secciones: bloques de ~12 asientos × 4 filas se inclinan por un color
        const sec = Math.sin((st.edge * 17 + Math.floor(st.k / 12)) * 12.9898 + Math.floor(st.row / 4) * 78.233) * 43758.5453;
        const bias = sec - Math.floor(sec);
        const r = rnd();
        if (r < 0.28 + bias * 0.3) col.copy(home).offsetHSL(0, 0, (rnd() - 0.5) * 0.22);
        else if (r < 0.55 + bias * 0.2) col.copy(home2).offsetHSL(0, 0, -rnd() * 0.3);
        else if (r < 0.82) col.setHSL(0.55 + rnd() * 0.15, 0.2 + rnd() * 0.2, 0.06 + rnd() * 0.16);   // oscuros (abrigos, jeans)
        else if (r < 0.92) col.copy(away).offsetHSL(0, 0, (rnd() - 0.5) * 0.2);
        else col.setHSL(rnd(), 0.55, 0.45);                                               // alguno suelto
        crowd.setColorAt(i, col);
      }
      for (const c of crowds) c.instanceColor.needsUpdate = true;
    }
    colorCrowd();

    // banderines sobre la baranda del pasillo (triángulos alternados con los colores del local)
    const pennantMat = track(new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide }));
    let pennants = null;
    function buildPennants() {
      if (pennants) { world.remove(pennants); pennants.geometry.dispose(); }
      const pos = [], col = [];
      const c0 = new T.Color(teams[0][0]), c1 = new T.Color(teams[0][1]);
      const cz = (BOWL.z0 + BOWL.z1) / 2, off = ROWS.walkOff, y = ROWS.walkY + 10;
      const hx = BOWL.x + off, hz = (BOWL.z1 - BOWL.z0) / 2 + off;
      let n = 0;
      const tri = (ax, az, bx, bz, cx2, cz2, c) => {
        pos.push(ax, y, az, bx, y, bz, cx2, y - 9, cz2);
        for (let i = 0; i < 3; i++) col.push(c.r, c.g, c.b);
      };
      for (let z = cz - hz + 10; z < cz + hz - 10; z += 12) { const c = (n++ % 2) ? c0 : c1; tri(-hx, z, -hx, z + 10, -hx, z + 5, c); tri(hx, z, hx, z + 10, hx, z + 5, c); }
      for (let x = -hx + 10; x < hx - 10; x += 12) { const c = (n++ % 2) ? c0 : c1; tri(x, cz - hz, x + 10, cz - hz, x + 5, cz - hz, c); tri(x, cz + hz, x + 10, cz + hz, x + 5, cz + hz, c); }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
      pennants = new T.Mesh(g, pennantMat);
      world.add(pennants);
    }
    buildPennants();

    // ---------------------------------------------------------------- Techo, cerchas, focos, marcador
    const roofMat = track(new T.MeshStandardMaterial({ color: 0x0b0f1a, roughness: 1 }));
    const roofHalf = { x: BOWL.x + ROWS.topOff + 60, z: (BOWL.z1 - BOWL.z0) / 2 + ROWS.topOff + 60 };
    const roof = new T.Mesh(track(new T.PlaneGeometry(roofHalf.x * 2, roofHalf.z * 2)), roofMat);
    roof.rotation.x = Math.PI / 2; roof.position.set(0, ROOF_Y, (BOWL.z0 + BOWL.z1) / 2);
    world.add(roof);
    // paredes exteriores (del borde de la tribuna al techo)
    const outerWall = new T.Mesh(track(mergeGeoms(ringBoxes(ROWS.topOff + 20, ROWS.topOff + 24, ROWS.topY + 64, ROOF_Y))), roofMat);
    world.add(outerWall);
    const trussMat = track(new T.MeshStandardMaterial({ color: 0x3a4255, roughness: 0.6, metalness: 0.5 }));
    {
      const parts = [];
      const cz = (BOWL.z0 + BOWL.z1) / 2, L = roofHalf.z * 2, Wd = roofHalf.x * 2;
      for (let i = -3; i <= 3; i++) {
        parts.push(placed(new T.BoxGeometry(Wd, 6, 6), 0, ROOF_Y - 30, cz + i * 300));
        parts.push(placed(new T.BoxGeometry(Wd, 6, 6), 0, ROOF_Y - 6, cz + i * 300));
        for (let x = -roofHalf.x + 40; x < roofHalf.x; x += 80) parts.push(placed(new T.BoxGeometry(3, 26, 3), x, ROOF_Y - 18, cz + i * 300));
      }
      for (let i = -1; i <= 1; i++) parts.push(placed(new T.BoxGeometry(5, 5, L), i * 300, ROOF_Y - 30, cz));
      // parrillas de focos (cajas) sobre la cancha
      for (let i = -2; i <= 2; i++) for (const x of [-170, 170]) parts.push(placed(new T.BoxGeometry(26, 8, 10), x, ROOF_Y - 38, cz + i * 300));
      world.add(new T.Mesh(track(mergeGeoms(parts)), trussMat));
    }
    const haloTex = track(haloTexture());
    const haloMat = track(new T.SpriteMaterial({ map: haloTex, color: 0xfff1d6, transparent: true, blending: T.AdditiveBlending, depthWrite: false, fog: false }));
    {
      const cz = (BOWL.z0 + BOWL.z1) / 2;
      for (let i = -2; i <= 2; i++) for (const x of [-170, 170]) {
        const s = new T.Sprite(haloMat); s.position.set(x, ROOF_Y - 44, cz + i * 300); s.scale.set(90, 90, 1); world.add(s);
      }
    }
    {
      const sbMat = track(new T.MeshBasicMaterial({ map: track(scoreboardTexture()), toneMapped: false }));
      const sb = new T.Mesh(track(new T.BoxGeometry(110, 55, 110)), [sbMat, sbMat, darkMat, darkMat, sbMat, sbMat]);
      sb.position.set(0, ROOF_Y - 62, (BOWL.z0 + BOWL.z1) / 2);
      world.add(sb);
    }

    // ---------------------------------------------------------------- Túnel, bancos, mesa de control
    {
      const tunnelMat = track(new T.MeshStandardMaterial({ color: 0x05060a, roughness: 1 }));
      const tunnel = new T.Mesh(track(new T.BoxGeometry(60, 30, 30)), tunnelMat);
      tunnel.position.set(-BOWL.x - 15, 15, 760);
      world.add(tunnel);
      const tunnelFrame = new T.Mesh(track(new T.BoxGeometry(68, 36, 4)), track(new T.MeshStandardMaterial({ color: teams[0][0], roughness: 0.6 })));
      tunnelFrame.position.set(-BOWL.x + 2, 17, 760);
      tunnelFrame.rotation.y = Math.PI / 2;
      world.add(tunnelFrame);
      // bancos de suplentes: sillas (merged) a ambos lados de la mesa
      const chairMat = track(new T.MeshStandardMaterial({ color: 0x22335a, roughness: 0.6 }));
      const chairs = [];
      for (const z0 of [150, 330]) for (let i = 0; i < 7; i++) {
        const z = z0 + i * 16;
        chairs.push(placed(new T.BoxGeometry(12, 2, 12), -222, 10, z));
        chairs.push(placed(new T.BoxGeometry(2, 14, 12), -228, 16, z));
        chairs.push(placed(new T.BoxGeometry(2, 10, 2), -217, 5, z - 5)); chairs.push(placed(new T.BoxGeometry(2, 10, 2), -217, 5, z + 5));
      }
      const bench = new T.Mesh(track(mergeGeoms(chairs)), chairMat); bench.castShadow = true; world.add(bench);
      const table = new T.Mesh(track(new T.BoxGeometry(14, 18, 50)), track(new T.MeshStandardMaterial({ color: 0x0e1a31, roughness: 0.5 })));
      table.position.set(-224, 9, 300); table.castShadow = true; world.add(table);
    }

    // ---------------------------------------------------------------- Aro, tablero, red, soporte
    const hoops = [];
    function buildHoop(padColor) {
      const g = new T.Group();
      const metal = track(new T.MeshStandardMaterial({ color: 0xd9dde3, roughness: 0.35, metalness: 0.7 }));
      const glass = track(new T.MeshPhysicalMaterial({ color: 0xdbe6f5, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.4, side: T.DoubleSide }));
      const boardY = HOOP_H - 3.6 + BOARD_H / 2;              // el aro queda 15 cm por encima del borde inferior
      const board = new T.Mesh(track(new T.BoxGeometry(BOARD_W, BOARD_H, 1.2)), glass);
      board.position.set(0, boardY, BOARD_Z - 0.6); board.castShadow = true; g.add(board);
      // marco y rectángulo interior pintados (textura con alpha)
      const linesTex = track(canvasTex(512, 300, (c, w, h) => {
        c.clearRect(0, 0, w, h);
        c.strokeStyle = '#ffffff'; c.lineWidth = 26; c.strokeRect(13, 13, w - 26, h - 26);
        c.lineWidth = 14; const iw = w * (14 / 43), ih = h * (10.5 / 25);
        c.strokeRect(w / 2 - iw / 2, h - ih - 30, iw, ih);
        c.fillStyle = '#F26B1D'; c.fillRect(w / 2 - iw / 2, h - 30, iw, 10);
      }));
      const lines = new T.Mesh(track(new T.PlaneGeometry(BOARD_W, BOARD_H)), track(new T.MeshStandardMaterial({ map: linesTex, transparent: true, roughness: 0.5, side: T.DoubleSide })));
      lines.position.set(0, boardY, BOARD_Z + 0.05); g.add(lines);
      // aro
      const rim = new T.Mesh(track(new T.TorusGeometry(RIM_R, 0.7, 8, 28)), track(new T.MeshStandardMaterial({ color: 0xf26b1d, roughness: 0.4, metalness: 0.3 })));
      rim.rotation.x = Math.PI / 2; rim.position.set(0, HOOP_H, -230); rim.castShadow = true; g.add(rim);
      const bracket = new T.Mesh(track(new T.BoxGeometry(5, 2.4, 4.4)), rim.material);
      bracket.position.set(0, HOOP_H - 0.6, -230 - RIM_R - 1.6); g.add(bracket);
      // red: cordones (cilindros finos fusionados) en rombos; origen local en el centro del aro para animar el "swish"
      const NS = 12, levels = [[0, RIM_R], [-3.5, 4.7], [-7, 4.0], [-10.5, 3.5], [-14, 3.4], [-17, 3.6]];
      const strands = [], up = new T.Vector3(0, 1, 0), q = new T.Quaternion();
      const strand = (a, b) => {
        const d = b.clone().sub(a), len = d.length();
        q.setFromUnitVectors(up, d.normalize());
        strands.push({ geo: new T.CylinderGeometry(0.24, 0.24, len, 4, 1, true), matrix: M4().compose(a.clone().add(b).multiplyScalar(0.5), q, new T.Vector3(1, 1, 1)) });
      };
      for (let l = 0; l < levels.length - 1; l++) {
        for (let i = 0; i < NS; i++) {
          const [y0, r0] = levels[l], [y1, r1] = levels[l + 1];
          const a0 = (i / NS) * Math.PI * 2, p0 = new T.Vector3(Math.cos(a0) * r0, y0, Math.sin(a0) * r0);
          for (const sgn of [0.5, -0.5]) {
            const a1 = ((i + sgn) / NS) * Math.PI * 2;
            strand(p0, new T.Vector3(Math.cos(a1) * r1, y1, Math.sin(a1) * r1));
          }
        }
      }
      const net = new T.Mesh(track(mergeGeoms(strands)), track(new T.MeshBasicMaterial({ color: 0xf4f6ff, toneMapped: false })));
      net.position.set(0, HOOP_H, -230); net.frustumCulled = false; g.add(net);
      // soporte: base acolchada, poste, brazo y tirante
      const pad = track(new T.MeshStandardMaterial({ color: padColor, roughness: 0.75 }));
      const base = new T.Mesh(track(new T.BoxGeometry(34, 22, 64)), pad); base.position.set(0, 11, -348); base.castShadow = true; g.add(base);
      const post = new T.Mesh(track(new T.BoxGeometry(9, 100, 9)), pad); post.position.set(0, 72, -352); post.castShadow = true; g.add(post);
      const arm = new T.Mesh(track(new T.BoxGeometry(7, 6, 118)), metal); arm.position.set(0, 118, -352 + 59 - 3); arm.castShadow = true; g.add(arm);
      const drop = new T.Mesh(track(new T.BoxGeometry(10, 22, 3)), metal); drop.position.set(0, boardY + BOARD_H / 2 - 8, BOARD_Z - 2.5); g.add(drop);
      const strut = new T.Mesh(track(new T.BoxGeometry(3, 3, 64)), metal); strut.position.set(0, 100, -352 + 28); strut.rotation.x = 0.55; g.add(strut);
      return { group: g, net, swish: 0 };
    }
    const hoopNear = buildHoop(0x22335a); world.add(hoopNear.group); hoops.push(hoopNear);
    // el aro lejano se gira 180° y se corre 600: su aro local en z = -230 queda en z = 830 (cancha y = 1130)
    const hoopFar = buildHoop(0x22335a); hoopFar.group.rotation.y = Math.PI; hoopFar.group.position.z = 600; world.add(hoopFar.group); hoops.push(hoopFar);
    function animateNet(h) {                 // swish 0..1: la red se estira, se abre y se bambolea
      const s = Math.max(0, Math.min(1, h.swish)), w = Math.sin(s * Math.PI);
      h.net.scale.set(1 + w * 0.35, 1 + w * 0.3, 1 + w * 0.35);
      h.net.rotation.z = Math.sin(s * 11) * 0.12 * w;
      h.net.rotation.x = Math.cos(s * 9) * 0.08 * w;
    }

    // ---------------------------------------------------------------- Pelota
    const ballGeo = track(new T.SphereGeometry(3.2, 24, 18));
    const ballMat = track(new T.MeshStandardMaterial({ map: track(ballTexture()), roughness: 0.55, metalness: 0 }));
    const ballMesh = new T.Mesh(ballGeo, ballMat);
    ballMesh.castShadow = true; ballMesh.visible = false;
    scene.add(ballMesh);
    const ball = {
      mesh: ballMesh,
      set(x, y, h, visible) { ballMesh.position.set(x - 180, (h || 0) + 3.2, y - 300); ballMesh.visible = visible !== false; },
      spin(dt) { ballMesh.rotation.x -= dt * 7; ballMesh.rotation.z += dt * 2.5; },
    };

    // ---------------------------------------------------------------- Obstáculos
    const wallMat = track(new T.MeshStandardMaterial({ color: 0x22335a, roughness: 0.55 }));
    const stripeTex = track(canvasTex(64, 16, (g) => { g.clearRect(0, 0, 64, 16); g.fillStyle = '#FFC53D'; g.fillRect(0, 5, 32, 6); }, { repeat: true }));
    const stripeMat = track(new T.MeshBasicMaterial({ map: stripeTex, transparent: true, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1 }));
    function setLevel(level) {
      while (wallsGroup.children.length) { const c = wallsGroup.children.pop(); c.geometry.dispose(); if (c.material.map && c.material !== stripeMat) c.material.map.dispose(); }
      const boxes = [], stripes = [];
      for (const w of (level && level.walls) || []) {
        const a = courtToWorld(w[0], w[1]), b = courtToWorld(w[2], w[3]);
        const len = a.distanceTo(b), ang = Math.atan2(-(b.z - a.z), b.x - a.x);
        const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
        boxes.push(placed(new T.BoxGeometry(len + WALL_T, 10, WALL_T), cx, 5, cz, ang));
        boxes.push(placed(new T.CylinderGeometry(WALL_T / 2, WALL_T / 2, 10, 12), a.x, 5, a.z));
        boxes.push(placed(new T.CylinderGeometry(WALL_T / 2, WALL_T / 2, 10, 12), b.x, 5, b.z));
        const pg = new T.PlaneGeometry(len, WALL_T - 4);
        const uv = pg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * len / 12);
        const m = M4().compose(new T.Vector3(cx, 10.06, cz), new T.Quaternion().setFromEuler(new T.Euler(-Math.PI / 2, 0, ang, 'YXZ')), new T.Vector3(1, 1, 1));
        stripes.push({ geo: pg, matrix: m });
      }
      if (!boxes.length) return;
      const wm = new T.Mesh(mergeGeoms(boxes), wallMat); wm.castShadow = true; wm.receiveShadow = true; wallsGroup.add(wm);
      wallsGroup.add(new T.Mesh(mergeGeoms(stripes), stripeMat));
    }

    // ---------------------------------------------------------------- Overlay (dibujos sobre el piso)
    const OV_Y = 0.6;
    function ovMaterial(color, alpha) {
      return new T.MeshBasicMaterial({ color: new T.Color(color || '#ffffff'), transparent: true, opacity: alpha == null ? 1 : alpha, depthWrite: false, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, toneMapped: false });
    }
    function ovAdd(geo, mat) {
      const m = new T.Mesh(geo, mat); m.renderOrder = 20; m.frustumCulled = false; overlayGroup.add(m); return m;
    }
    // cinta plana sobre el piso a lo largo de una polilínea en coordenadas de mundo (y fijo)
    function ribbonGeo(pts, width, dashed, arrow) {
      const pos = [];
      const quad = (a, b, w) => {
        const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
        const nx = -dz / l * w / 2, nz = dx / l * w / 2;
        pos.push(a.x + nx, OV_Y, a.z + nz, b.x + nx, OV_Y, b.z + nz, b.x - nx, OV_Y, b.z - nz,
          a.x + nx, OV_Y, a.z + nz, b.x - nx, OV_Y, b.z - nz, a.x - nx, OV_Y, a.z - nz);
      };
      let last = pts[pts.length - 1], tipDir = null;
      if (arrow && pts.length > 1) {
        const prev = pts[pts.length - 2];
        const dx = last.x - prev.x, dz = last.z - prev.z, l = Math.hypot(dx, dz) || 1;
        tipDir = { x: dx / l, z: dz / l };
        const back = width * 4.5;
        last = { x: last.x - tipDir.x * back, z: last.z - tipDir.z * back };
        pts = pts.slice(0, -1).concat([last]);
      }
      if (!dashed) {
        for (let i = 0; i < pts.length - 1; i++) quad(pts[i], pts[i + 1], width);
      } else {
        const on = Math.max(5, width * 2.2), off = Math.max(4, width * 1.6);
        let acc = 0, drawing = true, rem = on;
        for (let i = 0; i < pts.length - 1; i++) {
          let a = pts[i]; const b = pts[i + 1];
          let seg = Math.hypot(b.x - a.x, b.z - a.z);
          const ux = (b.x - a.x) / (seg || 1), uz = (b.z - a.z) / (seg || 1);
          while (seg > 0) {
            const step = Math.min(seg, rem);
            const c = { x: a.x + ux * step, z: a.z + uz * step };
            if (drawing) quad(a, c, width);
            a = c; seg -= step; rem -= step;
            if (rem <= 0.001) { drawing = !drawing; rem = drawing ? on : off; }
          }
          acc += seg;
        }
      }
      if (tipDir) {
        const w = width * 2.6, L = width * 5, px = -tipDir.z, pz = tipDir.x, tip = pts[pts.length - 1];
        pos.push(tip.x + px * w, OV_Y, tip.z + pz * w, tip.x + tipDir.x * L, OV_Y, tip.z + tipDir.z * L, tip.x - px * w, OV_Y, tip.z - pz * w);
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      return g;
    }
    const toW = (p) => ({ x: (p.x != null ? p.x : p[0]) - 180, z: (p.y != null ? p.y : p[1]) - 300, h: p.h || 0 });
    const overlay = {
      clear() {
        while (overlayGroup.children.length) { const c = overlayGroup.children.pop(); c.geometry.dispose(); c.material.dispose(); }
      },
      line(pts, o) {
        o = o || {};
        const w = o.width || 3;
        ovAdd(ribbonGeo(pts.map(toW), w, !!o.dashed, !!o.arrow), ovMaterial(o.color, o.alpha));
      },
      arc(from, to, apex, o) {
        o = o || {};
        const a = toW(from), b = toW(to);
        const apexH = typeof apex === 'number' ? apex : (apex && apex.h != null ? apex.h : 60);
        const h1 = (4 * apexH - a.h - b.h) / 2;
        const curve = new T.QuadraticBezierCurve3(new T.Vector3(a.x, a.h + 2, a.z), new T.Vector3((a.x + b.x) / 2, h1, (a.z + b.z) / 2), new T.Vector3(b.x, b.h + 2, b.z));
        const parts = [], rad = o.width ? o.width / 2 : 0.9;
        if (o.dashed) {
          // guiones: tramos rectos cortos sobre la curva (LineCurve3 sirve para TubeGeometry)
          const N = 26;
          for (let i = 0; i < N; i += 2) parts.push({ geo: new T.TubeGeometry(new T.LineCurve3(curve.getPoint(i / N), curve.getPoint((i + 1.1) / N)), 1, rad, 6, false) });
        } else parts.push({ geo: new T.TubeGeometry(curve, 40, rad, 6, false) });
        const m = ovAdd(mergeGeoms(parts), ovMaterial(o.color, o.alpha));
        m.material.depthWrite = true; m.material.polygonOffset = false;
      },
      circle(center, r, o) {
        o = o || {};
        const c = toW(center), w = o.width || 1.6;
        let geo;
        if (o.dashed) {
          const parts = [], n = Math.max(12, Math.round(r / 4));
          for (let i = 0; i < n; i++) parts.push({ geo: new T.RingGeometry(r - w, r, 6, 1, (i / n) * Math.PI * 2, (0.58 / n) * Math.PI * 2) });
          geo = mergeGeoms(parts);
        } else geo = new T.RingGeometry(r - w, r, 72);
        const ring = ovAdd(geo, ovMaterial(o.color, o.alpha));
        ring.rotation.x = -Math.PI / 2; ring.position.set(c.x, OV_Y, c.z);
        if (o.fill) {
          const f = ovAdd(new T.CircleGeometry(r - w, 72), ovMaterial(o.fill === true ? o.color : o.fill, (o.alpha == null ? 1 : o.alpha) * 0.22));
          f.rotation.x = -Math.PI / 2; f.position.set(c.x, OV_Y - 0.05, c.z); f.renderOrder = 19;
        }
      },
      ring(center, rx, ry, o) {
        o = o || {};
        const c = toW(center), w = (o.width || 2.2) / rx;
        const m = ovAdd(new T.RingGeometry(1 - w, 1, 56), ovMaterial(o.color, o.alpha));
        m.rotation.x = -Math.PI / 2; m.position.set(c.x, OV_Y + 0.05, c.z); m.scale.set(rx, ry, 1); m.renderOrder = 21;
      },
      disc(center, r, o) {
        o = o || {};
        const c = toW(center);
        const m = ovAdd(new T.CircleGeometry(r, 40), ovMaterial(o.color, o.alpha == null ? 0.35 : o.alpha));
        m.rotation.x = -Math.PI / 2; m.position.set(c.x, OV_Y - 0.1, c.z); m.renderOrder = 18;
      },
    };

    // ---------------------------------------------------------------- Cámara
    const cam = {
      mode: 'holder', pos: camera.position.clone(), look: new T.Vector3(0, 20, -230),
      from: null, to: null, t0: 0, dur: 0.6, goal: null, lastD: 180, target: null, points: [], holder: null, cineT: 0,
    };
    const _v = new T.Vector3(), _tmpCam = new T.PerspectiveCamera(FOV, 1, 2, 3200);
    const clampPos = (p) => { p.x = Math.max(-BOWL.x + 14, Math.min(BOWL.x - 14, p.x)); p.z = Math.max(BOWL.z0 + 16, Math.min(BOWL.z1 - 16, p.z)); p.y = Math.max(28, Math.min(ROOF_Y - 90, p.y)); return p; };
    function forwardFrom(yaw, pitch) {                  // yaw 0 → mira a -z; pitch > 0 → hacia abajo
      return new T.Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    }
    // Encuadre tipo Score! Hero: detrás y por encima del poseedor, mirando al aro, con todos los puntos adentro.
    function solveFraming(holder, points, opt) {
      opt = opt || {};
      const H = courtToWorld(holder.x, holder.y, 0);
      const hoopW = courtToWorld(HOOP.x, HOOP.y, 0);
      const dir = new T.Vector3(hoopW.x - H.x, 0, hoopW.z - H.z);
      const dh = dir.length();
      if (dh < 1) dir.set(0, 0, -1); else dir.divideScalar(dh);
      if (dh < 150) dir.lerp(new T.Vector3(0, 0, -1), (150 - dh) / 150).normalize();
      // muestras a encuadrar: pies y cabeza de cada punto, tablero completo, el poseedor
      const S = [];
      const addP = (x, y, h0, h1) => { S.push(courtToWorld(x, y, h0)); S.push(courtToWorld(x, y, h1)); };
      addP(holder.x, holder.y, 0, holder.h != null ? holder.h + 8 : 52);
      for (const p of points || []) { const px = p.x != null ? p.x : p[0], py = p.y != null ? p.y : p[1]; addP(px, py, 0, (p.h || 0) + 52); }
      addP(HOOP.x - BOARD_W / 2, HOOP.y - 9, 0, HOOP_H + 24); addP(HOOP.x + BOARD_W / 2, HOOP.y - 9, 0, HOOP_H + 24);
      addP(HOOP.x, HOOP.y, 0, HOOP_H);
      const aspect = cssW / cssH;
      _tmpCam.aspect = aspect; _tmpCam.fov = FOV; _tmpCam.updateProjectionMatrix();
      const tanV = Math.tan((FOV / 2) * Math.PI / 180), tanH = tanV * aspect;
      const mx = 0.08, mTop = 0.1, mBot = 0.09;
      let D = opt.D0 || 150;
      const minPitch = 0.33, maxPitch = 1.05;
      let pos, yaw, pitch, ok = false, bb;
      for (let it = 0; it < 40 && !ok; it++) {
        pos = H.clone().addScaledVector(dir, -D); pos.y = Math.min(26 + D * CAM_ELEV, 200 + D * 0.08);
        clampPos(pos);
        // orientación inicial: hacia el centro de las muestras
        const c = new T.Vector3(); for (const s of S) c.add(s); c.divideScalar(S.length);
        const f = c.clone().sub(pos).normalize();
        yaw = Math.atan2(f.x, -f.z); pitch = Math.asin(-f.y);
        for (let k = 0; k < 6; k++) {
          _tmpCam.position.copy(pos); _tmpCam.lookAt(pos.clone().add(forwardFrom(yaw, pitch))); _tmpCam.updateMatrixWorld();
          bb = { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 };
          for (const s of S) { _v.copy(s).project(_tmpCam); bb.x0 = Math.min(bb.x0, _v.x); bb.x1 = Math.max(bb.x1, _v.x); bb.y0 = Math.min(bb.y0, _v.y); bb.y1 = Math.max(bb.y1, _v.y); }
          yaw += Math.atan(((bb.x0 + bb.x1) / 2) * tanH);
          const hgt = bb.y1 - bb.y0;
          // el poseedor queda abajo con margen; si el conjunto es más alto que la pantalla, se centra
          const targetBottom = hgt <= 2 - mTop - mBot ? -1 + mBot : -(hgt / 2);
          pitch += Math.atan((targetBottom - bb.y0) * tanV);
          pitch = Math.max(minPitch, Math.min(maxPitch, pitch));
        }
        ok = bb.x0 >= -1 + mx && bb.x1 <= 1 - mx && bb.y0 >= -1 + mBot - 0.01 && bb.y1 <= 1 - mTop;
        if (!ok) D *= 1.07;
      }
      return { pos, look: pos.clone().add(forwardFrom(yaw, pitch).multiplyScalar(200)), D };
    }
    function setCamera(o) {
      o = o || {};
      const now = cam.now || 0;
      cam.mode = o.mode || cam.mode;
      if (o.points) cam.points = o.points;
      if (o.holder) cam.holder = o.holder;
      if (o.target) cam.target = o.target;
      let goal = null;
      if (cam.mode === 'holder' && cam.holder) {
        goal = solveFraming(cam.holder, cam.points);
        cam.lastD = goal.D;
      } else if (cam.mode === 'follow') {
        goal = solveFraming(cam.target || cam.holder || { x: 180, y: 400 }, cam.points, { D0: cam.lastD * 0.9 });
      } else if (cam.mode === 'cinematic') {
        goal = cinematicPose(cam.cineT);
      }
      if (!goal) return;
      cam.goal = goal;
      if (o.instant) {
        cam.pos.copy(goal.pos); cam.look.copy(goal.look); cam.from = null;
        applyCamera();
      } else if (cam.mode === 'holder') {
        cam.from = { pos: cam.pos.clone(), look: cam.look.clone() };
        cam.to = goal; cam.t0 = now; cam.dur = 0.6;
      }
    }
    function cinematicPose(t) {
      const a = Math.sin(t * 0.22) * 0.75;
      const R = 480;
      const center = new T.Vector3(0, 0, 40);
      const pos = new T.Vector3(center.x + Math.sin(a) * R, 150 + Math.sin(t * 0.13) * 25, center.z + Math.cos(a) * R);
      const look = new T.Vector3(0, 30, -200);
      return { pos, look };
    }
    function applyCamera() {
      camera.position.copy(cam.pos); camera.lookAt(cam.look); camera.updateMatrixWorld();
    }
    function updateCamera(now, dt) {
      cam.now = now;
      if (cam.mode === 'holder') {
        if (cam.from && cam.to) {
          let k = Math.min(1, (now - cam.t0) / cam.dur);
          k = 1 - Math.pow(1 - k, 3);
          cam.pos.lerpVectors(cam.from.pos, cam.to.pos, k);
          cam.look.lerpVectors(cam.from.look, cam.to.look, k);
          if (k >= 1) cam.from = null;
        }
      } else if (cam.mode === 'follow' || cam.mode === 'cinematic') {
        if (cam.mode === 'cinematic') { cam.cineT += dt; cam.goal = cinematicPose(cam.cineT); }
        else if (cam.target) cam.goal = solveFraming(cam.target, cam.points, { D0: cam.lastD * 0.9 });
        if (cam.goal) {
          const k = 1 - Math.exp(-dt * (cam.mode === 'cinematic' ? 2.5 : 5));
          cam.pos.lerp(cam.goal.pos, k); cam.look.lerp(cam.goal.look, k);
        }
      }
      applyCamera();
      cullFarCrowd();
    }

    // ---------------------------------------------------------------- Conversión pantalla ↔ cancha
    const raycaster = new T.Raycaster();
    const floorPlane = new T.Plane(new T.Vector3(0, 1, 0), 0);
    function screenToCourt(px, py) {
      const ndc = new T.Vector2((px / cssW) * 2 - 1, -(py / cssH) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.ray.intersectPlane(floorPlane, new T.Vector3());
      return hit ? worldToCourt(hit) : null;
    }
    function courtToScreen(x, y, h) {
      const v = courtToWorld(x, y, h || 0);
      const vc = v.clone().applyMatrix4(camera.matrixWorldInverse);
      v.project(camera);
      return { x: (v.x + 1) / 2 * cssW, y: (1 - v.y) / 2 * cssH, depth: -vc.z };
    }

    // ---------------------------------------------------------------- Calidad, tamaño, bucle
    let quality = 'alta', crowdFrac = 1;
    // Recorta el público lejano que queda detrás de la cámara (solo si mira hacia el aro).
    function cullFarCrowd() {
      const fwd = camera.getWorldDirection(_v);
      let n = SEAT_SETS[1].length;
      if (fwd.z < 0.25) {
        const lim = camera.position.z + 140;
        let lo = 0, hi = n;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (FAR_Z[mid] < lim) lo = mid + 1; else hi = mid; }
        n = lo;
      }
      crowds[1].count = Math.floor(n * crowdFrac);
    }
    function setQuality(q) {
      quality = q;
      const map = { alta: 2048, media: 1024, baja: 512 }[q] || 2048;
      if (sun.shadow.mapSize.x !== map) {
        sun.shadow.mapSize.set(map, map);
        if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      }
      renderer.shadowMap.type = q === 'alta' ? T.PCFSoftShadowMap : T.PCFShadowMap;
      renderer.shadowMap.needsUpdate = true;
      crowdFrac = { alta: 1, media: 0.7, baja: 0.45 }[q] || 1;
      crowds[0].count = Math.floor(SEAT_SETS[0].length * crowdFrac);
      cullFarCrowd();
      warm2.visible = q !== 'baja';
    }
    function resize(w, h, dpr) {
      cssW = w; cssH = h;
      renderer.setPixelRatio(Math.min(2, dpr || 1));
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    let lastMs = 0, lastInfo = { calls: 0, triangles: 0 };
    function render() {
      const t0 = performance.now();
      renderer.render(scene, camera);
      lastMs = performance.now() - t0;
      lastInfo = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    }
    function update(now, dt) {
      now = now / 1000;                              // now en ms (performance.now); dt en segundos
      if (dt == null) dt = 1 / 60; if (dt > 0.5) dt = dt / 1000; dt = Math.min(dt, 0.1);
      crowdUniforms.uTime.value = now;
      for (const h of hoops) animateNet(h);
      updateCamera(now, dt);
    }
    function setTeams(t) {
      if (t && t[0]) teams[0] = t[0];
      if (t && t[1]) teams[1] = t[1];
      colorCrowd(); buildPennants();
    }
    function dispose() {
      overlay.clear(); setLevel(null);
      for (const d of disposables) if (d && d.dispose) d.dispose();
      if (pennants) pennants.geometry.dispose();
      pennantMat.dispose();
      renderer.dispose();
    }

    const api = {
      renderer, scene, camera, ball, overlay,
      hoop: { swish(t) { hoopNear.swish = t; }, group: hoopNear.group },
      resize, setLevel, setCamera, update, render, setQuality, setTeams, dispose,
      add: (o) => dyn.add(o), remove: (o) => dyn.remove(o),
      courtToWorld: (x, y, h) => courtToWorld(x, y, h),
      worldToCourt, screenToCourt, courtToScreen,
      info: () => ({ drawCalls: lastInfo.calls, triangles: lastInfo.triangles, ms: lastMs, crowd: crowds[0].count + crowds[1].count, quality }),
      solveFraming,
    };
    return api;
  }

  root.Scene3D = { create, courtToWorld, worldToCourt, COURT, HOOP, HOOP_H, RIM_R, BOARD_W, BOARD_H };
})(typeof window !== 'undefined' ? window : this);
