// Escena 3D de "Jugada Maestra" (Contrato A): estadio cerrado de básquet, cancha de parqué con las
// líneas exactas del motor, aro con red, público instanciado, luces con sombras, pelota, cámara
// tipo Score! Hero y overlays dibujados sobre el piso.
// Requiere THREE (r158, build UMD) como global. Expone window.Scene3D.
//
// API (Scene3D.create({ canvas }) devuelve):
//   resize(w, h, dpr) · setInsets({ top, bottom, left, right }) · setQuality('alta' | 'media' | 'baja')
//   add(obj) · remove(obj) · courtToWorld · worldToCourt · screenToCourt · courtToScreen
//   setCamera({ mode: 'holder' | 'follow' | 'cinematic' | 'score', holder, target, points, instant })
//     'score': festejo tras una canasta (acercamiento con órbita corta hacia el aro y la tribuna).
//   setOrbit({ yaw, pitch, instant }) · resetOrbit() · getOrbit() → { yaw, pitch, goalYaw, goalPitch,
//     settled, yawMax, pitchMin, pitchMax, effYaw, shown, total, framed }
//     El encuadre garantiza poseedor + aro dentro de la zona libre con cualquier giro: si el giro
//     pedido no lo permite, aplica uno menor (effYaw) y deja fuera a los puntos más lejanos.
//   setTeams([[local, vivos], [visita, vivos]]): público, banderines, zona pintada, círculo central,
//     piso perimetral, cubo marcador y papelitos.
//   cheer(): la hinchada local festeja (de pie, destellos y papelitos unos segundos).
//   ball.set(x, y, h, visible) · ball.spin(dt) · hoop.swish(0..1) · overlay.* · update(now, dt) · render()
//   info() → { drawCalls, triangles, ms, crowd, quality, mode, sinceCheer } · dispose()
(function (root) {
  'use strict';
  const T = root.THREE;

  // ------------------------------------------------------------------ Constantes del juego
  const COURT = { w: 360, h: 600 };        // media cancha jugable (unidades de cancha)
  const HOOP = { x: 180, y: 70 };          // aro en coordenadas de cancha
  const RANGE = 210;                       // línea de triple = alcance de tiro
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
  // Parqué barnizado + líneas del juego (zona pintada, tiros libres, triple = radio 210 al aro con
  // rectas en x = 24 y 336). La zona y el círculo central llevan los colores del equipo local y el
  // centro tiene el logo del juego. `far` pinta la mitad lejana (la malla va girada 180°).
  function shade(hex, k) {                 // k < 0 oscurece hacia negro, k > 0 aclara hacia blanco
    const c = new T.Color(hex), t = k < 0 ? 0 : 1, a = Math.abs(k);
    return '#' + new T.Color(c.r + (t - c.r) * a, c.g + (t - c.g) * a, c.b + (t - c.b) * a).getHexString();
  }
  function luma(hex) { const c = new T.Color(hex); return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b; }
  function paintWood(g, w, h) {
    g.fillStyle = '#C8935A';
    g.fillRect(0, 0, w, h);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const plank = 9;                        // listones agrupados (≈ 37 cm)
    for (let x = 0; x < w; x += plank) {
      let y = -rnd() * 120;
      while (y < h) {
        const len = 90 + rnd() * 150;
        const tone = rnd();
        g.fillStyle = tone > .5 ? `rgba(255,226,168,${0.03 + rnd() * 0.11})` : `rgba(104,56,18,${0.02 + rnd() * 0.08})`;
        g.fillRect(x, y, plank, len);
        // vetas finas a lo largo de la tabla
        g.fillStyle = 'rgba(96,52,16,.09)';
        for (let k = 0; k < 2; k++) g.fillRect(x + 1.5 + rnd() * 6, y + rnd() * 10, 0.5, len * (0.5 + rnd() * 0.5));
        g.fillStyle = 'rgba(70,36,10,.26)';
        g.fillRect(x, y, plank, 0.7);
        y += len;
      }
      g.fillStyle = 'rgba(70,36,10,.2)';
      g.fillRect(x, 0, 0.6, h);
    }
  }
  // Texto sobre un arco (centro cx, cy; radio r), centrado en el ángulo a0 (−π/2 = arriba).
  function arcText(g, text, cx, cy, r, a0, flip) {
    let total = 0;
    const ws = [];
    for (const ch of text) { const wch = g.measureText(ch).width + 1.2; ws.push(wch); total += wch; }
    let a = a0 - (flip ? -1 : 1) * total / r / 2;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    let i = 0;
    for (const ch of text) {
      const da = ws[i++] / r * (flip ? -1 : 1);
      a += da / 2;
      g.save();
      g.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      g.rotate(a + (flip ? -Math.PI / 2 : Math.PI / 2));
      g.fillText(ch, 0, 0);
      g.restore();
      a += da;
    }
  }
  function paintCourt(g, w, h, colors, far) {
    const home = (colors && colors[0]) || '#B3202A', home2 = (colors && colors[1]) || '#F5F0E6';
    // el segundo color se usa para el logo: si se parece demasiado al primero, va crema
    const ink = Math.abs(luma(home) - luma(home2)) < 0.18 ? (luma(home) > 0.5 ? '#1B2238' : '#F7EEDF') : home2;
    paintWood(g, w, h);
    const R = RANGE, side = 24;
    const a = Math.asin((side - HOOP.x) / R);
    const yJoin = HOOP.y + Math.cos(a) * R;
    const arcPath = () => {
      g.beginPath();
      g.moveTo(side, 0); g.lineTo(side, yJoin);
      g.arc(HOOP.x, HOOP.y, R, Math.PI / 2 - a, Math.PI / 2 + a, true);
      g.lineTo(w - side, 0);
    };
    // fuera de la línea de triple la madera va teñida un tono más oscura
    g.save();
    g.beginPath(); g.rect(0, 0, w, h); arcPath(); g.closePath();
    g.fillStyle = 'rgba(92,46,12,.20)'; g.fill('evenodd');
    g.restore();
    // zona pintada con el color del local (un poco apagado para que no compita con las camisetas)
    const paint = shade(home, -0.14);
    g.globalAlpha = 0.9; g.fillStyle = paint;
    g.fillRect(HOOP.x - 50, 6, 100, 194);
    g.globalAlpha = 1;
    // veteado de la madera asomando bajo la pintura
    g.fillStyle = 'rgba(0,0,0,.05)';
    for (let x = HOOP.x - 50; x < HOOP.x + 50; x += 12) g.fillRect(x, 6, 0.6, 194);
    // círculo central (centrado en la línea de media cancha, y = h) con el logo del juego
    const cy = h, flip = far ? Math.PI : 0;
    g.save();
    g.translate(HOOP.x, cy); g.rotate(flip);
    g.beginPath(); g.arc(0, 0, 50, 0, Math.PI * 2);
    g.globalAlpha = 0.92; g.fillStyle = paint; g.fill(); g.globalAlpha = 1;
    g.beginPath(); g.arc(0, 0, 41, 0, Math.PI * 2); g.lineWidth = 2; g.strokeStyle = ink; g.stroke();
    // pelota estilizada
    g.beginPath(); g.arc(0, 0, 30, 0, Math.PI * 2); g.fillStyle = ink; g.fill();
    g.strokeStyle = paint; g.lineWidth = 2.6; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-30, 0); g.lineTo(30, 0); g.stroke();
    g.beginPath(); g.moveTo(0, -30); g.lineTo(0, 30); g.stroke();
    g.beginPath(); g.arc(-39, 0, 30, -0.7, 0.7); g.stroke();
    g.beginPath(); g.arc(39, 0, 30, Math.PI - 0.7, Math.PI + 0.7); g.stroke();
    // nombre del juego en arco: arriba (hacia el aro) y abajo
    g.fillStyle = paint;
    g.font = '900 24px "Barlow Condensed", "Arial Narrow", Impact, sans-serif';
    arcText(g, 'JUGADA', 0, 0, 68, -Math.PI / 2, false);
    arcText(g, 'MAESTRA', 0, 0, 70, Math.PI / 2, true);
    g.fillStyle = ink;
    g.font = '900 9px "Barlow Condensed", "Arial Narrow", Impact, sans-serif';
    arcText(g, '★  LIGA MAESTRA  ★', 0, 0, 45.2, -Math.PI / 2, false);
    arcText(g, '★  LIGA MAESTRA  ★', 0, 0, 45.6, Math.PI / 2, true);
    g.restore();
    // líneas
    g.strokeStyle = 'rgba(255,255,255,.95)';
    g.lineWidth = 3; g.lineCap = 'butt';
    g.beginPath(); g.moveTo(6, h); g.lineTo(6, 6); g.lineTo(w - 6, 6); g.lineTo(w - 6, h); g.stroke();   // laterales y fondo
    g.beginPath(); g.moveTo(6, h); g.lineTo(w - 6, h); g.stroke();                                    // media cancha (mitad en cada textura)
    g.strokeRect(HOOP.x - 50, 6, 100, 194);
    g.beginPath(); g.arc(HOOP.x, 200, 50, 0, Math.PI); g.stroke();
    g.setLineDash([8, 8]);
    g.beginPath(); g.arc(HOOP.x, 200, 50, Math.PI, 2 * Math.PI); g.stroke();
    g.setLineDash([]);
    g.beginPath();
    g.moveTo(side, 6); g.lineTo(side, yJoin);
    g.arc(HOOP.x, HOOP.y, R, Math.PI / 2 - a, Math.PI / 2 + a, true);
    g.lineTo(w - side, 6);
    g.stroke();
    g.beginPath(); g.arc(HOOP.x, h, 50, Math.PI, 2 * Math.PI); g.stroke();
    // marcas de rebote a los lados de la zona
    g.lineWidth = 2.4;
    for (const y of [78, 100, 132, 164]) { g.beginPath(); g.moveTo(HOOP.x - 50, y); g.lineTo(HOOP.x - 56, y); g.moveTo(HOOP.x + 50, y); g.lineTo(HOOP.x + 56, y); g.stroke(); }
  }
  // Lienzo + textura de media cancha a k píxeles por unidad; repaint(colors) la vuelve a pintar.
  function courtLayer(k, aniso, far) {
    const c = document.createElement('canvas');
    c.width = COURT.w * k; c.height = COURT.h * k;
    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = aniso;
    const repaint = (colors) => {
      const g = c.getContext('2d');
      g.setTransform(k, 0, 0, k, 0, 0);
      paintCourt(g, COURT.w, COURT.h, colors, far);
      tex.needsUpdate = true;
    };
    return { tex, repaint };
  }

  // ------------------------------------------------------------------ Textura de la pelota
  function ballTexture() {
    return canvasTex(512, 256, (g, w, h) => {
      const grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, '#F58A3A'); grd.addColorStop(.5, '#EE6F22'); grd.addColorStop(1, '#D4581A');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
      // granulado del cuero: puntos claros y oscuros
      const rnd = lcg(11);
      for (let i = 0; i < 5200; i++) {
        g.fillStyle = rnd() > 0.5 ? 'rgba(96,34,6,.20)' : 'rgba(255,190,120,.16)';
        g.beginPath(); g.arc(rnd() * w, rnd() * h, 0.9 + rnd() * 0.7, 0, 6.3); g.fill();
      }
      // canales negros: ecuador, un meridiano completo y dos gajos curvos, con un filo claro al lado
      const seams = (color, lw, dy) => {
        g.strokeStyle = color; g.lineWidth = lw; g.lineCap = 'round';
        g.beginPath(); g.moveTo(0, h / 2 + dy); g.lineTo(w, h / 2 + dy); g.stroke();
        for (const u of [0.25, 0.75]) { g.beginPath(); g.moveTo(u * w + dy, 0); g.lineTo(u * w + dy, h); g.stroke(); }
        for (const sgn of [1, -1]) {
          g.beginPath();
          for (let i = 0; i <= 200; i++) {
            const u = i / 200;
            const v = 0.5 + sgn * 0.27 * Math.sin(u * Math.PI * 2);
            if (i === 0) g.moveTo(u * w, v * h + dy); else g.lineTo(u * w, v * h + dy);
          }
          g.stroke();
        }
      };
      seams('rgba(255,170,100,.35)', 9, 1.5);
      seams('#160803', 6, 0);
    }, { aniso: 4 });
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
        const grd = g.createLinearGradient(0, 0, 0, H);
        grd.addColorStop(0, shade(bg, 0.16)); grd.addColorStop(0.55, bg); grd.addColorStop(1, shade(bg, -0.25));
        g.fillStyle = grd; g.fillRect(i * pw, 0, pw, H);
        // franjas diagonales tenues y rombos a los lados: pantalla LED, no un cartel pintado
        g.save(); g.beginPath(); g.rect(i * pw, 0, pw, H); g.clip();
        g.fillStyle = 'rgba(255,255,255,.06)';
        for (let k = -2; k < 8; k++) { g.beginPath(); g.moveTo(i * pw + k * 40, H); g.lineTo(i * pw + k * 40 + 34, 0); g.lineTo(i * pw + k * 40 + 50, 0); g.lineTo(i * pw + k * 40 + 16, H); g.fill(); }
        g.fillStyle = fg;
        for (const x of [i * pw + 14, i * pw + pw - 14]) { g.beginPath(); g.moveTo(x, H / 2 - 9); g.lineTo(x + 7, H / 2); g.lineTo(x, H / 2 + 9); g.lineTo(x - 7, H / 2); g.fill(); }
        g.restore();
        g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
        fitText(g, name, pw - 60, 46, 'bold', '"Barlow Condensed", "Arial Narrow", Impact, sans-serif');
        g.fillText(name, i * pw + pw / 2, H / 2 + 2);
      }
      // trama de píxeles LED (líneas oscuras finas)
      g.fillStyle = 'rgba(0,0,0,.16)';
      for (let y = 3; y < H; y += 4) g.fillRect(0, y, W, 1);
    }, { repeat: true, aniso: 4 });
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
  // Pantalla del cubo marcador: nombre del juego arriba y tanteador con los colores de los equipos.
  function paintScoreboard(g, w, h, teams) {
    const bgd = g.createLinearGradient(0, 0, 0, h);
    bgd.addColorStop(0, '#0B1630'); bgd.addColorStop(1, '#04060C');
    g.fillStyle = bgd; g.fillRect(0, 0, w, h);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const fam = '"Barlow Condensed", "Arial Narrow", Impact, sans-serif';
    g.font = `900 78px ${fam}`;
    const wj = g.measureText('JUGADA ').width, wm = g.measureText('MAESTRA').width, x0 = (w - wj - wm) / 2;
    g.textAlign = 'left';
    g.fillStyle = '#F7EEDF'; g.fillText('JUGADA ', x0, 66);
    g.fillStyle = '#F26B1D'; g.fillText('MAESTRA', x0 + wj, 66);
    g.fillStyle = '#F26B1D'; g.fillRect(40, 116, w - 80, 5);
    // tanteador
    const home = (teams && teams[0]) || ['#B3202A', '#F5F0E6'], away = (teams && teams[1]) || ['#1C1C1C', '#E8B04B'];
    const box = (x, c, label, pts) => {
      g.fillStyle = c[0]; g.fillRect(x, 138, 150, 98);
      g.strokeStyle = c[1]; g.lineWidth = 5; g.strokeRect(x + 2.5, 140.5, 145, 93);
      g.textAlign = 'center';
      g.fillStyle = luma(c[0]) > 0.6 ? '#101522' : '#FFFFFF';
      g.font = `bold 26px ${fam}`; g.fillText(label, x + 75, 160);
      g.font = `900 64px ${fam}`; g.fillText(pts, x + 75, 204);
    };
    box(28, home, 'LOCAL', '88'); box(w - 178, away, 'VISITA', '86');
    g.textAlign = 'center';
    g.fillStyle = '#FFC53D'; g.font = `900 58px ${fam}`; g.fillText('0:24', w / 2, 178);
    g.fillStyle = '#9FB4DD'; g.font = `bold 26px ${fam}`; g.fillText('4.º CUARTO', w / 2, 222);
    g.fillStyle = 'rgba(0,0,0,.14)';
    for (let y = 2; y < h; y += 4) g.fillRect(0, y, w, 1);
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

  // ------------------------------------------------------------------ Atlas del público (impostores)
  // Un lienzo con CROWD_V variantes de espectador × 2 cuadros (0 = sentado, 1 = de pie festejando).
  // Mitad superior: color (las partes teñibles van en gris con su sombreado); mitad inferior: máscara
  // (R = remera, G = color secundario, R+G = pelo, B = piel, negro = color fijo). El shader tiñe cada
  // instancia con sus colores: así 12 dibujos dan miles de personas distintas en una sola textura.
  const CROWD_V = 12, CROWD_CW = 128, CROWD_CH = 256;
  const CROWD_VARIANTS = [
    { top: 'remera', hair: 'corto', arms: 'regazo', pants: '#2f3f5c' },
    { top: 'camiseta', hair: 'rapado', arms: 'aplauso', pants: '#1d1f26' },
    { top: 'buzo', hair: 'largo', arms: 'regazo', pants: '#3a4252' },
    { top: 'campera', hair: 'corto', arms: 'cruzados', extra: 'bufanda', pants: '#23262e', beard: true },
    { top: 'remera', hair: 'coleta', arms: 'aplauso', pants: '#4a5670' },
    { top: 'remera', hair: 'gorra', arms: 'regazo', pants: '#6d604c' },
    { top: 'rayas', hair: 'rulos', arms: 'regazo', pants: '#25344f' },
    { top: 'remera', hair: 'largo', arms: 'cartel', extra: 'cartel', pants: '#2f3f5c' },
    { top: 'camiseta', hair: 'corto', arms: 'bandera', extra: 'bandera', pants: '#1d1f26' },
    { top: 'buzo', hair: 'gorro', arms: 'regazo', extra: 'bufanda', pants: '#2b2f38' },
    { top: 'remera', hair: 'pelado', arms: 'cruzados', pants: '#55504a', beard: true },
    { top: 'remera', hair: 'rulos', arms: 'aplauso', pants: '#2f3f5c' },
  ];
  function crowdAtlas() {
    const W = CROWD_CW * CROWD_V, H = CROWD_CH * 4;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, H / 2, W, H / 2);           // fondo de la máscara: "color fijo"
    for (let v = 0; v < CROWD_V; v++) for (let f = 0; f < 2; f++) {
      for (const mask of [false, true]) {
        g.save();
        g.translate(v * CROWD_CW, f * CROWD_CH + (mask ? H / 2 : 0));
        g.beginPath(); g.rect(2, 2, CROWD_CW - 4, CROWD_CH - 4); g.clip();   // margen contra el sangrado de mipmaps
        paintFan(g, mask, CROWD_VARIANTS[v], f);
        g.restore();
      }
    }
    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }
  // Dibuja un espectador en una celda de 128 × 256 (cabeza en (64, 80); el borde inferior queda
  // tapado por la fila de adelante). mask = true pinta la máscara de teñido en lugar del color.
  function paintFan(g, mask, V, f) {
    const MK = { shirt: '#f00', sec: '#0f0', skin: '#00f', hair: '#ff0' };
    const gray = (k) => { const n = Math.round(Math.max(0, Math.min(1, k)) * 255); return `rgb(${n},${n},${n})`; };
    const vg = (y0, y1, a, b) => { const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, gray(a)); gr.addColorStop(1, gray(b)); return gr; };
    // style: color fijo (css) o gris/degradado para las partes teñibles
    const paint = (kind, style) => { g.fillStyle = mask ? (MK[kind] || '#000') : style; g.fill(); };
    const limb = (kind, style, pts, w) => {
      g.beginPath(); g.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
      g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round';
      g.strokeStyle = mask ? (MK[kind] || '#000') : style; g.stroke();
    };
    const ell = (x, y, rx, ry, a0, a1) => { g.beginPath(); g.ellipse(x, y, rx, ry, 0, a0 || 0, a1 == null ? Math.PI * 2 : a1); g.closePath(); };
    const shade = (alpha, y0, y1) => {                       // oscurecido solo en el color (sombras)
      if (mask) return;
      const gr = g.createLinearGradient(0, y0, 0, y1);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${alpha})`);
      g.save(); g.globalCompositeOperation = 'source-atop'; g.fillStyle = gr; g.fillRect(0, y0, 128, y1 - y0); g.restore();
    };
    const up = f === 1;
    const skinG = vg(60, 200, 0.95, 0.78), hairG = vg(52, 110, 0.62, 0.38);
    const sleeveKind = V.top === 'campera' ? 'fixed' : 'shirt';
    const jacket = '#2a303c';
    const topStyle = (y0, y1) => V.top === 'campera' ? jacket : vg(y0, y1, 0.93, 0.66);

    // --- pelo de atrás (largo, rulos, coleta) y capucha
    if (V.hair === 'largo') { g.beginPath(); g.moveTo(44, 70); g.quadraticCurveTo(40, 118, 50, 124); g.lineTo(78, 124); g.quadraticCurveTo(88, 118, 84, 70); g.closePath(); paint('hair', hairG); }
    if (V.hair === 'rulos') { ell(64, 74, 27, 25); paint('hair', hairG); }
    if (V.hair === 'coleta') { ell(86, 98, 7, 17); paint('hair', hairG); }
    if (V.top === 'buzo') { ell(64, 110, 27, 11); paint('shirt', gray(0.55)); }

    // --- piernas (sentado: muslos hacia el frente; de pie: piernas rectas)
    if (up) { limb('fixed', V.pants, [50, 196, 48, 256], 24); limb('fixed', V.pants, [78, 196, 80, 256], 24); }
    else { g.beginPath(); g.moveTo(32, 192); g.lineTo(96, 192); g.quadraticCurveTo(104, 240, 94, 252); g.lineTo(34, 252); g.quadraticCurveTo(24, 240, 32, 192); paint('fixed', V.pants); }

    // --- torso
    const torso = () => { g.beginPath(); g.moveTo(30, 126); g.quadraticCurveTo(32, 108, 50, 106); g.lineTo(78, 106); g.quadraticCurveTo(96, 108, 98, 126); g.lineTo(96, 202); g.lineTo(32, 202); g.closePath(); };
    torso(); paint(V.top === 'campera' ? 'fixed' : 'shirt', topStyle(106, 202));
    if (V.top === 'campera') { g.beginPath(); g.moveTo(54, 108); g.lineTo(74, 108); g.lineTo(70, 202); g.lineTo(58, 202); g.closePath(); paint('shirt', vg(106, 202, 0.9, 0.7)); }
    if (V.top === 'rayas') { g.save(); torso(); g.clip(); for (let y = 122; y < 204; y += 22) { g.beginPath(); g.rect(20, y, 90, 10); paint('sec', vg(y, y + 10, 0.88, 0.75)); } g.restore(); }
    if (V.top === 'camiseta') {                                  // musculosa: hombros de piel y vivos
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(64 + s * 34, 128); g.quadraticCurveTo(64 + s * 33, 108, 64 + s * 20, 106); g.lineTo(64 + s * 18, 112); g.quadraticCurveTo(64 + s * 24, 128, 64 + s * 32, 150); g.closePath(); paint('skin', skinG); }
      limb('sec', gray(0.85), [44, 108, 46, 126, 52, 150], 3.5); limb('sec', gray(0.85), [84, 108, 82, 126, 76, 150], 3.5);
      limb('sec', gray(0.85), [52, 107, 64, 122, 76, 107], 4);
    }
    if (!mask && V.top !== 'campera') { g.save(); torso(); g.clip(); g.fillStyle = 'rgba(0,0,0,.16)'; g.fillRect(26, 106, 9, 100); g.fillRect(93, 106, 9, 100); g.restore(); }
    // cuello y escote
    g.beginPath(); g.rect(56, 94, 16, 16); paint('skin', skinG);
    if (V.top !== 'camiseta') { ell(64, 107, 10, 5, 0, Math.PI); paint('skin', gray(0.72)); }

    // --- brazos: [hombro, codo, mano] por lado según la postura
    let arms;
    if (up) arms = V.arms === 'cartel' ? [[34, 118, 26, 82, 30, 48], [94, 118, 102, 82, 98, 48]]
      : V.arms === 'bandera' ? [[34, 118, 22, 76, 18, 34], [94, 118, 108, 80, 110, 40]]
        : [[34, 118, 20, 72, 14, 28], [94, 118, 108, 72, 114, 28]];
    else if (V.arms === 'aplauso') arms = [[33, 120, 26, 164, 58, 152], [95, 120, 102, 164, 70, 152]];
    else if (V.arms === 'cruzados') arms = [[33, 120, 27, 166, 90, 160], [95, 120, 101, 168, 38, 166]];
    else if (V.arms === 'cartel') arms = [[33, 120, 26, 160, 34, 176], [95, 120, 102, 160, 94, 176]];
    else if (V.arms === 'bandera') arms = [[33, 120, 25, 166, 46, 196], [95, 120, 104, 160, 110, 150]];
    else arms = [[33, 120, 25, 168, 46, 196], [95, 120, 103, 168, 82, 196]];
    const longSleeve = V.top === 'buzo' || V.top === 'campera';
    for (const a of arms) {
      limb(longSleeve ? sleeveKind : 'skin', longSleeve ? (V.top === 'campera' ? jacket : gray(0.8)) : gray(0.86), a, 15);
      if (!longSleeve && V.top !== 'camiseta') {                 // manga corta
        const mx = a[0] + (a[2] - a[0]) * 0.5, my = a[1] + (a[3] - a[1]) * 0.5;
        limb('shirt', gray(0.84), [a[0], a[1], mx, my], 18);
      }
      ell(a[4], a[5], 7.5, 7.5); paint('skin', gray(0.9));
    }
    if (!up && V.arms === 'cruzados') { limb(longSleeve ? sleeveKind : 'skin', longSleeve ? (V.top === 'campera' ? jacket : gray(0.76)) : gray(0.8), [27, 166, 90, 160], 14); }

    // --- objetos
    if (V.extra === 'cartel') {
      const r = up ? [16, 4, 96, 46] : [28, 132, 72, 44];
      g.beginPath(); g.rect(r[0], r[1], r[2], r[3]); paint('fixed', '#F4F1EA');
      g.beginPath(); g.rect(r[0], r[1], r[2], 5); paint('sec', gray(0.85));
      for (let k = 0; k < 2; k++) { g.beginPath(); g.rect(r[0] + 10, r[1] + 13 + k * 13, r[2] - 20 - k * 16, 7); paint(k ? 'shirt' : 'sec', gray(0.8)); }
    }
    if (V.extra === 'bandera') {
      const sx = up ? 110 : 110, y0 = up ? 2 : 22, y1 = up ? 44 : 160;
      limb('fixed', '#D8D8D8', [sx, y0, sx, y1], 3);
      g.beginPath(); g.moveTo(sx, y0); g.quadraticCurveTo(sx - 26, y0 - 4, sx - 52, y0 + 4); g.lineTo(sx - 52, y0 + 18); g.quadraticCurveTo(sx - 26, y0 + 12, sx, y0 + 18); g.closePath(); paint('shirt', gray(0.9));
      g.beginPath(); g.moveTo(sx, y0 + 18); g.quadraticCurveTo(sx - 26, y0 + 12, sx - 52, y0 + 18); g.lineTo(sx - 52, y0 + 32); g.quadraticCurveTo(sx - 26, y0 + 26, sx, y0 + 34); g.closePath(); paint('sec', gray(0.88));
    }
    if (V.extra === 'bufanda') {
      if (up) {
        g.beginPath(); g.rect(14, 18, 100, 13); paint('sec', gray(0.88));
        for (let x = 22; x < 110; x += 18) { g.beginPath(); g.rect(x, 18, 6, 13); paint('shirt', gray(0.92)); }
        ell(64, 108, 20, 6); paint('sec', gray(0.8));
      } else {
        ell(64, 108, 22, 7); paint('sec', gray(0.85));
        for (const x of [53, 66]) { g.beginPath(); g.rect(x, 108, 10, 52); paint('sec', vg(108, 160, 0.88, 0.7)); g.beginPath(); g.rect(x, 140, 10, 6); paint('shirt', gray(0.92)); }
      }
    }

    // --- cabeza: orejas, cara, pelo de adelante
    ell(46.5, 83, 4, 6); paint('skin', gray(0.8)); ell(81.5, 83, 4, 6); paint('skin', gray(0.8));
    ell(64, 80, 17, 20); paint('skin', vg(60, 100, 0.97, 0.82));
    if (!mask) {                                               // sombreado lateral y del mentón
      g.save(); ell(64, 80, 17, 20); g.clip();
      const gr = g.createRadialGradient(60, 74, 6, 64, 80, 22); gr.addColorStop(0, 'rgba(255,255,255,.10)'); gr.addColorStop(1, 'rgba(0,0,0,.28)');
      g.fillStyle = gr; g.fillRect(40, 56, 50, 50); g.restore();
    }
    if (V.beard) { g.beginPath(); g.ellipse(64, 86, 17, 14, 0, 0.05, Math.PI - 0.05); g.lineTo(52, 90); g.quadraticCurveTo(64, 96, 76, 90); g.closePath(); paint('hair', gray(0.5)); }
    // ojos, cejas, nariz y boca
    for (const x of [57, 71]) { ell(x, 81, 2.6, 2.3); paint('fixed', '#1a120c'); }
    limb('hair', gray(0.45), [53, 75.5, 60, 74.5], 2.4); limb('hair', gray(0.45), [68, 74.5, 75, 75.5], 2.4);
    if (!mask) { limb('skin', 'rgba(90,60,40,.35)', [64, 82, 65, 88, 62, 89], 2); }
    if (up) { ell(64, 93, 5, 4.2); paint('fixed', '#4a1414'); }
    else limb('fixed', '#7a3a30', [59, 92.5, 64, 94, 69, 92.5], 2);
    // pelo / gorros
    const h = V.hair;
    if (h === 'corto' || h === 'largo' || h === 'coleta' || h === 'rulos') {
      ell(64, 72, 18.5, 14, Math.PI, Math.PI * 2); paint('hair', hairG);
      g.beginPath(); g.moveTo(45.5, 72); g.quadraticCurveTo(52, 64, 66, 69); g.quadraticCurveTo(76, 64, 82.5, 72); g.closePath(); paint('hair', hairG);
      if (h === 'largo') { for (const s of [-1, 1]) { g.beginPath(); g.moveTo(64 + s * 18.5, 70); g.quadraticCurveTo(64 + s * 20, 100, 64 + s * 17, 118); g.lineTo(64 + s * 12, 118); g.quadraticCurveTo(64 + s * 15, 96, 64 + s * 12, 72); g.closePath(); paint('hair', hairG); } }
      if (h === 'rulos') for (let k = 0; k < 7; k++) { ell(44 + k * 6.7, 66 + Math.abs(k - 3) * 1.6, 5.5, 5); paint('hair', vg(56, 76, 0.6, 0.42)); }
      if (h !== 'rulos') { g.beginPath(); g.rect(45.5, 70, 4, 11); paint('hair', hairG); g.beginPath(); g.rect(78.5, 70, 4, 11); paint('hair', hairG); }
    } else if (h === 'rapado') {
      ell(64, 72, 17.6, 12.5, Math.PI, Math.PI * 2); paint('hair', vg(58, 72, 0.72, 0.6));
    } else if (h === 'pelado') {
      if (!mask) { ell(60, 66, 7, 4); g.fillStyle = 'rgba(255,255,255,.22)'; g.fill(); }
      g.beginPath(); g.rect(46, 74, 4, 10); paint('hair', gray(0.6)); g.beginPath(); g.rect(78, 74, 4, 10); paint('hair', gray(0.6));
    } else if (h === 'gorra') {
      g.beginPath(); g.rect(46, 70, 4, 11); paint('hair', hairG); g.beginPath(); g.rect(78, 70, 4, 11); paint('hair', hairG);
      ell(64, 71, 19, 14, Math.PI, Math.PI * 2); paint('sec', vg(57, 71, 0.95, 0.75));
      ell(64, 71.5, 22, 4.5); paint('sec', gray(0.6));
      ell(64, 60, 3, 2); paint('shirt', gray(0.9));
    } else if (h === 'gorro') {
      ell(64, 73, 19.5, 17, Math.PI, Math.PI * 2); paint('sec', vg(56, 73, 0.92, 0.72));
      g.beginPath(); g.rect(44.5, 66, 39, 9); paint('shirt', gray(0.88));
      ell(64, 54, 6, 6); paint('shirt', gray(0.95));
    }
    // sombra de la fila de adelante y del asiento (oclusión): oscurece la parte baja del cuerpo
    shade(0.62, 150, 256);
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
    renderer.toneMappingExposure = 1.0;
    const maxAniso = renderer.capabilities.getMaxAnisotropy();

    const scene = new T.Scene();
    scene.background = new T.Color(0x04060c);
    scene.fog = new T.Fog(0x080b16, 620, 2400);

    const camera = new T.PerspectiveCamera(FOV, 390 / 560, 2, 3200);
    camera.position.set(0, 160, 520);
    camera.lookAt(0, 20, -230);

    let cssW = 390, cssH = 560;
    const disposables = [];                 // geometrías/materiales/texturas a liberar
    const track = (o) => { disposables.push(o); return o; };

    const world = new T.Group(); scene.add(world);     // estadio fijo
    const dyn = new T.Group(); scene.add(dyn);         // jugadores (add/remove)
    const overlayGroup = new T.Group(); scene.add(overlayGroup);

    // ---------------------------------------------------------------- Luces
    // Ambiente de pabellón: poca luz general (las tribunas altas quedan en penumbra) y los focos
    // concentrados sobre la cancha (luz principal cálida con sombras + relleno frío + dos puntos).
    const hemi = new T.HemisphereLight(0xb9cbf5, 0x70502c, 0.78);
    scene.add(hemi);
    const sun = new T.DirectionalLight(0xfff0dc, 2.75);
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
    const fill = new T.DirectionalLight(0xa9c4ff, 0.6);
    fill.position.set(220, 300, -260);
    scene.add(fill);
    // puntos cálidos: reflejo de los focos sobre el parqué
    const warm1 = new T.PointLight(0xffd9a0, 230000, 900, 2); warm1.position.set(90, 300, -120); scene.add(warm1);
    const warm2 = new T.PointLight(0xffd9a0, 170000, 900, 2); warm2.position.set(-110, 300, 190); scene.add(warm2);

    // ---------------------------------------------------------------- Pisos con brillo de laca
    // El parqué y el piso perimetral reflejan, calculado en el shader (sin render extra ni texturas de
    // entorno): los focos del techo, los carteles LED de las cuatro paredes (con su desplazamiento) y
    // una banda tenue con el color de la tribuna. La intensidad sigue a Fresnel: casi nada mirando
    // desde arriba, marcado al ras del piso hacia el fondo.
    const ledTex = track(ledTexture());
    // brillo difuso de los carteles: un texel por marca (el filtro lineal funde los colores vecinos)
    const ledGlowTex = track(canvasTex(BRANDS.length, 1, (g) => {
      BRANDS.forEach((b, i) => { g.fillStyle = b[1]; g.fillRect(i, 0, 1, 1); g.globalAlpha = 0.3; g.fillStyle = b[2]; g.fillRect(i, 0, 1, 1); g.globalAlpha = 1; });
    }, { repeat: true }));
    ledGlowTex.generateMipmaps = false; ledGlowTex.minFilter = T.LinearFilter;
    const floorU = { uLed: { value: ledGlowTex }, uLedOff: { value: 0 }, uCrowdCol: { value: new T.Color(0.3, 0.3, 0.34) } };
    const LAMP_Y = ROOF_Y - 44;
    function glossyFloor(mat, kRefl, kPool) {
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uLed = floorU.uLed; sh.uniforms.uLedOff = floorU.uLedOff; sh.uniforms.uCrowdCol = floorU.uCrowdCol;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', `#include <common>
            varying vec3 vWPos;
            uniform sampler2D uLed; uniform float uLedOff; uniform vec3 uCrowdCol;`)
          .replace('#include <opaque_fragment>', `
            {
              vec3 vd = normalize(vWPos - cameraPosition);
              vec3 rr = vec3(vd.x, abs(vd.y) + 1e-4, vd.z);
              float cosT = clamp(-vd.y, 0.0, 1.0);
              float fres = 0.045 + 0.955 * pow(1.0 - cosT, 3.2);
              // pared que alcanza el rayo reflejado
              float tx = (249.7 - sign(rr.x) * vWPos.x) / (abs(rr.x) + 1e-4);
              float tz = rr.z > 0.0 ? (969.7 - vWPos.z) / (rr.z + 1e-4) : (vWPos.z + 369.7) / (1e-4 - rr.z);
              float tw = min(tx, tz);
              vec3 hit = vWPos + rr * tw;
              float u = tx < tz
                ? (rr.x < 0.0 ? (970.0 - hit.z) / 520.0 + 0.0503 : (hit.z + 370.0) / 520.0 + 0.5497)
                : (rr.z < 0.0 ? (hit.x + 250.0) / 520.0 - 0.3697 : (250.0 - hit.x) / 520.0 + 0.9697);
              // cartel LED: banda de 11,5 de alto, estirada hacia el observador (reflejo difuso del barniz)
              float band = smoothstep(0.0, 3.5, hit.y) * (1.0 - smoothstep(12.0, 19.0 + tw * 0.07, hit.y));
              vec3 refl = (texture2D(uLed, vec2(u + uLedOff, 0.5)).rgb * 1.5 + 0.04) * band;
              // tribuna con público: banda tenue encima de los carteles
              refl += uCrowdCol * smoothstep(15.0, 60.0, hit.y) * (1.0 - smoothstep(120.0, 360.0, hit.y)) * 0.55;
              // focos del techo (rejilla: x = ±170, z múltiplo de 300)
              float tc = ${LAMP_Y.toFixed(1)} / rr.y;
              vec2 hc = vWPos.xz + rr.xz * tc;
              float lx = abs(hc.x) - 170.0, lz = mod(clamp(hc.y, -449.0, 1049.0) + 150.0, 300.0) - 150.0;
              float d2 = lx * lx + lz * lz;
              float lamp = exp(-d2 / 1300.0) * 2.8 + exp(-d2 / 14000.0) * 0.36;
              refl += vec3(1.0, 0.93, 0.8) * lamp * step(tc, tw);
              outgoingLight += refl * fres * ${kRefl.toFixed(2)};
              // la luz de los focos cae hacia los bordes del piso
              float edge = max(smoothstep(190.0, 250.0, abs(vWPos.x)), 1.0 - smoothstep(-370.0, -310.0, vWPos.z));
              outgoingLight *= 1.0 - edge * ${kPool.toFixed(2)};
            }
            #include <opaque_fragment>`);
      };
      mat.customProgramCacheKey = () => 'piso' + kRefl + '_' + kPool;
    }

    // ---------------------------------------------------------------- Cancha
    let teams = [['#B3202A', '#F5F0E6'], ['#1C1C1C', '#E8B04B']];
    const courtNear = courtLayer(3, maxAniso, false), courtFarL = courtLayer(2, Math.min(8, maxAniso), true);
    track(courtNear.tex); track(courtFarL.tex);
    let courtKey = '';
    function repaintCourts() {
      const key = teams[0].join('|');
      if (key === courtKey) return;
      courtKey = key;
      courtNear.repaint(teams[0]); courtFarL.repaint(teams[0]);
    }
    repaintCourts();
    const courtMat = track(new T.MeshStandardMaterial({ map: courtNear.tex, roughness: 0.34, metalness: 0.0 }));
    glossyFloor(courtMat, 1.0, 0.0);                    // (reflejo, caída de luz hacia el borde)
    const courtGeo = track(new T.PlaneGeometry(COURT.w, COURT.h));
    const court = new T.Mesh(courtGeo, courtMat);
    court.rotation.x = -Math.PI / 2;
    court.receiveShadow = true;
    world.add(court);
    // mitad de cancha del fondo (la misma pintura, girada 180°)
    const farMat = track(new T.MeshStandardMaterial({ map: courtFarL.tex, roughness: 0.36 }));
    glossyFloor(farMat, 1.0, 0.0);
    const farCourt = new T.Mesh(courtGeo, farMat);
    farCourt.rotation.set(-Math.PI / 2, 0, Math.PI);
    farCourt.position.z = COURT.h;
    farCourt.receiveShadow = true;
    world.add(farCourt);
    // piso perimetral: goma oscura con un tinte del color del local (se recolorea en setTeams)
    const apronMat = track(new T.MeshStandardMaterial({ color: 0x1b2742, roughness: 0.5 }));
    glossyFloor(apronMat, 0.85, 0.55);
    const apron = new T.Mesh(track(new T.PlaneGeometry(BOWL.x * 2, BOWL.z1 - BOWL.z0)), apronMat);
    apron.rotation.x = -Math.PI / 2; apron.position.set(0, -0.25, (BOWL.z0 + BOWL.z1) / 2);
    apron.receiveShadow = true;
    world.add(apron);
    const trimMat = track(new T.MeshStandardMaterial({ color: 0x3b4f80, roughness: 0.7 }));
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
    // pasillos con escaleras: posiciones fijas a lo largo de cada lado (alineadas en todas las filas)
    const AISLES = { z: [-420, -210, 0, 210, 420].map((d) => (BOWL.z0 + BOWL.z1) / 2 + d), x: [-330, -130, 130, 330] };
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
    // Las tribunas se apagan con la altura: los focos apuntan a la cancha y arriba queda la penumbra.
    function dimWithHeight(mat, k) {
      mat.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying float vWY;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWY = (modelMatrix * vec4(transformed, 1.0)).y;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vWY;')
          .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb *= mix(1.0, ${k.toFixed(2)}, smoothstep(30.0, 330.0, vWY));`);
      };
      mat.customProgramCacheKey = () => 'altura' + k;
      return mat;
    }
    const standParts = [];
    standParts.push(...ringBoxes(0, 10, 0, 16));                                  // pared frontal
    for (const r of ROWS) standParts.push(...ringBoxes(r.off, r.off + r.depth, 0, r.y));
    standParts.push(...ringBoxes(ROWS.walkOff, ROWS[13].off, 0, ROWS.walkY));     // pasillo
    standParts.push(...ringBoxes(ROWS.topOff, ROWS.topOff + 20, 0, ROWS.topY + 64)); // pared superior
    const standMat = dimWithHeight(track(new T.MeshStandardMaterial({ color: 0x343a4a, roughness: 0.95 })), 0.3);
    const stands = new T.Mesh(track(mergeGeoms(standParts)), standMat);
    world.add(stands);
    // pared frontal oscura + baranda del pasillo + baranda superior (merged, material oscuro)
    const darkMat = dimWithHeight(track(new T.MeshStandardMaterial({ color: 0x18203a, roughness: 0.7 })), 0.45);
    const railParts = ringBoxes(ROWS.walkOff - 1.5, ROWS.walkOff + 1.5, ROWS.walkY, ROWS.walkY + 10)
      .concat(ringBoxes(-1.5, 0, 15.2, 16.6))
      .concat(ringBoxes(ROWS[13].off - 2.5, ROWS[13].off - 0.5, ROWS[13].y - 11, ROWS[13].y + 10));
    // respaldos de las butacas: una tira oscura por fila detrás del público, cortada en los pasillos
    {
      const cz = (BOWL.z0 + BOWL.z1) / 2;
      const segs = (lo, hi, aisles) => {
        const out = []; let a = lo;
        for (const c of aisles.filter((v) => v > lo && v < hi).sort((p, q) => p - q)) { if (c - 13 > a) out.push([a, c - 13]); a = c + 13; }
        if (hi > a) out.push([a, hi]);
        return out;
      };
      for (const r of ROWS) {
        const o = r.off + r.depth * 0.84, hx = BOWL.x + o, hz = (BOWL.z1 - BOWL.z0) / 2 + o, yb = r.y + 4;
        for (const [a, b] of segs(cz - hz, cz + hz, AISLES.z)) for (const sx of [-1, 1]) railParts.push(placed(new T.BoxGeometry(2, 8, b - a), sx * hx, yb, (a + b) / 2));
        for (const [a, b] of segs(-hx + 2, hx - 2, AISLES.x)) for (const sz of [-1, 1]) railParts.push(placed(new T.BoxGeometry(b - a, 8, 2), (a + b) / 2, yb, cz + sz * hz));
      }
    }
    const rails = new T.Mesh(track(mergeGeoms(railParts)), darkMat);
    world.add(rails);
    // escaleras de los pasillos: escalones claros (con un medio escalón por fila) entre los bloques de butacas
    {
      const cz = (BOWL.z0 + BOWL.z1) / 2, parts = [];
      ROWS.forEach((r, k) => {
        const nx = ROWS[k + 1], rise = nx && nx.upper === r.upper ? nx.y - r.y : 0;
        const mid = r.off + r.depth / 2, hx = BOWL.x + mid, hz = (BOWL.z1 - BOWL.z0) / 2 + mid;
        for (const z of AISLES.z) for (const sx of [-1, 1]) {
          parts.push(placed(new T.BoxGeometry(r.depth, 1, 22), sx * hx, r.y + 0.5, z));
          if (rise) parts.push(placed(new T.BoxGeometry(r.depth / 2, rise / 2, 22), sx * (hx + r.depth / 4), r.y + rise / 4, z));
        }
        for (const x of AISLES.x) for (const sz of [-1, 1]) {
          if (Math.abs(x) > BOWL.x + r.off - 12) continue;
          parts.push(placed(new T.BoxGeometry(22, 1, r.depth), x, r.y + 0.5, cz + sz * hz));
          if (rise) parts.push(placed(new T.BoxGeometry(22, rise / 2, r.depth / 2), x, r.y + rise / 4, cz + sz * (hz + r.depth / 4)));
        }
      });
      world.add(new T.Mesh(track(mergeGeoms(parts)), dimWithHeight(track(new T.MeshStandardMaterial({ color: 0x7c8494, roughness: 0.9 })), 0.3)));
    }

    // carteles LED sobre la pared frontal (una sola malla, una textura)
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

    // ---------------------------------------------------------------- Público (impostores instanciados)
    // Cada espectador es un plano de 2 triángulos que gira sobre su eje vertical para mirar a la cámara,
    // con una celda del atlas de personas (sentado o de pie festejando), teñida por instancia (remera,
    // color secundario, piel, pelo). Todo el público son dos InstancedMesh con un único material.
    const SEATS = [];                      // { x, z, y, edge, row, k }
    {
      const cz = (BOWL.z0 + BOWL.z1) / 2, rnd = lcg(7);
      const aislesZ = AISLES.z, aislesX = AISLES.x;
      const inAisle = (v, list) => list.some((a) => Math.abs(v - a) < 13);
      ROWS.forEach((r, row) => {
        const off = r.off + r.depth * 0.55, y = r.y;
        const hx = BOWL.x + off, hz = (BOWL.z1 - BOWL.z0) / 2 + off;
        const step = 10.2, shift = (row % 2) * step * 0.5;     // filas al tresbolillo: nadie tapa de lleno al de atrás
        const nz = Math.floor((hz * 2) / step), nx = Math.floor((hx * 2) / step);
        const push = (st) => { if (rnd() > 0.025) SEATS.push(st); };   // algún asiento vacío suelto
        for (let i = 0; i < nz; i++) {
          const z = cz - hz + (i + 0.5) * step + shift;
          if (z > cz + hz - 4 || inAisle(z, aislesZ)) continue;
          push({ x: -hx, z, y, edge: 0, row, k: i });
          push({ x: hx, z, y, edge: 1, row, k: i });
        }
        for (let i = 0; i < nx; i++) {
          const x = -hx + (i + 0.5) * step + shift;
          if (Math.abs(x) >= hx - 8 || inAisle(x, aislesX)) continue;
          push({ x, z: cz - hz, y, edge: 2, row, k: i });
          push({ x, z: cz + hz, y, edge: 3, row, k: i });
        }
      });
      // orden determinista mezclado para que al bajar la calidad queden asientos vacíos repartidos
      for (let i = SEATS.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = SEATS[i]; SEATS[i] = SEATS[j]; SEATS[j] = t; }
    }
    // Variante de cada espectador: carteles y banderas son raros; el resto, parejo.
    const VAR_POOL = [0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 0, 1, 2, 4, 5, 6, 9, 11, 3, 10];
    function pickVariant(r) { return r < 0.035 ? 7 : r < 0.07 ? 8 : VAR_POOL[Math.floor((r - 0.07) / 0.93 * VAR_POOL.length)]; }
    function crowdGeometry(set, seedOffset) {
      const g = new T.PlaneGeometry(17.6, 35.2);
      g.translate(0, 14.2, 0);                                 // base 3,4 unidades bajo el asiento
      const n = set.length, data = new Float32Array(n * 4), rnd = lcg(5 + seedOffset);
      for (let i = 0; i < n; i++) {
        data[i * 4] = pickVariant(rnd());
        data[i * 4 + 1] = rnd();                                // semilla (fase, pelo, ánimo)
        data[i * 4 + 2] = 0.5;                                  // hinchada: 1 local, 0 visita (lo fija colorCrowd)
        data[i * 4 + 3] = rnd();                                // tono de piel
      }
      g.setAttribute('aData', new T.InstancedBufferAttribute(data, 4));
      g.setAttribute('aCol2', new T.InstancedBufferAttribute(new Float32Array(n * 3), 3));
      return g;
    }
    const crowdTex = track(crowdAtlas());
    const crowdUniforms = { uTime: { value: 0 }, uCheer: { value: 1e3 } };
    const crowdMat = track(new T.MeshBasicMaterial({ map: crowdTex, alphaTest: 0.5, alphaToCoverage: true }));
    crowdMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = crowdUniforms.uTime;
      sh.uniforms.uCheer = crowdUniforms.uCheer;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec4 aData; attribute vec3 aCol2;
          uniform float uTime; uniform float uCheer;
          varying vec3 vShirt; varying vec3 vSec; varying vec3 vSkin; varying vec3 vHair; varying vec3 vShade; varying vec3 vFlash;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float sd = aData.y, ph = sd * 40.0;
          // de pie: unos pocos animan solos de a ratos; al convertir se para casi toda la hinchada local
          float lively = step(0.955, fract(sd * 13.7)) * step(0.62, fract(uTime * 0.11 + sd * 7.0));
          float ce = uCheer - fract(sd * 5.1) * 0.45;              // cada uno reacciona con su demora
          float wants = step(fract(sd * 3.3), mix(0.12, 0.92, aData.z));
          float cheer = wants * step(0.0, ce) * step(ce, 3.4 + fract(sd * 2.7) * 1.2);
          float stand = max(lively, cheer);
          vec2 cell = vec2(aData.x, stand);
          transformed.y += stand * 9.0 + cheer * abs(sin(ce * 7.0 + ph)) * 3.2 * step(0.35, fract(sd * 9.1))
            + (1.0 - stand) * sin(uTime * 1.2 + ph) * 0.18;
          transformed.x += sin(uTime * (1.0 + stand * 4.0) + ph) * (0.15 + stand * 0.5) * max(position.y, 0.0) / 32.0;
          // giro sobre el eje vertical para mirar a la cámara
          vec4 ic = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          vec2 dc = cameraPosition.xz - ic.xz;
          float ang = atan(dc.x, dc.y);
          transformed = vec3(transformed.x * cos(ang), transformed.y, -transformed.x * sin(ang));
          // tintes de la instancia
          vShirt = vec3(1.0);
          #ifdef USE_INSTANCING_COLOR
            vShirt = instanceColor.rgb;
          #endif
          vSec = aCol2;
          float sk = aData.w;
          vSkin = sk < 0.45 ? mix(vec3(0.98, 0.78, 0.64), vec3(0.86, 0.60, 0.44), sk / 0.45)
                : sk < 0.8 ? mix(vec3(0.80, 0.54, 0.38), vec3(0.55, 0.34, 0.21), (sk - 0.45) / 0.35)
                : mix(vec3(0.50, 0.31, 0.19), vec3(0.38, 0.23, 0.14), (sk - 0.8) / 0.2);
          vSkin = pow(vSkin, vec3(2.2));
          float hc = fract(sd * 17.3);
          vHair = hc < 0.45 ? vec3(0.018, 0.013, 0.01) : hc < 0.72 ? vec3(0.07, 0.035, 0.015)
                : hc < 0.84 ? vec3(0.42, 0.28, 0.12) : hc < 0.92 ? vec3(0.32, 0.30, 0.29) : vec3(0.30, 0.09, 0.03);
          vHair *= 2.2;
          // luz: las filas bajas reciben el rebote cálido de la cancha; hacia arriba, penumbra azulada
          float up = smoothstep(20.0, 340.0, ic.y);
          vShade = (0.88 + fract(sd * 23.1) * 0.2) * mix(vec3(1.1, 1.04, 0.96), vec3(0.3, 0.35, 0.47), up);
          // festejo: destellos de cámaras repartidos por la tribuna (uno cada tanto por persona)
          float fl = step(0.0, uCheer) * step(uCheer, 5.0) * step(0.972, fract(sd * 61.7 + floor(uTime * 12.0) * 0.371));
          vFlash = vec3(uv.x - 0.5, uv.y - 0.6, fl);`);
      // uv del atlas: celda (variante, sentado/de pie) calculada en begin_vertex
      sh.vertexShader = sh.vertexShader.replace('#include <fog_vertex>', `#include <fog_vertex>
          #ifdef USE_MAP
            vMapUv = vec2((cell.x + 0.01 + uv.x * 0.98) / ${CROWD_V.toFixed(1)}, 1.0 - (cell.y + 1.0) * 0.25 + (0.004 + uv.y * 0.992) * 0.25);
          #endif`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vShirt; varying vec3 vSec; varying vec3 vSkin; varying vec3 vHair; varying vec3 vShade; varying vec3 vFlash;`)
        .replace('#include <map_fragment>', `
          vec4 tc = texture2D(map, vMapUv);
          vec3 mk = texture2D(map, vMapUv - vec2(0.0, 0.5)).rgb;
          float wHair = min(mk.r, mk.g);
          float wShirt = mk.r - wHair, wSec = mk.g - wHair, wSkin = mk.b;
          float wt = clamp(wHair + wShirt + wSec + wSkin, 0.0, 1.0);
          vec3 tint = vShirt * wShirt + vSec * wSec + vSkin * wSkin + vHair * wHair;
          diffuseColor.rgb = (tc.rgb * (1.0 - wt) + tint * tc.r * 1.3) * vShade;
          diffuseColor.rgb += vec3(1.0, 0.98, 0.9) * vFlash.z * (1.0 - smoothstep(0.02, 0.12, length(vFlash.xy * vec2(1.0, 2.0)))) * 2.6;
          diffuseColor.a = tc.a;`)
        .replace('#include <color_fragment>', '');
    };
    // Dos mallas instanciadas (mitad cercana al aro / mitad lejana) para que el frustum culling descarte
    // la que queda detrás de la cámara en las vistas de juego.
    // La mitad lejana va ordenada por z: en las vistas de juego (mirando al aro) se recorta con `count`
    // lo que queda detrás de la cámara, sin partir el público en más mallas.
    const SEAT_SETS = [SEATS.filter((st) => st.z < 300), SEATS.filter((st) => st.z >= 300).sort((a, b) => a.z - b.z)];
    const FAR_Z = SEAT_SETS[1].map((st) => st.z);
    const crowds = SEAT_SETS.map((set, idx) => {
      const mesh = new T.InstancedMesh(track(crowdGeometry(set, idx * 1000)), crowdMat, set.length);
      const m = M4(), q = new T.Quaternion(), p = new T.Vector3(), s = new T.Vector3();
      const rnd = lcg(31 + idx);
      for (let i = 0; i < set.length; i++) {
        const st = set[i];
        const along = (rnd() - 0.5) * 1.6;                      // nadie queda perfecto en la grilla
        p.set(st.x + (st.edge >= 2 ? along : 0), st.y + 0.2, st.z + (st.edge < 2 ? along : 0));
        const kid = rnd() < 0.05;
        const sc = kid ? 0.8 : 0.9 + rnd() * 0.2;
        s.set(sc, sc * (0.95 + rnd() * 0.1), sc);
        mesh.setMatrixAt(i, m.compose(p, q, s));
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.boundingSphere.radius += 30;     // margen por el giro, el salto y la escala
      world.add(mesh);
      return mesh;
    });
    function colorCrowd() {
      const col = new T.Color(), c2 = new T.Color(), rnd = lcg(17);
      const home = new T.Color(teams[0][0]), home2 = new T.Color(teams[0][1]);
      const away = new T.Color(teams[1][0]), away2 = new T.Color(teams[1][1]);
      const white = new T.Color(0xf2f0ea), dark = new T.Color(0x1d2230);
      for (let c = 0; c < crowds.length; c++) {
        const crowd = crowds[c], geo = crowd.geometry, d = geo.attributes.aData.array, a2 = geo.attributes.aCol2.array;
        for (let i = 0; i < SEAT_SETS[c].length; i++) {
          const st = SEAT_SETS[c][i];
          // secciones: bloques de ~12 asientos × 4 filas se inclinan por un color; la visita se agrupa
          const sec = Math.sin((st.edge * 17 + Math.floor(st.k / 12)) * 12.9898 + Math.floor(st.row / 4) * 78.233) * 43758.5453;
          const bias = sec - Math.floor(sec);
          const awaySec = bias > 0.86;
          const r = rnd();
          let fan = 0.5;
          if (awaySec ? r < 0.6 : r < 0.05) {                    // hinchas de la visita
            fan = 0;
            if (rnd() < 0.7) { col.copy(away).offsetHSL(0, 0, (rnd() - 0.5) * 0.16); c2.copy(away2); } else { col.copy(away2); c2.copy(away); }
          } else if (r < 0.42 + bias * 0.25) {                   // camiseta del local
            fan = 1; col.copy(home).offsetHSL(0, 0, (rnd() - 0.5) * 0.18); c2.copy(rnd() < 0.75 ? home2 : white);
          } else if (r < 0.62 + bias * 0.15) {                   // segundo color del local
            fan = 1; col.copy(home2).offsetHSL(0, 0, -rnd() * 0.18); c2.copy(home);
          } else if (r < 0.9) {                                   // neutros: abrigos, buzos, remeras lisas
            const t = rnd();
            if (t < 0.45) col.setHSL(0.58 + rnd() * 0.1, 0.15 + rnd() * 0.2, 0.1 + rnd() * 0.14);
            else if (t < 0.75) col.setHSL(0, 0, 0.12 + rnd() * 0.7);
            else col.setHSL(rnd(), 0.35 + rnd() * 0.3, 0.35 + rnd() * 0.25);
            c2.copy(rnd() < 0.6 ? home : dark); fan = rnd() < 0.5 ? 1 : 0.5;
          } else { col.setHSL(rnd(), 0.55, 0.45); c2.copy(home2); fan = 0.5; }
          crowd.setColorAt(i, col);
          a2[i * 3] = c2.r; a2[i * 3 + 1] = c2.g; a2[i * 3 + 2] = c2.b;
          d[i * 4 + 2] = fan;
        }
        crowd.instanceColor.needsUpdate = true;
        geo.attributes.aCol2.needsUpdate = true; geo.attributes.aData.needsUpdate = true;
      }
    }
    colorCrowd();
    // Festejo: la hinchada local se para, salta y levanta los brazos unos segundos.
    let cheerAt = -1e3, clock = 0;
    function cheer() { cheerAt = clock; }                     // (los papelitos se encienden en update)

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
    {
      const cz = (BOWL.z0 + BOWL.z1) / 2, pos = [], cor = [], idx = [];
      let n = 0;
      for (let i = -2; i <= 2; i++) for (const x of [-170, 170]) {
        for (const c of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { pos.push(x, ROOF_Y - 44, cz + i * 300); cor.push(c[0], c[1]); }
        idx.push(n, n + 1, n + 2, n, n + 2, n + 3); n += 4;
      }
      const g = track(new T.BufferGeometry());
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      g.setAttribute('aCorner', new T.Float32BufferAttribute(cor, 2));
      g.setIndex(idx);
      g.boundingSphere = new T.Sphere(new T.Vector3(0, ROOF_Y - 44, cz), 700);
      const haloMat = track(new T.ShaderMaterial({
        uniforms: { map: { value: haloTex } },
        vertexShader: `attribute vec2 aCorner; varying vec2 vUv;
          void main() { vUv = aCorner * 0.5 + 0.5; vec4 mv = modelViewMatrix * vec4(position, 1.0); mv.xy += aCorner * 62.0; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform sampler2D map; varying vec2 vUv;
          void main() { vec4 t = texture2D(map, vUv); gl_FragColor = vec4(t.rgb * vec3(1.0, 0.95, 0.84) * t.a * 1.25, 1.0); }`,
        transparent: true, blending: T.AdditiveBlending, depthWrite: false,
      }));
      const halos = new T.Mesh(g, haloMat);
      halos.renderOrder = 5;
      world.add(halos);
    }
    // Haces de los focos: conos aditivos muy tenues (una malla). Solo se dibujan en los planos de
    // ambiente (portada y festejo); durante la jugada no, para no velar la cancha ni gastar relleno.
    const beams = (() => {
      const cz = (BOWL.z0 + BOWL.z1) / 2, parts = [];
      for (let i = -2; i <= 1; i++) for (const x of [-170, 170]) {
        const cone = new T.CylinderGeometry(10, 120, ROOF_Y - 50, 20, 1, true);
        // el haz apunta hacia el eje de la cancha
        const m = M4().makeTranslation(x * 0.62, (ROOF_Y - 50) / 2, cz + i * 300).multiply(M4().makeRotationZ(x > 0 ? -0.33 : 0.33));
        parts.push({ geo: cone, matrix: m });
      }
      const mat = track(new T.ShaderMaterial({
        vertexShader: `varying float vH; varying float vEdge;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vH = clamp(wp.y / ${(ROOF_Y - 50).toFixed(1)}, 0.0, 1.0);
            vec3 n = normalize(mat3(modelMatrix) * normal), v = normalize(cameraPosition - wp.xyz);
            vEdge = abs(dot(n, v));
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: `varying float vH; varying float vEdge;
          void main() {
            float a = pow(vEdge, 1.6) * (0.012 + 0.07 * vH * vH) * smoothstep(0.0, 0.12, vH);
            gl_FragColor = vec4(vec3(1.0, 0.93, 0.78) * a, 1.0);
          }`,
        transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide,
      }));
      const mesh = new T.Mesh(track(mergeGeoms(parts)), mat);
      mesh.renderOrder = 7; mesh.visible = false;
      world.add(mesh);
      return mesh;
    })();
    // Cubo marcador colgante sobre el centro: cuatro pantallas con el nombre del juego y el tanteador
    // (colores de los equipos, se repinta en setTeams), carcasa, anillo LED inferior y cables. En el
    // juego cuelga alto (nunca tapa la cancha); en la portada baja para entrar en el plano general.
    const sbCanvas = document.createElement('canvas'); sbCanvas.width = 512; sbCanvas.height = 256;
    const sbTex = track(new T.CanvasTexture(sbCanvas)); sbTex.colorSpace = T.SRGBColorSpace; sbTex.anisotropy = 4;
    function repaintScoreboard() { paintScoreboard(sbCanvas.getContext('2d'), 512, 256, teams); sbTex.needsUpdate = true; }
    repaintScoreboard();
    const cube = new T.Group();
    const CUBE_Y = { high: ROOF_Y - 58, low: 206 };
    {
      const half = 50, hgt = 50, tilt = 0.2, screens = [], body = [], ring = [];
      for (let k = 0; k < 4; k++) {
        const ry = k * Math.PI / 2;
        // pantalla inclinada hacia abajo: gira sobre su borde superior
        const m = M4().makeRotationY(ry).multiply(M4().makeTranslation(0, hgt / 2, half)).multiply(M4().makeRotationX(tilt)).multiply(M4().makeTranslation(0, -hgt / 2, 0));
        screens.push({ geo: new T.PlaneGeometry(half * 2 - 6, hgt), matrix: m });
        const rg = new T.PlaneGeometry(half * 2 - 14, 7), ruv = rg.attributes.uv;
        for (let i = 0; i < ruv.count; i++) ruv.setX(i, ruv.getX(i) * 0.2 + k * 0.25);
        ring.push({ geo: rg, matrix: M4().makeRotationY(ry).multiply(M4().makeTranslation(0, -hgt / 2 - 7, half - 8.5)) });
        body.push({ geo: new T.BoxGeometry(4, hgt + 4, 4), matrix: M4().makeRotationY(ry).multiply(M4().makeTranslation(half - 6, 0, half - 6)).multiply(M4().makeRotationX(0)) });
        body.push({ geo: new T.BoxGeometry(1.2, 260, 1.2), matrix: M4().makeRotationY(ry).multiply(M4().makeTranslation(half - 14, hgt / 2 + 130, half - 14)) });
      }
      body.push(placed(new T.BoxGeometry(half * 2 + 4, 5, half * 2 + 4), 0, hgt / 2 + 2, 0));
      body.push(placed(new T.BoxGeometry(half * 2 - 28, hgt, half * 2 - 28), 0, 0, 0));
      body.push(placed(new T.BoxGeometry(half * 2 - 18, 9, half * 2 - 18), 0, -hgt / 2 - 7, 0));
      const sbMat = track(new T.MeshBasicMaterial({ map: sbTex, toneMapped: false }));
      cube.add(new T.Mesh(track(mergeGeoms(screens)), sbMat));
      cube.add(new T.Mesh(track(mergeGeoms(body)), track(new T.MeshStandardMaterial({ color: 0x10141f, roughness: 0.6, metalness: 0.3 }))));
      cube.add(new T.Mesh(track(mergeGeoms(ring)), ledMat));
      cube.position.set(0, CUBE_Y.high, (BOWL.z0 + BOWL.z1) / 2);
      world.add(cube);
    }

    // ---------------------------------------------------------------- Túnel, bancos, mesa de control
    const tunnelFrameMat = track(new T.MeshStandardMaterial({ color: teams[0][0], roughness: 0.6 }));
    {
      const tunnelMat = track(new T.MeshStandardMaterial({ color: 0x05060a, roughness: 1 }));
      const tunnel = new T.Mesh(track(new T.BoxGeometry(60, 30, 30)), tunnelMat);
      tunnel.position.set(-BOWL.x - 15, 15, 760);
      world.add(tunnel);
      const tunnelFrame = new T.Mesh(track(new T.BoxGeometry(68, 36, 4)), tunnelFrameMat);
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
    // Por aro: vidrio (1), pintura del tablero + reloj de posesión (1), aro (1), red (1), soporte
    // acolchado (1) y metal (1). La red se anima en el shader: un bulto baja con la pelota y después
    // queda bamboleándose hasta frenarse.
    const hoops = [];
    const boardTex = track(canvasTex(512, 416, (c, w, h) => {
      // 43 × 35 unidades: arriba el reloj de posesión (10 de alto), abajo el tablero de 43 × 25
      c.clearRect(0, 0, w, h);
      const by = h - 300, bh = 300;
      // reflejos diagonales del vidrio
      c.save(); c.beginPath(); c.rect(0, by, w, bh); c.clip();
      const sheen = c.createLinearGradient(0, by, w, h);
      sheen.addColorStop(0, 'rgba(255,255,255,.20)'); sheen.addColorStop(0.3, 'rgba(255,255,255,.03)');
      sheen.addColorStop(0.55, 'rgba(255,255,255,.12)'); sheen.addColorStop(0.75, 'rgba(255,255,255,.02)'); sheen.addColorStop(1, 'rgba(255,255,255,.10)');
      c.fillStyle = sheen; c.fillRect(0, by, w, bh);
      c.fillStyle = 'rgba(255,255,255,.16)';
      c.beginPath(); c.moveTo(60, by); c.lineTo(150, by); c.lineTo(20, h); c.lineTo(0, h); c.lineTo(0, by + 140); c.fill();
      c.beginPath(); c.moveTo(330, by); c.lineTo(372, by); c.lineTo(250, h); c.lineTo(208, h); c.fill();
      c.restore();
      // marco blanco, rectángulo de tiro y borde inferior acolchado
      c.strokeStyle = '#ffffff'; c.lineWidth = 20; c.strokeRect(10, by + 10, w - 20, bh - 20);
      const iw = w * (14 / 43), ih = bh * (10.5 / 25);
      c.lineWidth = 12; c.strokeRect(w / 2 - iw / 2, h - ih - 42, iw, ih);
      c.fillStyle = '#1B2A4E'; c.fillRect(0, h - 22, w, 22); c.fillRect(0, h - 70, 14, 70); c.fillRect(w - 14, h - 70, 14, 70);
      c.fillStyle = '#F26B1D'; c.fillRect(w / 2 - iw / 2, h - 34, iw, 12);
      // reloj de posesión: caja negra con dígitos rojos
      c.fillStyle = '#0a0c12'; c.fillRect(w / 2 - 84, 0, 168, by - 8);
      c.strokeStyle = '#2b3145'; c.lineWidth = 6; c.strokeRect(w / 2 - 81, 3, 162, by - 14);
      c.fillStyle = '#ff3b2f'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = 'bold 92px "Barlow Condensed", "Arial Narrow", Impact, sans-serif';
      c.shadowColor = '#ff3b2f'; c.shadowBlur = 14;
      c.fillText('24', w / 2, (by - 8) / 2 + 4);
    }, { aniso: 4 }));
    const netShader = (mat, U) => {
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uNet = U;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform vec4 uNet; varying float vNetShade;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            // uNet = (bulto, profundidad del bulto 0..1, bamboleo, fase)
            float dpt = clamp(-position.y / 17.0, 0.0, 1.0);
            float bul = uNet.x * exp(-pow((dpt - uNet.y) / 0.26, 2.0));
            transformed.xz *= 1.0 + bul * 0.62 + uNet.z * 0.12 * dpt * sin(uNet.w * 1.7);
            transformed.y *= 1.0 + uNet.x * 0.16 + uNet.z * 0.07 * sin(uNet.w * 2.3);
            float sw = uNet.z * dpt * dpt;
            transformed.x += sin(uNet.w) * 3.0 * sw;
            transformed.z += cos(uNet.w * 0.83) * 2.2 * sw;
            // volumen: cordones del lado de la luz más claros, el fondo de la red algo más gris
            vNetShade = (0.66 + 0.34 * clamp(dot(normalize(normal), vec3(-0.35, 0.75, 0.55)) * 0.5 + 0.6, 0.0, 1.0)) * mix(1.0, 0.86, dpt);`);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vNetShade;')
          .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vNetShade;');
      };
      mat.customProgramCacheKey = () => 'red';
      return mat;
    };
    function buildHoop(padColor) {
      const g = new T.Group();
      const metal = track(new T.MeshStandardMaterial({ color: 0x8e97a8, roughness: 0.45, metalness: 0.35 }));
      const glass = track(new T.MeshStandardMaterial({ color: 0xcfe6f2, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.2, side: T.DoubleSide, depthWrite: false }));
      const boardY = HOOP_H - 3.6 + BOARD_H / 2;              // el aro queda 15 cm por encima del borde inferior
      const board = new T.Mesh(track(new T.BoxGeometry(BOARD_W, BOARD_H, 1.2)), glass);
      board.position.set(0, boardY, BOARD_Z - 0.6); board.renderOrder = 2; g.add(board);
      // pintura del tablero (marco, rectángulo, reflejos, acolchado) y reloj de posesión: una textura con alpha
      const lines = new T.Mesh(track(new T.PlaneGeometry(BOARD_W, BOARD_H * 416 / 300)), track(new T.MeshBasicMaterial({ map: boardTex, transparent: true, side: T.DoubleSide, depthWrite: false })));
      lines.position.set(0, boardY - BOARD_H / 2 + BOARD_H * 416 / 600, BOARD_Z + 0.08); lines.renderOrder = 3; g.add(lines);
      // aro + escuadra (una malla)
      const rimMat = track(new T.MeshStandardMaterial({ color: 0xf2601a, roughness: 0.38, metalness: 0.35, emissive: 0x4a1602 }));
      const rimGeo = new T.TorusGeometry(RIM_R, 0.75, 8, 32); rimGeo.rotateX(Math.PI / 2);
      const rim = new T.Mesh(track(mergeGeoms([
        placed(rimGeo, 0, HOOP_H, -230),
        placed(new T.BoxGeometry(5, 2.4, 4.6), 0, HOOP_H - 0.6, -230 - RIM_R - 1.7),
        placed(new T.BoxGeometry(6.5, 6, 0.8), 0, HOOP_H - 2.6, BOARD_Z + 0.5),
      ])), rimMat);
      rim.castShadow = true; g.add(rim);
      // red: 12 cordones en rombos (cilindros finos fusionados); origen local en el centro del aro
      const NS = 12, levels = [[0, RIM_R], [-3.4, 4.75], [-6.8, 4.05], [-10.2, 3.5], [-13.6, 3.2], [-17, 3.3]];
      const strands = [], up = new T.Vector3(0, 1, 0), q = new T.Quaternion();
      const strand = (a, b, r) => {
        const d = b.clone().sub(a), len = d.length();
        q.setFromUnitVectors(up, d.normalize());
        strands.push({ geo: new T.CylinderGeometry(r, r, len, 5, 1, true), matrix: M4().compose(a.clone().add(b).multiplyScalar(0.5), q, new T.Vector3(1, 1, 1)) });
      };
      for (let l = 0; l < levels.length - 1; l++) {
        for (let i = 0; i < NS; i++) {
          const [y0, r0] = levels[l], [y1, r1] = levels[l + 1];
          const a0 = ((i + (l % 2) * 0.5) / NS) * Math.PI * 2, p0 = new T.Vector3(Math.cos(a0) * r0, y0, Math.sin(a0) * r0);
          for (const sgn of [0.5, -0.5]) {
            const a1 = ((i + (l % 2) * 0.5 + sgn) / NS) * Math.PI * 2;
            strand(p0, new T.Vector3(Math.cos(a1) * r1, y1, Math.sin(a1) * r1), 0.27 - l * 0.012);
          }
        }
      }
      const uNet = { value: new T.Vector4(0, 0, 0, 0) };
      const net = new T.Mesh(track(mergeGeoms(strands)), netShader(track(new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })), uNet));
      net.position.set(0, HOOP_H, -230); net.frustumCulled = false; g.add(net);
      // soporte acolchado: base, poste inclinado y protector del brazo (una malla)
      const pad = track(new T.MeshStandardMaterial({ color: padColor, roughness: 0.7 }));
      const lean = M4().makeTranslation(0, 66, -338).multiply(M4().makeRotationX(0.2));
      const support = new T.Mesh(track(mergeGeoms([
        placed(new T.BoxGeometry(36, 20, 66), 0, 10, -350),
        placed(new T.BoxGeometry(30, 8, 40), 0, 24, -356),
        { geo: new T.BoxGeometry(11, 96, 12), matrix: lean },
        placed(new T.BoxGeometry(9, 9, 46), 0, 113, -306),
      ])), pad);
      support.castShadow = true; g.add(support);
      // metal: brazo, tirantes, marco del tablero y caja del reloj (una malla)
      const strut = (y, z, len, rx) => ({ geo: new T.BoxGeometry(3, 3, len), matrix: M4().makeTranslation(0, y, z).multiply(M4().makeRotationX(rx)) });
      const fz = BOARD_Z - 0.6;
      const frame = new T.Mesh(track(mergeGeoms([
        placed(new T.BoxGeometry(6, 6, 96), 0, 113, -328 + 48 + 7),
        strut(98, -290, 70, 0.52),
        placed(new T.BoxGeometry(9, 26, 3), 0, boardY + 2, BOARD_Z - 2.6),
        placed(new T.BoxGeometry(BOARD_W + 2, 1.4, 2.4), 0, boardY + BOARD_H / 2 + 0.7, fz), placed(new T.BoxGeometry(BOARD_W + 2, 1.4, 2.4), 0, boardY - BOARD_H / 2 - 0.7, fz),
        placed(new T.BoxGeometry(1.4, BOARD_H, 2.4), -BOARD_W / 2 - 0.7, boardY, fz), placed(new T.BoxGeometry(1.4, BOARD_H, 2.4), BOARD_W / 2 + 0.7, boardY, fz),
        placed(new T.BoxGeometry(15, 8.6, 4), 0, boardY + BOARD_H / 2 + 5.2, BOARD_Z - 2.2),
      ])), metal);
      frame.castShadow = true; g.add(frame);
      return { group: g, net, uNet, swish: 0, last: 0, sway: 0, phase: 0 };
    }
    const hoopNear = buildHoop(0x22335a); world.add(hoopNear.group); hoops.push(hoopNear);
    // el aro lejano se gira 180° y se corre 600: su aro local en z = -230 queda en z = 830 (cancha y = 1130)
    const hoopFar = buildHoop(0x22335a); hoopFar.group.rotation.y = Math.PI; hoopFar.group.position.z = 600; world.add(hoopFar.group); hoops.push(hoopFar);
    // swish 0..1 = la pelota atravesando la red (lo marca el juego). La escena agrega la inercia:
    // mientras pasa, un bulto baja por la red; al salir, la red queda bamboleándose ~1,5 s.
    function animateNet(h, dt) {
      const sIn = Math.max(0, Math.min(1, h.swish));
      if (sIn > 0 && sIn < 1) { h.sway = 1; }
      else if (sIn >= 1 && h.last < 1) h.sway = 1;
      h.last = sIn;
      if (h.sway > 0) { h.sway *= Math.exp(-dt * 2.3); h.phase += dt * 15; if (h.sway < 0.01) h.sway = 0; }
      const passing = sIn > 0 && sIn < 1 ? Math.sin(sIn * Math.PI) : 0;
      h.uNet.value.set(passing, sIn * 1.1, h.sway, h.phase);
    }

    // ---------------------------------------------------------------- Pelota
    // Textura de cuero granulado con canales (también como relieve), un leve brillo propio para que no
    // se apague en la sombra y un borde oscurecido (como un contorno) que la separa del parqué. Debajo,
    // una sombra de contacto marca su posición real sobre el piso aunque vaya por el aire.
    const ballGeo = track(new T.SphereGeometry(3.2, 28, 20));
    const ballTex = track(ballTexture());
    const ballMat = track(new T.MeshStandardMaterial({ map: ballTex, bumpMap: ballTex, bumpScale: 0.9, roughness: 0.5, metalness: 0, emissive: 0x5a1c04, emissiveIntensity: 0.55 }));
    ballMat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `
        {
          float ndv = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
          outgoingLight *= mix(0.22, 1.0, smoothstep(0.1, 0.5, ndv));
          outgoingLight += vec3(1.0, 0.62, 0.3) * pow(ndv, 6.0) * 0.1;
        }
        #include <opaque_fragment>`);
    };
    ballMat.customProgramCacheKey = () => 'pelota';
    const ballMesh = new T.Mesh(ballGeo, ballMat);
    ballMesh.castShadow = true; ballMesh.visible = false;
    scene.add(ballMesh);
    const ballShadowMat = track(new T.MeshBasicMaterial({ color: 0x1a0d04, transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      map: track(canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(255,255,255,.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.clearRect(0, 0, 64, 64); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); })) }));
    const ballShadow = new T.Mesh(track(new T.PlaneGeometry(9, 9)), ballShadowMat);
    ballShadow.rotation.x = -Math.PI / 2; ballShadow.visible = false; ballShadow.renderOrder = 4;
    scene.add(ballShadow);
    const ball = {
      mesh: ballMesh,
      set(x, y, h, visible) {
        const hh = h || 0;
        ballMesh.position.set(x - 180, hh + 3.2, y - 300); ballMesh.visible = visible !== false;
        // sombra de contacto: se agranda y se desvanece con la altura; fuera de la cancha no se dibuja
        const k = Math.min(1, hh / 150);
        ballShadow.visible = ballMesh.visible && hh > 0.6;
        ballShadow.position.set(x - 180, 0.35, y - 300);
        ballShadow.scale.setScalar(1 + k * 1.3);
        ballShadowMat.opacity = 0.42 * (1 - k * 0.75);
      },
      spin(dt) { ballMesh.rotation.x -= dt * 7; ballMesh.rotation.z += dt * 2.5; },
    };

    // ---------------------------------------------------------------- Viñeta
    // Un rectángulo a pantalla completa (1 draw call) oscurece apenas las esquinas y el borde superior:
    // concentra la mirada en la cancha y da el contraste de una transmisión.
    const vignette = new T.Mesh(track(new T.PlaneGeometry(2, 2)), track(new T.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `varying vec2 vUv;
        void main() {
          vec2 d = (vUv - vec2(0.5, 0.46)) * vec2(1.0, 0.92);
          float a = smoothstep(0.36, 0.88, length(d)) * 0.54 + smoothstep(0.7, 1.0, vUv.y) * 0.16;
          gl_FragColor = vec4(0.012, 0.02, 0.05, min(a, 0.8));
        }`,
      transparent: true, depthTest: false, depthWrite: false,
    })));
    vignette.frustumCulled = false; vignette.renderOrder = 999;
    scene.add(vignette);

    // ---------------------------------------------------------------- Papelitos del festejo
    // Una malla instanciada (1 draw call, solo visible los segundos posteriores a una canasta): cae
    // desde el techo de la zona del aro, con los colores del local. Toda la animación va en el shader.
    const CONFETTI_N = 640, CONFETTI_T = 6.5;
    const confettiU = { uT: { value: 0 } };
    const confetti = (() => {
      const g = new T.PlaneGeometry(3.6, 2.1);
      const m = new T.MeshBasicMaterial({ side: T.DoubleSide, toneMapped: false, transparent: true });
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uT = confettiU.uT;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nattribute vec4 aSeed; uniform float uT; varying float vFade;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            float t = max(uT - aSeed.w * 1.4, 0.0);
            float ang = t * (5.0 + aSeed.x * 9.0) + aSeed.y * 6.283;
            // el papelito gira sobre sí mismo mientras cae y se hamaca
            transformed = vec3(transformed.x * cos(ang) , transformed.y * cos(ang * 0.73) + transformed.x * sin(ang) * 0.35, transformed.x * sin(ang) + transformed.y * sin(ang * 0.73));
            float fall = t * (20.0 + aSeed.z * 18.0) + t * t * 1.5;
            transformed += vec3(sin(t * 1.9 + aSeed.y * 6.283) * 9.0 * aSeed.x, -fall, cos(t * 1.6 + aSeed.x * 6.283) * 7.0);
            vFade = step(0.001, t) * (1.0 - smoothstep(${(CONFETTI_T - 1.2).toFixed(1)}, ${CONFETTI_T.toFixed(1)}, uT));`);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vFade;')
          .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vFade;');
      };
      const mesh = new T.InstancedMesh(track(g), track(m), CONFETTI_N);
      const seed = new Float32Array(CONFETTI_N * 4), rnd = lcg(91), mt = M4();
      for (let i = 0; i < CONFETTI_N; i++) {
        seed[i * 4] = rnd(); seed[i * 4 + 1] = rnd(); seed[i * 4 + 2] = rnd(); seed[i * 4 + 3] = rnd();
        mesh.setMatrixAt(i, mt.makeTranslation((rnd() - 0.5) * 320, 110 + rnd() * 150, -280 + rnd() * 330));
      }
      g.setAttribute('aSeed', new T.InstancedBufferAttribute(seed, 4));
      mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 6;
      scene.add(mesh);
      return mesh;
    })();
    function colorConfetti() {
      const cols = [new T.Color(teams[0][0]), new T.Color(teams[0][1]), new T.Color('#FFC53D'), new T.Color('#FFFFFF')], rnd = lcg(5);
      for (let i = 0; i < CONFETTI_N; i++) confetti.setColorAt(i, cols[Math.floor(rnd() * 3.4) % 4]);
      confetti.instanceColor.needsUpdate = true;
    }
    colorConfetti();

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
    // Giro controlado por el usuario ("órbita"): yaw acotado a ±90° (180° de recorrido) y pitch a
    // −8°..+25°. Se aplica sobre el encuadre 'holder' y se conserva en 'follow' para que la vista no
    // salte durante un movimiento: la cámara gira alrededor del poseedor y el encuadre de todos los
    // puntos se vuelve a resolver con el giro aplicado. La transición es una amortiguación exponencial.
    const ORBIT = { yawMax: Math.PI / 2, pitchMin: -8 * Math.PI / 180, pitchMax: 25 * Math.PI / 180, damp: 9 };
    const orbit = { yaw: 0, pitch: 0, goalYaw: 0, goalPitch: 0, settled: true };
    const UP = new T.Vector3(0, 1, 0);
    const cam = {
      mode: 'holder', pos: camera.position.clone(), look: new T.Vector3(0, 20, -230),
      from: null, to: null, moving: false, t0: 0, dur: 0.6, goal: null, lastD: 180, target: null, points: [], holder: null, cineT: 0,
      scoreT: 0, scoreSide: 1, scoreA0: 0,
      dirty: false,                        // hay que volver a resolver el encuadre (giro, tamaño o franjas)
    };
    // Franjas de la interfaz superpuestas al canvas (px CSS): el encuadre deja esos bordes libres.
    const insets = { top: 0, bottom: 0, left: 0, right: 0 };
    function setInsets(o) {
      o = o || {};
      let changed = false;
      for (const k of ['top', 'bottom', 'left', 'right']) {
        const v = Math.max(0, o[k] || 0);
        if (v !== insets[k]) { insets[k] = v; changed = true; }
      }
      if (changed) cam.dirty = true;
    }
    const _v = new T.Vector3();
    const CAM_LIM = { x: BOWL.x - 14, z0: BOWL.z0 + 16, z1: BOWL.z1 - 16, y0: 28, y1: ROOF_Y - 90 };
    const clampPos = (p) => { p.x = Math.max(-CAM_LIM.x, Math.min(CAM_LIM.x, p.x)); p.z = Math.max(CAM_LIM.z0, Math.min(CAM_LIM.z1, p.z)); p.y = Math.max(CAM_LIM.y0, Math.min(CAM_LIM.y1, p.y)); return p; };

    // ---- Encuadre tipo Score! Hero: detrás y por encima del poseedor (girado por la órbita del
    // usuario), mirando al aro. Garantías del solucionador:
    //   1. El conjunto OBLIGATORIO (poseedor: pies, cabeza y ancho del cuerpo; aro: tablero, red y piso
    //      debajo) queda siempre dentro de la zona libre de interfaz. La cámara nunca sale del estadio:
    //      si el giro pedido no deja lugar (la tribuna queda demasiado cerca), el giro EFECTIVO se
    //      comprime dentro del intervalo de giros que sí encuadran (yawInterval) en vez de devolver un
    //      encuadre fallido.
    //   2. Los puntos opcionales (compañeros y defensores) entran por cercanía al poseedor: si no caben
    //      todos, se dejan fuera los más lejanos.
    // Todo trabaja sobre arreglos y registros reutilizados: no crea objetos por fotograma.
    const DEG = Math.PI / 180;
    const FR = {
      S: new Float32Array(3 * 96), nReq: 0, nOpt: 0,       // muestras (mundo): obligatorias y luego opcionales
      hx: 0, hz: 0, bx: 0, bz: 1, elev: CAM_ELEV, D0: 150,
      xLo: -1, xHi: 1, yLo: -1, yHi: 1, tanH: 1, tanV: 1, minPitch: 0.33, maxPitch: 1.05,
    };
    const OPT = [];                                        // puntos opcionales ordenados por cercanía
    for (let i = 0; i < 40; i++) OPT.push({ x: 0, y: 0, h: 0, d: 0 });
    const newFrame = () => ({ px: 0, py: 0, pz: 0, lyaw: 0, lpitch: 0, D: 0, ok: false, viol: 0 });
    const copyFrame = (a, b) => { b.px = a.px; b.py = a.py; b.pz = a.pz; b.lyaw = a.lyaw; b.lpitch = a.lpitch; b.D = a.D; b.ok = a.ok; b.viol = a.viol; return b; };
    const fTmp = newFrame(), fSet = newFrame(), fRes = newFrame(), fAux = newFrame(), fBest = newFrame();
    const DCAP_REQ = 900, DCAP_ALL = 700;                  // distancia máxima: obligatorios / con opcionales
    // rejilla de giros cada 7,5°: primero −90°..+90° (lo que puede pedir el usuario) y, si ahí no hay
    // lugar (poseedor en un rincón, de espaldas a la tribuna), la vuelta completa
    const YAW_N = 49, YAW_STEP = 7.5 * DEG, YAW_HALF = 12;
    const IV = { valid: false, a: -Math.PI / 2, b: Math.PI / 2, c: 0, none: false };
    const ivKey = new Float64Array(13), ivKeyPrev = new Float64Array(13);
    const feas = new Uint8Array(YAW_N);
    const framing = { effYaw: 0, shown: 0, total: 0, ok: true };   // resultado del último encuadre (diagnóstico)

    function addSample(x, y, h) {
      const i = (FR.nReq + FR.nOpt) * 3;
      if (i + 3 > FR.S.length) return;
      FR.S[i] = x - 180; FR.S[i + 1] = h; FR.S[i + 2] = y - 300;
    }
    function addReq(x, y, h) { addSample(x, y, h); FR.nReq++; }
    // Prepara las muestras y los límites de la zona útil para un poseedor y sus puntos.
    function setupFraming(holder, points, oPitch, D0) {
      FR.hx = holder.x - 180; FR.hz = holder.y - 300;
      let dx = HOOP.x - holder.x, dz = HOOP.y - holder.y;
      const dh = Math.hypot(dx, dz);
      if (dh < 1) { dx = 0; dz = -1; } else { dx /= dh; dz /= dh; }
      if (dh < 150) {                                      // cerca del aro: la vista tiende a mirar al fondo
        const k = (150 - dh) / 150;
        dx += (0 - dx) * k; dz += (-1 - dz) * k;
        const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      }
      FR.bx = -dx; FR.bz = -dz;                            // "atrás" del poseedor con giro 0
      FR.elev = Math.tan(Math.max(0.12, Math.min(1.25, Math.atan(CAM_ELEV) + oPitch)));
      FR.D0 = D0 || 150;
      FR.nReq = 0; FR.nOpt = 0;
      const req = addReq;
      // poseedor: pies, cabeza y un círculo de 20 unidades a media altura (brazos y cartel del nombre:
      // el margen al borde crece cuando la cámara está cerca)
      const top = holder.h != null ? holder.h + 8 : 52, mid = Math.min(30, top * 0.6);
      req(holder.x, holder.y, 0); req(holder.x, holder.y, top);
      req(holder.x - 20, holder.y, mid); req(holder.x + 20, holder.y, mid); req(holder.x, holder.y - 20, mid); req(holder.x, holder.y + 20, mid);
      // aro: tablero completo, aro, red y el piso de abajo
      req(HOOP.x - BOARD_W / 2, HOOP.y - 9, HOOP_H + 24); req(HOOP.x + BOARD_W / 2, HOOP.y - 9, HOOP_H + 24);
      req(HOOP.x - BOARD_W / 2, HOOP.y - 9, HOOP_H - 5); req(HOOP.x + BOARD_W / 2, HOOP.y - 9, HOOP_H - 5);
      req(HOOP.x, HOOP.y, HOOP_H); req(HOOP.x, HOOP.y + 6, HOOP_H - 18); req(HOOP.x, HOOP.y, 0);
      // opcionales, del más cercano al más lejano
      let n = 0;
      if (points) for (let i = 0; i < points.length && n < OPT.length; i++) {
        const p = points[i], o = OPT[n++];
        o.x = p.x != null ? p.x : p[0]; o.y = p.y != null ? p.y : p[1]; o.h = p.h || 0;
        o.d = (o.x - holder.x) * (o.x - holder.x) + (o.y - holder.y) * (o.y - holder.y);
      }
      for (let i = 1; i < n; i++) {                        // inserción (pocos elementos, sin basura)
        const cur = OPT[i]; let j = i - 1;
        while (j >= 0 && OPT[j].d > cur.d) { OPT[j + 1] = OPT[j]; j--; }
        OPT[j + 1] = cur;
      }
      for (let i = 0; i < n; i++) { const o = OPT[i]; addSample(o.x, o.y, 0); FR.nOpt++; addSample(o.x, o.y, o.h + 52); FR.nOpt++; }
      // zona útil en NDC: fuera de las franjas de interfaz, con margen
      const aspect = cssW / cssH;
      FR.tanV = Math.tan((FOV / 2) * DEG); FR.tanH = FR.tanV * aspect;
      FR.xLo = -1 + 2 * insets.left / cssW + 0.08; FR.xHi = 1 - 2 * insets.right / cssW - 0.08;
      FR.yLo = -1 + 2 * insets.bottom / cssH + (insets.bottom ? 0.05 : 0.09);
      FR.yHi = 1 - 2 * insets.top / cssH - (insets.top ? 0.04 : 0.1);
      // inclinación de la mirada: con la cámara subida por el usuario no se fuerza a mirar más abajo
      // (si no, el aro se sale por arriba cuando el poseedor está lejos)
      FR.minPitch = Math.max(0.1, 0.33 + Math.min(0, oPitch)); FR.maxPitch = Math.min(1.3, 1.05 + Math.max(0, oPitch));
      return n;
    }
    // Distancia hasta el límite del estadio saliendo del poseedor hacia "atrás" con el giro dado.
    function wallDist(yaw) {
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const bx = FR.bx * cy + FR.bz * sy, bz = -FR.bx * sy + FR.bz * cy;
      let d = 1e9;
      if (bx > 1e-6) d = Math.min(d, (CAM_LIM.x - FR.hx) / bx); else if (bx < -1e-6) d = Math.min(d, (-CAM_LIM.x - FR.hx) / bx);
      if (bz > 1e-6) d = Math.min(d, (CAM_LIM.z1 - FR.hz) / bz); else if (bz < -1e-6) d = Math.min(d, (CAM_LIM.z0 - FR.hz) / bz);
      return Math.max(0, d);
    }
    // Evalúa el encuadre con giro `yaw` a distancia D usando las primeras nS muestras: ubica la cámara,
    // la orienta para centrar el conjunto (el poseedor abajo, con margen) y dice si entra todo.
    function frameAt(yaw, D, nS, out, loose) {
      const S = FR.S, cy = Math.cos(yaw), sy = Math.sin(yaw);
      const bx = FR.bx * cy + FR.bz * sy, bz = -FR.bx * sy + FR.bz * cy;
      const px = Math.max(-CAM_LIM.x, Math.min(CAM_LIM.x, FR.hx + bx * D));
      const pz = Math.max(CAM_LIM.z0, Math.min(CAM_LIM.z1, FR.hz + bz * D));
      const py = Math.max(CAM_LIM.y0, Math.min(CAM_LIM.y1, Math.min(26 + D * FR.elev, (200 + D * 0.08) * (FR.elev / CAM_ELEV))));
      let cx = 0, cyy = 0, cz = 0;
      for (let i = 0; i < nS; i++) { cx += S[i * 3]; cyy += S[i * 3 + 1]; cz += S[i * 3 + 2]; }
      let fx = cx / nS - px, fy = cyy / nS - py, fz = cz / nS - pz;
      const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
      let lyaw = Math.atan2(fx, -fz), lpitch = Math.asin(Math.max(-1, Math.min(1, -fy)));
      const minP = loose ? 0.02 : FR.minPitch, maxP = loose ? 1.45 : FR.maxPitch;
      const xMid = (FR.xLo + FR.xHi) / 2, yMid = (FR.yLo + FR.yHi) / 2, yAvail = FR.yHi - FR.yLo;
      let x0 = 0, x1 = 0, y0 = 0, y1 = 0, behind = false;
      for (let k = 0; k < 7; k++) {
        const cp = Math.cos(lpitch), sp = Math.sin(lpitch), cw = Math.cos(lyaw), sw = Math.sin(lyaw);
        // base de la cámara: f (adelante), r (derecha), u (arriba)
        const f0 = sw * cp, f1 = -sp, f2 = -cw * cp, u0 = sw * sp, u1 = cp, u2 = -cw * sp;
        x0 = 1e9; x1 = -1e9; y0 = 1e9; y1 = -1e9; behind = false;
        for (let i = 0; i < nS; i++) {
          const dx = S[i * 3] - px, dy = S[i * 3 + 1] - py, dz = S[i * 3 + 2] - pz;
          const zc = dx * f0 + dy * f1 + dz * f2;
          if (zc < 6) { behind = true; continue; }
          const xn = (dx * cw + dz * sw) / (zc * FR.tanH), yn = (dx * u0 + dy * u1 + dz * u2) / (zc * FR.tanV);
          if (xn < x0) x0 = xn; if (xn > x1) x1 = xn; if (yn < y0) y0 = yn; if (yn > y1) y1 = yn;
        }
        if (k === 6 || x0 > x1) break;                     // la última pasada solo mide
        lyaw += Math.atan(((x0 + x1) / 2 - xMid) * FR.tanH);
        const hgt = y1 - y0;
        // el poseedor queda abajo con margen; si el conjunto es más alto que la zona útil, se centra
        const targetBottom = hgt <= yAvail ? FR.yLo : yMid - hgt / 2;
        lpitch = Math.max(minP, Math.min(maxP, lpitch + Math.atan((targetBottom - y0) * FR.tanV)));
      }
      const viol = (behind || x0 > x1 ? 10 : 0) + Math.max(0, FR.xLo - x0) + Math.max(0, x1 - FR.xHi) + Math.max(0, FR.yLo - y0) + Math.max(0, y1 - FR.yHi);
      out.px = px; out.py = py; out.pz = pz; out.lyaw = lyaw; out.lpitch = lpitch; out.D = D;
      out.viol = viol; out.ok = viol <= 0.012;
      return out.ok;
    }
    // Menor distancia (hasta dcap o la tribuna) con la que entran las obligatorias + n opcionales.
    // Devuelve si lo logró; en `out` queda el encuadre. `coarse` omite el ajuste fino (solo factibilidad).
    function solveSet(yaw, n, out, coarse) {
      const nS = FR.nReq + 2 * n;
      const dmax = Math.min(wallDist(yaw), n ? DCAP_ALL : DCAP_REQ);
      if (dmax < 70) { out.ok = false; out.viol = 99; return false; }
      const grow = coarse ? 1.22 : 1.1;
      let D = Math.min(FR.D0, dmax), prev = 0, found = false;
      for (let it = 0; it < 40; it++) {
        if (frameAt(yaw, D, nS, fTmp, false)) { found = true; break; }
        if (D >= dmax - 1e-6) break;
        prev = D; D = Math.min(dmax, D * grow);
      }
      if (!found) { out.ok = false; out.viol = fTmp.viol; return false; }
      copyFrame(fTmp, out);
      if (!coarse && prev > 0) {                           // afina entre la última que no alcanzaba y la que alcanza
        let lo = prev, hi = D;
        for (let k = 0; k < 4; k++) { const mid = (lo + hi) / 2; if (frameAt(yaw, mid, nS, fTmp, false)) { hi = mid; copyFrame(fTmp, out); } else lo = mid; }
      }
      return true;
    }
    // Intervalo [a, b] de giros (respecto del eje poseedor→aro) que encuadran al conjunto obligatorio
    // sin salir del estadio, y giro de reposo c (el más cercano a 0 que además muestra a todos, si
    // existe). Se guarda en caché: no depende del giro pedido, solo del poseedor, la inclinación, el
    // tamaño y las franjas.
    const YAW_MID = (YAW_N - 1) / 2;
    function yawAt(i) { return (i - YAW_MID) * YAW_STEP; }
    // Afina el borde del intervalo entre un giro que encuadra y el vecino que no.
    function edgeYaw(good, bad) {
      for (let k = 0; k < 3; k++) { const m = (good + bad) / 2; if (solveSet(m, 0, fAux, true)) good = m; else bad = m; }
      return good;
    }
    function yawInterval(nOpt) {
      let same = IV.valid;
      for (let i = 0; i < ivKey.length; i++) { if (Math.abs(ivKey[i] - ivKeyPrev[i]) > 1e-7) same = false; ivKeyPrev[i] = ivKey[i]; }
      if (same) return IV;
      IV.valid = true; IV.none = false;
      const mid = YAW_MID;
      let any = false;
      feas.fill(0);
      for (let i = mid - YAW_HALF; i <= mid + YAW_HALF; i++) if (solveSet(yawAt(i), 0, fAux, true)) { feas[i] = 1; any = true; }
      if (!any) for (let i = 0; i < YAW_N; i++) if ((i < mid - YAW_HALF || i > mid + YAW_HALF) && solveSet(yawAt(i), 0, fAux, true)) { feas[i] = 1; any = true; }
      if (!any) { IV.none = true; IV.a = IV.b = IV.c = 0; return IV; }
      let anchor = -1;
      for (let k = 0; k <= mid && anchor < 0; k++) { if (feas[mid + k]) anchor = mid + k; else if (feas[mid - k]) anchor = mid - k; }
      let ia = anchor, ib = anchor;
      while (ia > 0 && feas[ia - 1]) ia--;
      while (ib < YAW_N - 1 && feas[ib + 1]) ib++;
      // bordes: se afinan contra el vecino que no encuadra (dentro del rango que se evaluó)
      const inRange = Math.abs(anchor - mid) <= YAW_HALF;
      const lo = inRange ? mid - YAW_HALF : 0, hi = inRange ? mid + YAW_HALF : YAW_N - 1;
      IV.a = ia > lo ? edgeYaw(yawAt(ia), yawAt(ia - 1)) : yawAt(ia);
      IV.b = ib < hi ? edgeYaw(yawAt(ib), yawAt(ib + 1)) : yawAt(ib);
      let c = Math.max(IV.a, Math.min(IV.b, 0));
      if (nOpt && !solveSet(c, nOpt, fAux, true)) {         // giro de reposo: el más cercano que muestra a todos
        let best = -1, bd = 1e9;
        for (let i = ia; i <= ib; i++) { const d = Math.abs(yawAt(i) - c); if (d < bd && solveSet(yawAt(i), nOpt, fAux, true)) { bd = d; best = i; } }
        if (best >= 0) c = yawAt(best);
      }
      IV.c = c;
      return IV;
    }
    // Giro pedido (−90°..+90°) → giro efectivo dentro de [a, b]: 1:1 cerca del reposo y comprimido al
    // acercarse al límite (se siente como una resistencia, sin zona muerta).
    function mapYaw(req, iv) {
      const full = ORBIT.yawMax, t = Math.abs(req), avail = req >= 0 ? iv.b - iv.c : iv.c - iv.a;
      let g;
      if (avail >= full) g = t * (avail / full);
      else { const k = 0.6 * avail; g = t <= k ? t : k + (t - k) * (avail - k) / (full - k); }
      return iv.c + (req >= 0 ? g : -g);
    }
    function frameToGoal(f, goal) {
      const cp = Math.cos(f.lpitch);
      goal.pos.set(f.px, f.py, f.pz);
      goal.look.set(f.px + Math.sin(f.lyaw) * cp * 200, f.py - Math.sin(f.lpitch) * 200, f.pz - Math.cos(f.lyaw) * cp * 200);
      goal.D = f.D;
      return goal;
    }
    function solveFraming(holder, points, opt, goal) {
      opt = opt || {};
      goal = goal || { pos: new T.Vector3(), look: new T.Vector3(), D: 0 };
      const oYaw = opt.yaw != null ? opt.yaw : orbit.yaw, oPitch = opt.pitch != null ? opt.pitch : orbit.pitch;
      const N = setupFraming(holder, points, oPitch, opt.D0);
      framing.total = N; framing.ok = true;
      // caso habitual: sin giro y entra todo
      if (oYaw === 0 && solveSet(0, N, fRes, false)) { framing.effYaw = 0; framing.shown = N; return frameToGoal(fRes, goal); }
      // clave de la caché del intervalo (numérica: sin cadenas por fotograma)
      let sum = 0;
      for (let i = 0; i < N; i++) sum += OPT[i].x * 1.37 + OPT[i].y * 0.71 + i;
      const K = ivKey;
      K[0] = holder.x; K[1] = holder.y; K[2] = holder.h == null ? -1 : holder.h; K[3] = oPitch; K[4] = cssW; K[5] = cssH;
      K[6] = insets.top; K[7] = insets.bottom; K[8] = insets.left; K[9] = insets.right; K[10] = N; K[11] = sum; K[12] = FR.D0;
      const iv = yawInterval(N);
      let eff = iv.none ? 0 : mapYaw(oYaw, iv);
      let got = !iv.none && solveSet(eff, N, fRes, false), shown = N;
      if (!got) {
        // obligatorios con el giro efectivo; si justo no entra (borde del intervalo), se acerca al reposo
        let base = !iv.none && solveSet(eff, 0, fSet, false);
        for (let k = 1; !base && !iv.none && k <= 8; k++) { eff += (iv.c - eff) * (k / 8); base = solveSet(eff, 0, fSet, false); }
        if (base) {
          // el prefijo más largo de opcionales (por cercanía) que todavía entra
          copyFrame(fSet, fRes); shown = 0;
          let lo = 0, hi = N;
          while (hi - lo > 1) { const m = (lo + hi) >> 1; if (solveSet(eff, m, fSet, false)) { lo = m; copyFrame(fSet, fRes); shown = m; } else hi = m; }
          got = true;
        }
      }
      if (!got) {
        // último recurso (posiciones anómalas): el intento con menos desborde entre varios giros y
        // distancias, con la inclinación liberada
        let bestScore = 1e9; shown = 0;
        for (let i = 0; i < YAW_N; i++) {
          const y = yawAt(i), dmax = Math.min(wallDist(y), DCAP_REQ);
          for (let D = 90; D <= dmax + 1e-6; D *= 1.3) {
            frameAt(y, D, FR.nReq, fTmp, true);
            // primero que entre; entre los que entran, el giro más parecido al pedido
            const score = fTmp.viol > 0.012 ? 100 + fTmp.viol : Math.abs(y - oYaw);
            if (score < bestScore) { bestScore = score; copyFrame(fTmp, fBest); eff = y; }
          }
        }
        if (bestScore >= 1e9) frameAt(0, Math.max(60, wallDist(0)), FR.nReq, fBest, true);   // sin lugar en ningún giro
        copyFrame(fBest, fRes);
        framing.ok = fRes.viol <= 0.012;
      }
      framing.effYaw = eff; framing.shown = shown;
      return frameToGoal(fRes, goal);
    }
    const goalObj = { pos: new T.Vector3(), look: new T.Vector3(), D: 0 };   // objetivo de la cámara (reutilizado)
    const followOpt = { D0: 150 };
    const DEFAULT_TARGET = { x: 180, y: 400 };
    // setCamera({ mode, holder, target, points, instant })
    //   mode 'holder'    : detrás del poseedor (holder {x,y}), encuadrando points
    //   mode 'follow'    : sigue la pelota (target {x,y,h}) durante un movimiento
    //   mode 'cinematic' : plano general lento de la portada
    //   mode 'score'     : festejo tras una canasta: acercamiento con órbita corta hacia el aro, con la
    //                      tribuna del fondo detrás (la hinchada festejando). Opcional: holder/target
    //                      {x,y} = desde dónde se convirtió (define de qué lado entra la cámara) y
    //                      cheer: false para no disparar el festejo de la hinchada.
    function setCamera(o) {
      o = o || {};
      const now = cam.now || 0, prevMode = cam.mode;
      cam.mode = o.mode || cam.mode;
      if (o.points) cam.points = o.points;
      if (o.holder) cam.holder = o.holder;
      if (o.target) cam.target = o.target;
      let goal = null;
      if (cam.mode === 'holder' && cam.holder) {
        goal = solveFraming(cam.holder, cam.points, null, goalObj);
        cam.lastD = goal.D;
      } else if (cam.mode === 'follow') {
        followOpt.D0 = cam.lastD * 0.9;
        goal = solveFraming(cam.target || cam.holder || DEFAULT_TARGET, cam.points, followOpt, goalObj);
      } else if (cam.mode === 'cinematic') {
        goal = cinematicPose(cam.cineT, goalObj);
      } else if (cam.mode === 'score') {
        if (prevMode !== 'score' || o.restart) {
          cam.scoreT = 0;
          // lado de entrada: el de quien convirtió si se conoce; si no, el lado en que ya está la cámara
          const from = o.holder || o.target;
          const sx = from ? from.x - HOOP.x : cam.pos.x;
          cam.scoreSide = Math.abs(sx) < 12 ? (cam.pos.x >= 0 ? 1 : -1) : (sx > 0 ? 1 : -1);
          cam.scoreA0 = Math.max(-0.5, Math.min(0.5, Math.atan2(cam.pos.x, cam.pos.z + 230) * 0.6));
          if (o.cheer !== false && clock - cheerAt > 1) cheer();
        }
        goal = scorePose(o.instant ? 2.2 : cam.scoreT, goalObj);
        if (o.instant) cam.scoreT = 2.2;
      }
      if (!goal) return;
      cam.goal = goal; cam.dirty = false;
      if (o.instant) {
        cam.pos.copy(goal.pos); cam.look.copy(goal.look);
        applyCamera();
      } else if (cam.mode === 'holder') {
        if (!cam.from) cam.from = { pos: new T.Vector3(), look: new T.Vector3() };
        cam.from.pos.copy(cam.pos); cam.from.look.copy(cam.look); cam.moving = true;
        cam.to = goal; cam.t0 = now; cam.dur = 0.6;
      }
      if (cam.mode !== 'holder' || o.instant) cam.moving = false;
    }
    // Órbita del usuario: yaw y pitch en radianes (se acotan); instant salta sin animar.
    function setOrbit(o) {
      o = o || {};
      if (o.yaw != null) orbit.goalYaw = Math.max(-ORBIT.yawMax, Math.min(ORBIT.yawMax, o.yaw));
      if (o.pitch != null) orbit.goalPitch = Math.max(ORBIT.pitchMin, Math.min(ORBIT.pitchMax, o.pitch));
      if (o.instant) {
        orbit.yaw = orbit.goalYaw; orbit.pitch = orbit.goalPitch;
        if (cam.mode === 'holder' && cam.holder) {
          cam.goal = solveFraming(cam.holder, cam.points, null, goalObj); cam.lastD = cam.goal.D;
          cam.pos.copy(cam.goal.pos); cam.look.copy(cam.goal.look); cam.moving = false;
          applyCamera();
        }
      }
      orbit.settled = false;
      cam.dirty = true;
    }
    // yaw/pitch: giro pedido por el usuario. effYaw: giro que realmente aplica el encuadre (se comprime
    // cuando el pedido no deja ver al poseedor y al aro); shown/total: puntos opcionales encuadrados.
    const orbitInfo = { yaw: 0, pitch: 0, goalYaw: 0, goalPitch: 0, settled: true, yawMax: ORBIT.yawMax, pitchMin: ORBIT.pitchMin, pitchMax: ORBIT.pitchMax, effYaw: 0, shown: 0, total: 0, framed: true };
    function getOrbit() {
      const o = orbitInfo;
      o.yaw = orbit.yaw; o.pitch = orbit.pitch; o.goalYaw = orbit.goalYaw; o.goalPitch = orbit.goalPitch; o.settled = orbit.settled;
      o.effYaw = framing.effYaw; o.shown = framing.shown; o.total = framing.total; o.framed = framing.ok;
      return o;
    }
    const resetOrbit = () => setOrbit({ yaw: 0, pitch: 0 });
    // Acerca yaw/pitch a su objetivo con amortiguación exponencial; devuelve si cambió este fotograma.
    function stepOrbit(dt) {
      const dy = orbit.goalYaw - orbit.yaw, dp = orbit.goalPitch - orbit.pitch;
      if (Math.abs(dy) < 1e-9 && Math.abs(dp) < 1e-9) return false;
      const k = 1 - Math.exp(-dt * ORBIT.damp);
      orbit.yaw += dy * k; orbit.pitch += dp * k;
      if (Math.abs(orbit.goalYaw - orbit.yaw) < 2e-4 && Math.abs(orbit.goalPitch - orbit.pitch) < 2e-4) { orbit.yaw = orbit.goalYaw; orbit.pitch = orbit.goalPitch; }
      return true;
    }
    // Portada: plano general desde la media cancha lejana, con vaivén lento; deja ver el cubo marcador.
    function cinematicPose(t, goal) {
      const a = Math.sin(t * 0.22) * 0.5;
      const R = 560;
      goal.pos.set(Math.sin(a) * R * 0.8, 150 + Math.sin(t * 0.13) * 22, 40 + Math.cos(a) * R);
      goal.look.set(0, 58, -200);
      return goal;
    }
    // Festejo: la cámara baja hacia el aro por el lado de quien convirtió, se acerca y gira despacio;
    // mira un poco por encima del aro para que la tribuna del fondo llene el cuadro.
    function scorePose(t, goal) {
      const e = 1 - Math.exp(-t / 0.9);
      const a = cam.scoreA0 * 0.7 + cam.scoreSide * (0.1 + 0.15 * e + 0.018 * t);
      const R = 250 - 66 * e - 3 * t;
      // con franjas de interfaz, el aro sube al centro de la zona libre
      const lift = (insets.bottom - insets.top) / Math.max(1, cssH) * 46;
      goal.pos.set(Math.sin(a) * R, 104 - 14 * e, -230 + Math.cos(a) * R);
      goal.look.set(-Math.sin(a) * 5, 82 - lift, -252);
      clampPos(goal.pos);
      return goal;
    }
    function applyCamera() {
      camera.position.copy(cam.pos); camera.lookAt(cam.look); camera.updateMatrixWorld();
    }
    function updateCamera(now, dt) {
      cam.now = now;
      const turning = stepOrbit(dt);
      if (cam.mode === 'holder') {
        if (cam.holder && (turning || cam.dirty)) {
          cam.goal = solveFraming(cam.holder, cam.points, null, goalObj); cam.lastD = cam.goal.D; cam.dirty = false;
        }
        if (cam.moving && cam.goal) {
          let k = Math.min(1, (now - cam.t0) / cam.dur);
          k = 1 - Math.pow(1 - k, 3);
          cam.pos.lerpVectors(cam.from.pos, cam.goal.pos, k);
          cam.look.lerpVectors(cam.from.look, cam.goal.look, k);
          if (k >= 1) cam.moving = false;
        } else if (cam.goal) {
          // sin transición programada: la cámara persigue el encuadre con amortiguación exponencial
          const k = 1 - Math.exp(-dt * 10);
          cam.pos.lerp(cam.goal.pos, k); cam.look.lerp(cam.goal.look, k);
          if (cam.pos.distanceToSquared(cam.goal.pos) < 0.01 && cam.look.distanceToSquared(cam.goal.look) < 0.01) { cam.pos.copy(cam.goal.pos); cam.look.copy(cam.goal.look); }
        }
        orbit.settled = !turning && !cam.moving && (!cam.goal || cam.pos.equals(cam.goal.pos));
      } else {
        let rate = 5;
        if (cam.mode === 'cinematic') { cam.cineT += dt; cam.goal = cinematicPose(cam.cineT, goalObj); rate = 2.5; }
        else if (cam.mode === 'score') { cam.scoreT += dt; cam.goal = scorePose(cam.scoreT, goalObj); rate = 3.6; }
        else if (cam.target) { followOpt.D0 = cam.lastD * 0.9; cam.goal = solveFraming(cam.target, cam.points, followOpt, goalObj); }
        if (cam.goal) {
          const k = 1 - Math.exp(-dt * rate);
          cam.pos.lerp(cam.goal.pos, k); cam.look.lerp(cam.goal.look, k);
        }
        orbit.settled = !turning;
      }
      applyCamera();
      cullFarCrowd();
    }

    // ---------------------------------------------------------------- Conversión pantalla ↔ cancha
    const raycaster = new T.Raycaster();
    const floorPlane = new T.Plane(new T.Vector3(0, 1, 0), 0);
    const _ndc = new T.Vector2(), _hit = new T.Vector3(), _p = new T.Vector3();
    function screenToCourt(px, py) {
      _ndc.set((px / cssW) * 2 - 1, -(py / cssH) * 2 + 1);
      raycaster.setFromCamera(_ndc, camera);
      const hit = raycaster.ray.intersectPlane(floorPlane, _hit);
      return hit ? worldToCourt(hit) : null;
    }
    function courtToScreen(x, y, h) {
      courtToWorld(x, y, h || 0, _p);
      const depth = -_v.copy(_p).applyMatrix4(camera.matrixWorldInverse).z;
      _p.project(camera);
      return { x: (_p.x + 1) / 2 * cssW, y: (1 - _p.y) / 2 * cssH, depth };
    }

    // ---------------------------------------------------------------- Calidad, tamaño, bucle
    let quality = 'alta', crowdFrac = 1;
    // Recorta el público lejano que queda detrás de la cámara (solo si mira hacia el aro).
    function cullFarCrowd() {
      const fwd = camera.getWorldDirection(_v);
      let n = SEAT_SETS[1].length;
      if (fwd.z < -0.6) {
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
      cam.dirty = true;
    }
    let lastMs = 0, lastNow = 0, lastInfo = { calls: 0, triangles: 0 };
    function render() {
      const t0 = performance.now();
      renderer.render(scene, camera);
      lastMs = performance.now() - t0;
      lastInfo = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    }
    function update(now, dt) {
      now = now / 1000;                              // now en ms (performance.now); dt en segundos
      if (dt == null) dt = 1 / 60; if (dt > 0.5) dt = dt / 1000; dt = Math.min(dt, 0.1);
      clock = now;
      const sinceCheer = now - cheerAt;
      crowdUniforms.uTime.value = now;
      crowdUniforms.uCheer.value = sinceCheer;
      // carteles LED: se desplazan despacio (el reflejo en el piso usa el mismo corrimiento)
      ledTex.offset.x = (now * 0.011) % 1;
      floorU.uLedOff.value = ledTex.offset.x;
      // papelitos: solo durante el festejo
      const party = sinceCheer >= 0 && sinceCheer < CONFETTI_T && quality !== 'baja';
      confetti.visible = party;
      if (party) confettiU.uT.value = sinceCheer;
      for (const h of hoops) animateNet(h, dt);
      // La cámara se amortigua con el tiempo real entre fotogramas (hasta 0,5 s): si el equipo rinde poco
      // y el juego recorta dt, el giro y el encuadre igual llegan a destino a tiempo, no en cámara lenta.
      const camDt = lastNow > 0 ? Math.min(0.5, Math.max(dt, now - lastNow)) : dt;
      lastNow = now;
      updateCamera(now, camDt);
      // el cubo marcador baja en la portada para entrar en el plano general
      cube.position.y = cam.mode === 'cinematic' ? CUBE_Y.low : CUBE_Y.high;
      beams.visible = quality !== 'baja' && (cam.mode === 'cinematic' || cam.mode === 'score');
    }
    // setTeams([[colorLocal, vivosLocal], [colorVisita, vivosVisita]]): tiñe al público, los banderines,
    // la zona pintada y el círculo central de la cancha, el piso perimetral, el cubo marcador y los
    // papelitos del festejo. Repetir la llamada con los mismos colores no repinta nada.
    let teamsKey = '';
    function setTeams(t) {
      if (t && t[0]) teams[0] = t[0];
      if (t && t[1]) teams[1] = t[1];
      const key = teams[0].join('|') + '/' + teams[1].join('|');
      if (key === teamsKey) return;
      teamsKey = key;
      colorCrowd(); buildPennants(); repaintCourts(); repaintScoreboard(); colorConfetti(); tintArena();
    }
    // Piso perimetral y marco del túnel con el color del local; el reflejo de la tribuna en el parqué
    // toma el tono medio de la hinchada.
    const _c1 = new T.Color(), _c2 = new T.Color();
    function tintArena() {
      _c1.set(teams[0][0]); _c2.set(0x141c30);
      apronMat.color.copy(_c2).lerp(_c1, 0.22);
      trimMat.color.copy(_c1).lerp(_c2.set(0xffffff), 0.12);
      tunnelFrameMat.color.copy(_c1);
      floorU.uCrowdCol.value.copy(_c1).lerp(_c2.set(0x8d93a6), 0.6).multiplyScalar(0.55);
    }
    tintArena();
    function dispose() {
      overlay.clear();
      for (const d of disposables) if (d && d.dispose) d.dispose();
      if (pennants) pennants.geometry.dispose();
      pennantMat.dispose();
      confetti.dispose();
      renderer.dispose();
    }

    const api = {
      renderer, scene, camera, ball, overlay,
      hoop: { swish(t) { hoopNear.swish = t; }, group: hoopNear.group },
      resize, setCamera, setOrbit, getOrbit, resetOrbit, setInsets, update, render, setQuality, setTeams, cheer, dispose,
      add: (o) => dyn.add(o), remove: (o) => dyn.remove(o),
      courtToWorld: (x, y, h) => courtToWorld(x, y, h),
      worldToCourt, screenToCourt, courtToScreen,
      info: () => ({ drawCalls: lastInfo.calls, triangles: lastInfo.triangles, ms: lastMs, crowd: crowds[0].count + crowds[1].count, quality, mode: cam.mode, sinceCheer: clock - cheerAt }),
      solveFraming,
    };
    return api;
  }

  root.Scene3D = { create, courtToWorld, worldToCourt, COURT, HOOP, HOOP_H, RIM_R, BOARD_W, BOARD_H };
})(typeof window !== 'undefined' ? window : this);
