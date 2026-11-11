/* audio.js — sonido sintetizado de "Jugada Maestra" → window.Sfx
 *
 * Todo se genera con Web Audio (osciladores, ruido filtrado, envolventes y una reverberación por
 * convolución con una respuesta de pabellón generada por código). No usa archivos externos.
 *
 * API
 *   Sfx.init()                       llamar dentro de un gesto del usuario (pointerdown / touchend / click).
 *                                    Crea o reanuda el AudioContext. Es idempotente y barata: se puede
 *                                    llamar en CADA pointerdown (recomendado en iOS, donde el contexto se
 *                                    vuelve a suspender al cambiar de pestaña o al recibir una llamada).
 *   Sfx.setEnabled(bool) / Sfx.isEnabled()      silencia todo (el público y la carga se restablecen solos)
 *   Sfx.setVolume(0..1) / Sfx.getVolume()
 *   Sfx.play(nombre, opts) → bool    nombres en Sfx.names. opts comunes: { vol: 0..1, retraso: segundos }
 *                                    'bounce', 'rim', 'board', 'catch', 'block': { fuerza: 0..1 }
 *                                    'star': { n: 1..3 }   'whistle': { largo: bool, n: cantidad de pitidos }
 *   Sfx.charge.start() / .set(0..100, enZona) / .stop()      tono continuo del medidor de fuerza
 *   Sfx.crowd.start() / .stop() / .setIntensity(0..1) / .cheer() / .groan()
 *   Sfx.haptic(patron)               'tap' | 'ok' | 'fail' (o un número / arreglo de milisegundos)
 *   Sfx.setHapticEnabled(bool)       la vibración tiene su propio interruptor (por defecto, encendida)
 *   Sfx.renderOffline(nombre, opts) → Promise<Float32Array>   mono, 44100 Hz. Acepta los nombres de
 *                                    Sfx.names y además 'cheer', 'groan', 'crowd' y 'charge'.
 *                                    opts.crudo = true omite el compresor y el limitador (para medir niveles).
 *   Sfx.duration(nombre, opts) → segundos (incluye la cola de reverberación)
 *   Sfx.names, Sfx.extras, Sfx.sampleRate (44100, la de renderOffline), Sfx.estado()
 *
 * Garantías: ninguna llamada lanza excepciones. Si no hay Web Audio, si el contexto sigue suspendido o si
 * el sonido está desactivado, todo queda en silencio. La salida pasa por un compresor y un limitador suave
 * (pico máximo 0,9).
 */
(function (global) {
  'use strict';

  var AC = global.AudioContext || global.webkitAudioContext || null;
  var OAC = global.OfflineAudioContext || global.webkitOfflineAudioContext || null;
  var SR_PRUEBA = 44100;
  var PREVIO = 0.5;          // silencio previo de renderOffline (se descarta), en segundos

  var NOMBRES = ['tap', 'drag', 'pass', 'catch', 'bounce', 'shot', 'swish', 'rim', 'board', 'steal', 'block',
    'whistle', 'buzzer', 'star', 'coin', 'win', 'lose', 'error', 'lock'];
  var EXTRAS = ['cheer', 'groan', 'crowd', 'charge'];

  // Duración total de cada sonido, en segundos, con la cola de reverberación incluida.
  var DUR = {
    tap: 0.16, drag: 0.24, pass: 0.7, catch: 0.6, bounce: 1.4, shot: 0.6, swish: 0.9, rim: 1.5, board: 1.2,
    steal: 0.8, block: 1.0, whistle: 1.5, buzzer: 2.2, star: 1.1, coin: 0.7, win: 2.4, lose: 1.9, error: 0.45,
    lock: 0.3, cheer: 3.6, groan: 2.2, crowd: 4, charge: 2
  };
  // Separación mínima entre dos disparos del mismo sonido (ms): evita ametrallar al arrastrar.
  var PAUSA = { drag: 70, tap: 30, bounce: 45, lock: 120, error: 120 };
  var MAX_VOCES = 22;

  // ---------------------------------------------------------------- utilidades

  function limitar(v, a, b) { v = +v; if (!(v === v)) v = a; return v < a ? a : (v > b ? b : v); }

  function azar(semilla) {            // mulberry32: generador determinista
    var s = semilla >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var x = s;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  function bufferRuido(ctx, seg, rnd) {
    var n = Math.floor(ctx.sampleRate * seg), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = rnd() * 2 - 1;
    return buf;
  }

  // Respuesta al impulso de un pabellón: reflexiones tempranas marcadas (el "eco" de la pared del fondo)
  // y una cola difusa que se oscurece con el tiempo.
  function respuestaPabellon(ctx, rnd) {
    var sr = ctx.sampleRate, n = Math.floor(sr * 1.5), buf = ctx.createBuffer(2, n, sr);
    var ecos = [0.019, 0.037, 0.058, 0.089, 0.131, 0.177, 0.236];
    var amps = [0.75, -0.6, 0.55, -0.45, 0.5, -0.36, 0.25];
    for (var c = 0; c < 2; c++) {
      var d = buf.getChannelData(c), lp = 0, i;
      for (i = 0; i < n; i++) {
        var t = i / sr;
        var a = 0.6 - 0.45 * (t / 1.5);
        lp += a * ((rnd() * 2 - 1) - lp);
        var sube = t < 0.03 ? t / 0.03 : 1;
        var baja = t > 1.3 ? (1.5 - t) / 0.2 : 1;
        d[i] = lp * Math.exp(-t / 0.21) * sube * baja * 0.9;
      }
      for (var e = 0; e < ecos.length; e++) {
        var idx = Math.floor((ecos[e] + c * 0.0027 * (e + 1)) * sr);
        if (idx + 3 < n) { d[idx] += amps[e]; d[idx + 1] += amps[e] * 0.6; d[idx + 2] += amps[e] * 0.25; }
      }
    }
    return buf;
  }

  // Aplausos sueltos: ráfagas muy cortas de ruido coloreado repartidas al azar, más densas al principio.
  function bufferPalmas(ctx, rnd) {
    var sr = ctx.sampleRate, n = Math.floor(sr * 3.0), buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
    for (var p = 0; p < 170; p++) {
      var u = rnd();
      var t0 = 0.12 + Math.pow(u, 1.25) * 2.6;
      var amp = (0.35 + 0.65 * rnd()) * (1 - 0.75 * u);
      var tau = (0.0025 + 0.004 * rnd()) * sr;
      var color = 0.25 + 0.5 * rnd();
      var ini = Math.floor(t0 * sr), largo = Math.floor(tau * 6), ant = 0;
      for (var i = 0; i < largo && ini + i < n; i++) {
        var w = rnd() * 2 - 1;
        var y = w - color * ant; ant = w;
        d[ini + i] += y * amp * Math.exp(-i / tau) * (i < 6 ? i / 6 : 1);
      }
    }
    return buf;
  }

  function curvaLimite() {            // lineal hasta 0,6 y después se aplana hacia 0,9 sin esquinas
    var n = 2049, c = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var x = (i / (n - 1)) * 2 - 1, ax = Math.abs(x);
      var y = ax <= 0.6 ? ax : 0.6 + 0.38 * Math.tanh((ax - 0.6) / 0.38);
      c[i] = x < 0 ? -y : y;
    }
    return c;
  }

  // Un "kit" por contexto: ruido compartido, buses, reverberación y cadena de salida.
  function crearKit(ctx, crudo, vivo) {
    var k = { ctx: ctx, vivo: !!vivo, rnd: azar(20240611), voces: 0 };
    k.ruido = bufferRuido(ctx, 3, k.rnd);
    k.entrada = ctx.createGain();
    k.envio = ctx.createGain();
    k.master = ctx.createGain();
    k.rev = ctx.createConvolver();
    k.rev.buffer = respuestaPabellon(ctx, k.rnd);
    k.revGan = ctx.createGain();
    k.revGan.gain.value = 1.6;
    k.envio.connect(k.rev);
    k.rev.connect(k.revGan);
    if (crudo) {
      k.entrada.connect(k.master);
      k.revGan.connect(k.master);
    } else {
      k.comp = ctx.createDynamicsCompressor();
      k.comp.threshold.value = -14; k.comp.knee.value = 10; k.comp.ratio.value = 6;
      k.comp.attack.value = 0.004; k.comp.release.value = 0.18;
      k.post = ctx.createGain();
      k.post.gain.value = 0.62;       // compensa la ganancia automática del compresor
      k.limite = ctx.createWaveShaper();
      k.limite.curve = curvaLimite();
      k.entrada.connect(k.comp);
      k.revGan.connect(k.comp);
      k.comp.connect(k.post);
      k.post.connect(k.limite);
      k.limite.connect(k.master);
    }
    k.master.connect(ctx.destination);
    return k;
  }

  function palmasDe(k) { return k.palmas || (k.palmas = bufferPalmas(k.ctx, k.rnd)); }

  // Canal de una voz: ganancia propia hacia la mezcla seca y, si se pide, envío a la reverberación.
  function voz(k, t, dur, gan, envio) {
    var g = k.ctx.createGain(), s = null;
    g.gain.value = gan;
    g.connect(k.entrada);
    if (envio > 0) { s = k.ctx.createGain(); s.gain.value = envio; g.connect(s); s.connect(k.envio); }
    if (k.vivo) {
      k.voces++;
      var ms = Math.max(0, (t - k.ctx.currentTime + dur) * 1000) + 250;
      setTimeout(function () {
        k.voces--;
        try { g.disconnect(); if (s) s.disconnect(); } catch (e) { /* ya desconectado */ }
      }, ms);
    }
    return g;
  }

  function tono(k, dst, tipo, f, t, dur) {
    var o = k.ctx.createOscillator(), g = k.ctx.createGain();
    o.type = tipo;
    o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0, t);
    o.connect(g); g.connect(dst);
    o.start(t); o.stop(t + dur + 0.03);
    return { o: o, g: g, f: o.frequency, a: g.gain };
  }

  function soplo(k, dst, t, dur, tipo, f, q) {
    var s = k.ctx.createBufferSource(), fil = k.ctx.createBiquadFilter(), g = k.ctx.createGain();
    s.buffer = k.ruido; s.loop = true;
    fil.type = tipo; fil.frequency.setValueAtTime(f, t); fil.Q.value = q == null ? 0.7 : q;
    g.gain.setValueAtTime(0, t);
    s.connect(fil); fil.connect(g); g.connect(dst);
    s.start(t, k.rnd() * 2.5); s.stop(t + dur + 0.03);
    return { s: s, fil: fil, g: g, f: fil.frequency, a: g.gain };
  }

  // Envolvente percusiva: ataque lineal, caída exponencial hasta -40 dB y cierre lineal a cero.
  // Dura exactamente ataque + caida.
  function golpe(p, t, pico, ataque, caida) {
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(pico, t + ataque);
    p.exponentialRampToValueAtTime(pico * 0.01, t + ataque + caida * 0.85);
    p.linearRampToValueAtTime(0, t + ataque + caida);
  }

  // Envolvente por tramos lineales: pts = [dt0, v0, dt1, v1, ...] con tiempos desde t.
  function tramos(p, t, pts) {
    p.setValueAtTime(pts[1], t + pts[0]);
    for (var i = 2; i < pts.length; i += 2) p.linearRampToValueAtTime(pts[i + 1], t + pts[i]);
  }

  function volDe(o) { return o && o.vol != null ? limitar(o.vol, 0, 1) : 1; }
  function fuerzaDe(o, def) { return o && o.fuerza != null ? limitar(o.fuerza, 0, 1) : def; }

  // ---------------------------------------------------------------- sonidos

  var FAB = {};

  // Toque de interfaz: gota corta y seca.
  FAB.tap = function (k, t, o) {
    var v = voz(k, t, DUR.tap, 0.55 * volDe(o), 0.04);
    var a = tono(k, v, 'sine', 1180, t, 0.1);
    a.f.exponentialRampToValueAtTime(700, t + 0.055);
    golpe(a.a, t, 0.5, 0.002, 0.1);
    var n = soplo(k, v, t, 0.03, 'highpass', 3200, 0.7);
    golpe(n.a, t, 0.2, 0.0005, 0.012);
  };

  // Empezar a trazar con el dedo: roce breve.
  FAB.drag = function (k, t, o) {
    var v = voz(k, t, DUR.drag, 0.95 * volDe(o), 0.05);
    var n = soplo(k, v, t, 0.18, 'bandpass', 800, 1.4);
    n.f.exponentialRampToValueAtTime(1900, t + 0.13);
    tramos(n.a, t, [0, 0, 0.035, 0.6, 0.16, 0]);
    var a = tono(k, v, 'sine', 420, t, 0.12);
    a.f.exponentialRampToValueAtTime(640, t + 0.1);
    golpe(a.a, t, 0.1, 0.01, 0.09);
  };

  // Pase: empujón de manos y silbido del aire.
  FAB.pass = function (k, t, o) {
    var v = voz(k, t, DUR.pass, 0.7 * volDe(o), 0.22);
    var n = soplo(k, v, t, 0.34, 'bandpass', 520, 1.6);
    n.f.exponentialRampToValueAtTime(2300, t + 0.12);
    n.f.exponentialRampToValueAtTime(950, t + 0.32);
    tramos(n.a, t, [0, 0, 0.05, 0.75, 0.14, 0.45, 0.33, 0]);
    var p = tono(k, v, 'sine', 190, t, 0.1);
    p.f.exponentialRampToValueAtTime(95, t + 0.06);
    golpe(p.a, t, 0.5, 0.002, 0.07);
    var c = soplo(k, v, t, 0.04, 'lowpass', 2600, 0.7);
    golpe(c.a, t, 0.3, 0.0005, 0.018);
  };

  // Recepción: palmada sobre el cuero.
  FAB.catch = function (k, t, o) {
    var f = fuerzaDe(o, 0.8);
    var v = voz(k, t, DUR.catch, (0.25 + 0.42 * f) * volDe(o), 0.22);
    var n = soplo(k, v, t, 0.08, 'lowpass', 2800, 0.7);
    golpe(n.a, t, 0.8, 0.0006, 0.04);
    var b = soplo(k, v, t, 0.14, 'bandpass', 880, 2.2);
    golpe(b.a, t, 0.7, 0.001, 0.085);
    var p = tono(k, v, 'sine', 165, t, 0.14);
    p.f.exponentialRampToValueAtTime(82, t + 0.08);
    golpe(p.a, t, 0.6, 0.002, 0.1);
  };

  // Pique sobre parqué: golpe grave y seco, "pang" de la goma y eco del pabellón.
  FAB.bounce = function (k, t, o) {
    var f = fuerzaDe(o, 0.8);
    var v = voz(k, t, DUR.bounce, (0.14 + 0.52 * f) * volDe(o), 0.5);
    var g = tono(k, v, 'sine', 150, t, 0.24);
    g.f.exponentialRampToValueAtTime(54, t + 0.085);
    golpe(g.a, t, 1.0, 0.002, 0.17);
    var c = tono(k, v, 'sine', 74, t, 0.3);
    golpe(c.a, t, 0.45, 0.004, 0.22);
    var r = tono(k, v, 'triangle', 330, t, 0.12);
    r.f.exponentialRampToValueAtTime(262, t + 0.07);
    golpe(r.a, t, 0.2, 0.001, 0.075);
    var s = soplo(k, v, t, 0.06, 'bandpass', 1900, 0.8);
    golpe(s.a, t, 0.5, 0.0005, 0.024);
    var m = soplo(k, v, t, 0.1, 'lowpass', 420, 0.7);
    golpe(m.a, t, 0.55, 0.001, 0.06);
    // Rebote contra la pared del fondo: una repetición apagada, además de la reverberación.
    var d = k.ctx.createDelay(0.5), df = k.ctx.createBiquadFilter(), dg = k.ctx.createGain();
    d.delayTime.value = 0.205;
    df.type = 'lowpass'; df.frequency.value = 850;
    dg.gain.value = 0.2;
    v.connect(d); d.connect(df); df.connect(dg); dg.connect(k.entrada);
  };

  // Soltar el tiro: muñeca y aire.
  FAB.shot = function (k, t, o) {
    var v = voz(k, t, DUR.shot, 0.65 * volDe(o), 0.18);
    var n = soplo(k, v, t, 0.3, 'bandpass', 650, 1.3);
    n.f.exponentialRampToValueAtTime(2900, t + 0.2);
    tramos(n.a, t, [0, 0, 0.045, 0.7, 0.12, 0.4, 0.29, 0]);
    var c = soplo(k, v, t, 0.03, 'highpass', 2500, 0.7);
    golpe(c.a, t, 0.35, 0.0005, 0.014);
    var p = tono(k, v, 'sine', 240, t, 0.08);
    p.f.exponentialRampToValueAtTime(130, t + 0.05);
    golpe(p.a, t, 0.3, 0.002, 0.05);
  };

  // Red: "fsh" corto con el latigazo de vuelta.
  FAB.swish = function (k, t, o) {
    var v = voz(k, t, DUR.swish, 0.75 * volDe(o), 0.2);
    var n = soplo(k, v, t, 0.5, 'bandpass', 5200, 0.9);
    n.f.exponentialRampToValueAtTime(2300, t + 0.36);
    tramos(n.a, t, [0, 0, 0.008, 0.85, 0.07, 0.38, 0.125, 0.7, 0.26, 0.22, 0.46, 0]);
    var h = soplo(k, v, t, 0.3, 'highpass', 6500, 0.7);
    tramos(h.a, t, [0, 0, 0.006, 0.35, 0.09, 0.1, 0.13, 0.25, 0.28, 0]);
    var b = soplo(k, v, t, 0.2, 'bandpass', 950, 1.2);
    golpe(b.a, t + 0.004, 0.3, 0.012, 0.12);
  };

  // Aro: tañido metálico con parciales inarmónicos y batido.
  FAB.rim = function (k, t, o) {
    var f = fuerzaDe(o, 0.8);
    var v = voz(k, t, DUR.rim, (0.16 + 0.36 * f) * volDe(o), 0.35);
    var base = 418;
    var par = [1, 2.32, 3.86, 5.21, 6.93], amp = [0.5, 0.36, 0.24, 0.15, 0.09], cae = [0.6, 0.48, 0.32, 0.22, 0.15];
    for (var i = 0; i < par.length; i++) {
      var a = tono(k, v, 'sine', base * par[i] * 1.018, t, cae[i] + 0.1);
      a.f.exponentialRampToValueAtTime(base * par[i], t + 0.09);
      golpe(a.a, t, amp[i], 0.0015, cae[i]);
      if (i < 3) {
        var b = tono(k, v, 'sine', base * par[i] + 6 + 3 * i, t, cae[i] + 0.1);
        golpe(b.a, t, amp[i] * 0.5, 0.0015, cae[i] * 0.9);
      }
    }
    var n = soplo(k, v, t, 0.05, 'bandpass', 2600, 1.0);
    golpe(n.a, t, 0.55, 0.0004, 0.02);
    var p = tono(k, v, 'sine', 200, t, 0.12);
    p.f.exponentialRampToValueAtTime(118, t + 0.06);
    golpe(p.a, t, 0.55, 0.001, 0.075);
  };

  // Tablero: golpe sordo con traqueteo del marco.
  FAB.board = function (k, t, o) {
    var f = fuerzaDe(o, 0.8);
    var v = voz(k, t, DUR.board, (0.18 + 0.42 * f) * volDe(o), 0.35);
    var g = tono(k, v, 'sine', 118, t, 0.22);
    g.f.exponentialRampToValueAtTime(80, t + 0.09);
    golpe(g.a, t, 0.95, 0.001, 0.15);
    var m = tono(k, v, 'sine', 198, t, 0.16);
    golpe(m.a, t, 0.4, 0.001, 0.1);
    var n = soplo(k, v, t, 0.1, 'bandpass', 620, 1.0);
    golpe(n.a, t, 0.7, 0.0005, 0.05);
    var lfo = k.ctx.createOscillator(), prof = k.ctx.createGain(), tr = k.ctx.createGain();
    lfo.frequency.value = 41; prof.gain.value = 0.5; tr.gain.value = 0.5;
    lfo.connect(prof); prof.connect(tr.gain); tr.connect(v);
    lfo.start(t); lfo.stop(t + 0.4);
    var c1 = tono(k, tr, 'sine', 868, t, 0.3), c2 = tono(k, tr, 'sine', 1313, t, 0.25);
    golpe(c1.a, t, 0.16, 0.001, 0.22);
    golpe(c2.a, t, 0.1, 0.001, 0.16);
  };

  // Robo: manotazo y pelota que se escapa.
  FAB.steal = function (k, t, o) {
    var v = voz(k, t, DUR.steal, 0.7 * volDe(o), 0.25);
    var c = soplo(k, v, t, 0.07, 'bandpass', 1500, 0.9);
    golpe(c.a, t, 0.85, 0.0005, 0.04);
    var p = tono(k, v, 'sine', 170, t, 0.1);
    p.f.exponentialRampToValueAtTime(90, t + 0.06);
    golpe(p.a, t, 0.5, 0.001, 0.07);
    var n = soplo(k, v, t + 0.03, 0.26, 'bandpass', 2600, 1.6);
    n.f.exponentialRampToValueAtTime(480, t + 0.26);
    tramos(n.a, t + 0.03, [0, 0, 0.03, 0.6, 0.24, 0]);
  };

  // Tapón: manotazo pesado.
  FAB.block = function (k, t, o) {
    var f = fuerzaDe(o, 0.85);
    var v = voz(k, t, DUR.block, (0.22 + 0.42 * f) * volDe(o), 0.4);
    var n = soplo(k, v, t, 0.1, 'lowpass', 1900, 0.7);
    golpe(n.a, t, 1.0, 0.0005, 0.055);
    var b = soplo(k, v, t, 0.16, 'bandpass', 700, 2.0);
    golpe(b.a, t, 0.6, 0.001, 0.1);
    var g = tono(k, v, 'sine', 128, t, 0.2);
    g.f.exponentialRampToValueAtTime(58, t + 0.09);
    golpe(g.a, t, 0.95, 0.001, 0.14);
  };

  // Silbato de árbitro: tono agudo con trino (la bolita) y soplido.
  FAB.whistle = function (k, t, o) {
    var largo = o && o.largo ? 1.0 : 0.42;
    var n = o && o.n ? Math.round(limitar(o.n, 1, 3)) : 1;
    var v = voz(k, t, duracion('whistle', o), 0.3 * volDe(o), 0.45);
    for (var i = 0; i < n; i++) {
      var t0 = t + i * (largo + 0.13), f0 = 2780;
      var mez = k.ctx.createGain();
      mez.gain.setValueAtTime(0, t0);
      mez.gain.linearRampToValueAtTime(1, t0 + 0.014);
      mez.gain.setValueAtTime(1, t0 + largo - 0.05);
      mez.gain.linearRampToValueAtTime(0, t0 + largo);
      var tri = k.ctx.createGain();
      tri.gain.value = 0.62;
      var lfo = k.ctx.createOscillator(), prof = k.ctx.createGain(), fm = k.ctx.createGain();
      lfo.type = 'triangle';
      lfo.frequency.setValueAtTime(31, t0);
      lfo.frequency.linearRampToValueAtTime(43, t0 + 0.12);
      prof.gain.value = 0.38; fm.gain.value = 55;
      lfo.connect(prof); prof.connect(tri.gain);
      lfo.connect(fm);
      lfo.start(t0); lfo.stop(t0 + largo + 0.03);
      var a = tono(k, tri, 'sine', f0 * 0.86, t0, largo);
      var b = tono(k, tri, 'sine', f0 * 2 * 0.86, t0, largo);
      var c = tono(k, tri, 'sine', f0 * 1.07 * 0.86, t0, largo);
      var os = [a, b, c], mult = [1, 2, 1.07], gan = [0.8, 0.1, 0.22];
      for (var j = 0; j < 3; j++) {
        os[j].f.exponentialRampToValueAtTime(f0 * mult[j], t0 + 0.04);
        os[j].f.setValueAtTime(f0 * mult[j], t0 + largo - 0.06);
        os[j].f.linearRampToValueAtTime(f0 * mult[j] * 0.95, t0 + largo);
        os[j].a.setValueAtTime(gan[j], t0);
        fm.connect(os[j].o.frequency);
      }
      var s = soplo(k, mez, t0, largo, 'bandpass', 2900, 2.5);
      s.a.setValueAtTime(0.3, t0);
      tri.connect(mez); mez.connect(v);
    }
  };

  // Chicharra de fin de tiempo.
  FAB.buzzer = function (k, t, o) {
    var largo = 1.0;
    var v = voz(k, t, DUR.buzzer, 0.3 * volDe(o), 0.4);
    var fil = k.ctx.createBiquadFilter(), pa = k.ctx.createBiquadFilter(), env = k.ctx.createGain();
    fil.type = 'lowpass'; fil.frequency.value = 1700; fil.Q.value = 0.8;
    pa.type = 'highpass'; pa.frequency.value = 140;
    tramos(env.gain, t, [0, 0, 0.012, 1, largo - 0.02, 0.95, largo + 0.05, 0]);
    var lfo = k.ctx.createOscillator(), prof = k.ctx.createGain(), am = k.ctx.createGain();
    lfo.type = 'square'; lfo.frequency.value = 58; prof.gain.value = 0.16; am.gain.value = 0.84;
    lfo.connect(prof); prof.connect(am.gain);
    lfo.start(t); lfo.stop(t + largo + 0.1);
    var fs = [233, 234.8, 116.5, 349.5], tp = ['sawtooth', 'sawtooth', 'square', 'sawtooth'], gs = [0.4, 0.4, 0.3, 0.14];
    for (var i = 0; i < fs.length; i++) {
      var a = tono(k, fil, tp[i], fs[i], t, largo + 0.08);
      a.a.setValueAtTime(gs[i], t);
    }
    fil.connect(pa); pa.connect(am); am.connect(env); env.connect(v);
  };

  // Estrella: campanita; cada estrella, más aguda (do, mi, sol) y la tercera con destello.
  FAB.star = function (k, t, o) {
    var n = o && o.n ? Math.round(limitar(o.n, 1, 3)) : 1;
    var f = [1046.5, 1318.5, 1568][n - 1];
    var v = voz(k, t, DUR.star, 0.5 * volDe(o), 0.28);
    var a = tono(k, v, 'sine', f, t, 0.75); golpe(a.a, t, 0.5, 0.003, 0.6);
    var b = tono(k, v, 'sine', f * 2, t, 0.4); golpe(b.a, t, 0.2, 0.003, 0.3);
    var c = tono(k, v, 'sine', f * 3.01, t, 0.2); golpe(c.a, t, 0.09, 0.002, 0.13);
    var d = tono(k, v, 'triangle', f * 4, t + 0.055, 0.3); golpe(d.a, t + 0.055, 0.07, 0.002, 0.22);
    if (n === 3) {
      var e = tono(k, v, 'sine', f * 1.5, t + 0.09, 0.5); golpe(e.a, t + 0.09, 0.22, 0.003, 0.4);
      var g = tono(k, v, 'sine', f * 2, t + 0.17, 0.6); golpe(g.a, t + 0.17, 0.24, 0.003, 0.5);
    }
  };

  // Moneda: dos notas rápidas.
  FAB.coin = function (k, t, o) {
    var v = voz(k, t, DUR.coin, 0.4 * volDe(o), 0.15);
    var fil = k.ctx.createBiquadFilter();
    fil.type = 'lowpass'; fil.frequency.value = 5200;
    fil.connect(v);
    var a = tono(k, fil, 'square', 987.8, t, 0.5);
    a.f.setValueAtTime(1318.5, t + 0.075);
    tramos(a.a, t, [0, 0, 0.004, 0.2, 0.07, 0.16, 0.078, 0.22]);
    a.a.exponentialRampToValueAtTime(0.0001, t + 0.46);
    a.a.linearRampToValueAtTime(0, t + 0.47);
    var b = tono(k, fil, 'sine', 987.8 * 2, t, 0.5);
    b.f.setValueAtTime(1318.5 * 2, t + 0.075);
    tramos(b.a, t, [0, 0, 0.004, 0.22, 0.07, 0.18, 0.078, 0.26]);
    b.a.exponentialRampToValueAtTime(0.0001, t + 0.4);
    b.a.linearRampToValueAtTime(0, t + 0.41);
  };

  function nota(k, dst, f, t, largo, pico) {
    var a = tono(k, dst, 'triangle', f, t, largo + 0.05); golpe(a.a, t, pico, 0.006, largo);
    var b = tono(k, dst, 'sine', f * 2, t, largo * 0.7 + 0.05); golpe(b.a, t, pico * 0.35, 0.004, largo * 0.6);
    var c = tono(k, dst, 'square', f, t, largo * 0.5 + 0.05); golpe(c.a, t, pico * 0.12, 0.004, largo * 0.4);
  }

  // Victoria: arpegio ascendente y acorde final con brillo.
  FAB.win = function (k, t, o) {
    var v = voz(k, t, DUR.win, 0.36 * volDe(o), 0.3);
    var arp = [523.25, 659.25, 783.99, 1046.5];
    for (var i = 0; i < arp.length; i++) nota(k, v, arp[i], t + i * 0.105, 0.3, 0.5);
    var t1 = t + 0.5, acorde = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    for (var j = 0; j < acorde.length; j++) nota(k, v, acorde[j], t1, 1.25, 0.3);
    var bajo = tono(k, v, 'sine', 130.8, t1, 1.0); golpe(bajo.a, t1, 0.5, 0.01, 0.9);
    var n = soplo(k, v, t1, 0.5, 'highpass', 6500, 0.7); golpe(n.a, t1, 0.16, 0.004, 0.4);
  };

  // Derrota: cuatro notas que bajan y la última se desinfla.
  FAB.lose = function (k, t, o) {
    var v = voz(k, t, DUR.lose, 0.4 * volDe(o), 0.25);
    var fs = [392, 369.99, 349.23, 311.13], paso = 0.25;
    for (var i = 0; i < fs.length; i++) {
      var t0 = t + i * paso, ult = i === fs.length - 1, largo = ult ? 0.75 : 0.23;
      var fil = k.ctx.createBiquadFilter();
      fil.type = 'lowpass'; fil.Q.value = 2.5;
      fil.frequency.setValueAtTime(1500, t0);
      fil.frequency.exponentialRampToValueAtTime(420, t0 + largo);
      fil.connect(v);
      var a = tono(k, fil, 'sawtooth', fs[i], t0, largo + 0.05);
      var b = tono(k, fil, 'triangle', fs[i] / 2, t0, largo + 0.05);
      if (ult) {
        a.f.setValueAtTime(fs[i], t0 + 0.2); a.f.exponentialRampToValueAtTime(fs[i] * 0.88, t0 + largo);
        b.f.setValueAtTime(fs[i] / 2, t0 + 0.2); b.f.exponentialRampToValueAtTime(fs[i] * 0.44, t0 + largo);
      }
      tramos(a.a, t0, [0, 0, 0.012, 0.45, largo * 0.7, 0.3, largo, 0]);
      tramos(b.a, t0, [0, 0, 0.012, 0.4, largo * 0.7, 0.28, largo, 0]);
    }
  };

  // Acción no permitida: doble zumbido grave.
  FAB.error = function (k, t, o) {
    var v = voz(k, t, DUR.error, 0.3 * volDe(o), 0.06);
    var fil = k.ctx.createBiquadFilter();
    fil.type = 'lowpass'; fil.frequency.value = 950;
    fil.connect(v);
    for (var i = 0; i < 2; i++) {
      var t0 = t + i * 0.115;
      var a = tono(k, fil, 'square', i ? 139 : 156, t0, 0.1);
      tramos(a.a, t0, [0, 0, 0.006, 0.5, 0.07, 0.45, 0.092, 0]);
      var b = tono(k, fil, 'sawtooth', i ? 278.5 : 312.5, t0, 0.1);
      tramos(b.a, t0, [0, 0, 0.006, 0.2, 0.07, 0.16, 0.092, 0]);
    }
  };

  // La mira encaja sobre el aro: "tic-tin".
  FAB.lock = function (k, t, o) {
    var v = voz(k, t, DUR.lock, 0.5 * volDe(o), 0.08);
    var c = soplo(k, v, t, 0.02, 'highpass', 4200, 0.7);
    golpe(c.a, t, 0.3, 0.0003, 0.008);
    var a = tono(k, v, 'sine', 1568, t, 0.1); golpe(a.a, t, 0.4, 0.001, 0.07);
    var b = tono(k, v, 'sine', 2349.3, t + 0.04, 0.16); golpe(b.a, t + 0.04, 0.4, 0.001, 0.12);
    var d = tono(k, v, 'triangle', 4698.6, t + 0.04, 0.08); golpe(d.a, t + 0.04, 0.08, 0.001, 0.05);
  };

  // Ovación: rugido de ruido modulado, gritos más agudos, palmas y un par de chiflidos.
  FAB.cheer = function (k, t, o) {
    var v = voz(k, t, DUR.cheer, 0.62 * volDe(o), 0.3);
    var lfo = k.ctx.createOscillator(), prof = k.ctx.createGain(), am = k.ctx.createGain();
    lfo.frequency.value = 6.3; prof.gain.value = 0.13; am.gain.value = 0.87;
    lfo.connect(prof); prof.connect(am.gain); am.connect(v);
    lfo.start(t); lfo.stop(t + 3.4);
    var r = soplo(k, am, t, 3.3, 'bandpass', 620, 0.6);
    r.f.exponentialRampToValueAtTime(1500, t + 0.45);
    r.f.exponentialRampToValueAtTime(900, t + 3.2);
    tramos(r.a, t, [0, 0, 0.3, 1.0, 1.3, 0.8, 2.3, 0.3, 3.25, 0]);
    var g = soplo(k, am, t, 3.0, 'bandpass', 2300, 0.9);
    g.f.exponentialRampToValueAtTime(3000, t + 0.6);
    g.f.exponentialRampToValueAtTime(2000, t + 2.8);
    tramos(g.a, t, [0, 0, 0.4, 0.5, 1.1, 0.36, 2.0, 0.12, 2.9, 0]);
    var gr = soplo(k, am, t, 2.6, 'lowpass', 260, 0.7);
    tramos(gr.a, t, [0, 0, 0.25, 0.6, 1.2, 0.4, 2.5, 0]);
    var p = k.ctx.createBufferSource(), pf = k.ctx.createBiquadFilter(), pg = k.ctx.createGain();
    p.buffer = palmasDe(k);
    pf.type = 'bandpass'; pf.frequency.value = 2100; pf.Q.value = 0.6;
    pg.gain.value = 0.85;
    p.connect(pf); pf.connect(pg); pg.connect(v);
    p.start(t);
    var ch = [[0.35, 1750, 2550, 0.34], [0.9, 2050, 2900, 0.28], [1.45, 1600, 2300, 0.4]];
    for (var i = 0; i < ch.length; i++) {
      var t0 = t + ch[i][0], w = tono(k, v, 'sine', ch[i][1], t0, ch[i][3]);
      w.f.exponentialRampToValueAtTime(ch[i][2], t0 + ch[i][3] * 0.5);
      w.f.exponentialRampToValueAtTime(ch[i][2] * 0.93, t0 + ch[i][3]);
      tramos(w.a, t0, [0, 0, 0.03, 0.05, ch[i][3] * 0.7, 0.04, ch[i][3], 0]);
    }
  };

  // Lamento: "uuuh" que cae.
  FAB.groan = function (k, t, o) {
    var v = voz(k, t, DUR.groan, 0.75 * volDe(o), 0.3);
    var a = soplo(k, v, t, 1.7, 'bandpass', 560, 2.2);
    a.f.exponentialRampToValueAtTime(300, t + 1.3);
    tramos(a.a, t, [0, 0, 0.16, 1.0, 0.6, 0.7, 1.65, 0]);
    var b = soplo(k, v, t, 1.5, 'bandpass', 980, 3.0);
    b.f.exponentialRampToValueAtTime(690, t + 1.2);
    tramos(b.a, t, [0, 0, 0.18, 0.45, 0.7, 0.25, 1.45, 0]);
    var fil = k.ctx.createBiquadFilter();
    fil.type = 'lowpass'; fil.frequency.setValueAtTime(760, t); fil.frequency.exponentialRampToValueAtTime(380, t + 1.3);
    fil.connect(v);
    var fs = [147, 165, 185, 208, 233, 262];
    for (var i = 0; i < fs.length; i++) {
      var f0 = fs[i] * (0.97 + 0.06 * k.rnd()), ret = 0.05 * k.rnd();
      var s = tono(k, fil, 'sawtooth', f0, t + ret, 1.5);
      s.f.setValueAtTime(f0, t + ret + 0.2);
      s.f.exponentialRampToValueAtTime(f0 * (0.8 + 0.06 * k.rnd()), t + ret + 1.4);
      tramos(s.a, t + ret, [0, 0, 0.2, 0.075, 0.7, 0.05, 1.45, 0]);
    }
  };

  // Murmullo de estadio en bucle. Devuelve un control { fijar(intensidad, t), parar(t) }.
  function crearPublico(k, t, intensidad) {
    var ctx = k.ctx, fuentes = [], n = 0;
    var sal = ctx.createGain(), env = ctx.createGain();
    sal.gain.setValueAtTime(0, t);
    env.gain.value = 0.15;
    sal.connect(k.entrada); sal.connect(env); env.connect(k.envio);
    function capa(rate, tipo, f, q, gan, lfos) {
      var s = ctx.createBufferSource(), fil = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = k.ruido; s.loop = true; s.playbackRate.value = rate;
      fil.type = tipo; fil.frequency.setValueAtTime(f, t); fil.Q.value = q;
      g.gain.setValueAtTime(gan, t);
      s.connect(fil); fil.connect(g); g.connect(sal);
      s.start(t, 0.37 * (++n));
      fuentes.push(s);
      for (var i = 0; i < lfos.length; i += 2) {
        var l = ctx.createOscillator(), p = ctx.createGain();
        l.frequency.value = lfos[i]; p.gain.value = lfos[i + 1] * gan;
        l.connect(p); p.connect(g.gain);
        l.start(t);
        fuentes.push(l);
      }
      return { fil: fil, g: g };
    }
    var grave = capa(1.31, 'lowpass', 190, 0.7, 0.9, [0.07, 0.2]);
    var medio = capa(1.0, 'bandpass', 430, 0.7, 1.0, [0.13, 0.28, 0.41, 0.1]);
    var voces = capa(0.71, 'bandpass', 1250, 0.9, 0.45, [0.23, 0.32, 0.93, 0.14]);
    var ctl = {
      fijar: function (i, tt, rapido) {
        i = limitar(i, 0, 1);
        var tc = rapido ? 0.05 : 0.35;
        sal.gain.setTargetAtTime(0.05 + 0.23 * i, tt, tc);
        medio.fil.frequency.setTargetAtTime(400 + 280 * i, tt, tc);
        voces.fil.frequency.setTargetAtTime(1100 + 950 * i, tt, tc);
        voces.g.gain.setTargetAtTime(0.35 + 0.6 * i, tt, tc);
        grave.g.gain.setTargetAtTime(0.7 + 0.5 * i, tt, tc);
      },
      parar: function (tt) {
        sal.gain.cancelScheduledValues(tt);
        sal.gain.setTargetAtTime(0, tt, 0.12);
        for (var j = 0; j < fuentes.length; j++) { try { fuentes[j].stop(tt + 0.9); } catch (e) { /* ya detenida */ } }
        if (k.vivo) setTimeout(function () { try { sal.disconnect(); env.disconnect(); } catch (e) { /* nada */ } }, 1300);
      }
    };
    ctl.fijar(intensidad, t, false);
    return ctl;
  }

  // Tono del medidor de fuerza. Devuelve { fijar(pct, enZona, t), parar(t) }.
  function crearCarga(k, t) {
    var ctx = k.ctx;
    var sal = ctx.createGain();
    sal.gain.setValueAtTime(0, t);
    sal.gain.setTargetAtTime(0.12, t, 0.03);
    sal.connect(k.entrada);
    var o1 = ctx.createOscillator(), g1 = ctx.createGain();        // cuerpo
    var o2 = ctx.createOscillator(), g2 = ctx.createGain();        // octava suave
    var o3 = ctx.createOscillator(), g3 = ctx.createGain();        // quinta brillante: solo en la zona verde
    var fil = ctx.createBiquadFilter(), lfo = ctx.createOscillator(), prof = ctx.createGain(), trem = ctx.createGain();
    o1.type = 'triangle'; o2.type = 'sine'; o3.type = 'square';
    fil.type = 'lowpass'; fil.frequency.value = 3200;
    g1.gain.value = 1; g2.gain.value = 0.22; g3.gain.value = 0;
    lfo.frequency.value = 13; prof.gain.value = 0.35; trem.gain.value = 0.65;
    o1.connect(g1); g1.connect(sal);
    o2.connect(g2); g2.connect(sal);
    o3.connect(fil); fil.connect(trem); trem.connect(g3); g3.connect(sal);
    lfo.connect(prof); prof.connect(trem.gain);
    var os = [o1, o2, o3, lfo], mult = [1, 2, 3];
    function frec(p) { return 150 * Math.pow(2, 1.7 * limitar(p, 0, 100) / 100); }
    for (var i = 0; i < 3; i++) os[i].frequency.setValueAtTime(frec(0) * mult[i], t);
    for (var j = 0; j < 4; j++) os[j].start(t);
    return {
      fijar: function (p, zona, tt) {
        var f = frec(p);
        for (var i2 = 0; i2 < 3; i2++) os[i2].frequency.setTargetAtTime(f * mult[i2], tt, 0.025);
        g3.gain.setTargetAtTime(zona ? 0.3 : 0, tt, 0.02);
        g2.gain.setTargetAtTime(zona ? 0.5 : 0.22, tt, 0.02);
        g1.gain.setTargetAtTime(zona ? 0.75 : 1, tt, 0.02);
      },
      parar: function (tt) {
        sal.gain.cancelScheduledValues(tt);
        sal.gain.setTargetAtTime(0, tt, 0.02);
        for (var j2 = 0; j2 < 4; j2++) { try { os[j2].stop(tt + 0.2); } catch (e) { /* ya detenido */ } }
        if (k.vivo) setTimeout(function () { try { sal.disconnect(); } catch (e) { /* nada */ } }, 500);
      }
    };
  }

  function duracion(nombre, o) {
    if (nombre === 'whistle') {
      var largo = o && o.largo ? 1.0 : 0.42, n = o && o.n ? Math.round(limitar(o.n, 1, 3)) : 1;
      return n * largo + (n - 1) * 0.13 + 1.1;
    }
    if ((nombre === 'crowd' || nombre === 'charge') && o && o.dur > 0) return +o.dur;
    return DUR[nombre] || 0;
  }

  // ---------------------------------------------------------------- estado en vivo

  var kit = null;            // kit del AudioContext real
  var roto = false;          // no se pudo crear el contexto: no reintentar
  var activo = true, volumen = 0.8, vibra = true;
  var tInit = -1e9;          // último init(): permite programar sonidos mientras el contexto termina de reanudarse
  var ultimo = {};           // último disparo por nombre (ms)
  var carga = null;
  var publico = { quiere: false, ctl: null, intensidad: 0.35 };

  function ahoraMs() { return (global.performance && performance.now) ? performance.now() : Date.now(); }

  function puede() {         // ¿se puede sonar ya?
    if (!kit || !activo) return false;
    var e = kit.ctx.state;
    if (e === 'running') return true;
    return e !== 'closed' && (ahoraMs() - tInit) < 600;
  }

  function aplicarVolumen() {
    if (!kit) return;
    try { kit.master.gain.setTargetAtTime(activo ? volumen : 0, kit.ctx.currentTime, 0.02); } catch (e) { /* nada */ }
  }

  function revisarPublico() {  // arranca o detiene el murmullo según lo pedido y lo posible
    try {
      if (!kit) return;
      var debe = publico.quiere && activo && kit.ctx.state === 'running';
      if (debe && !publico.ctl) publico.ctl = crearPublico(kit, kit.ctx.currentTime + 0.01, publico.intensidad);
      else if (!debe && publico.ctl) { publico.ctl.parar(kit.ctx.currentTime); publico.ctl = null; }
    } catch (e) { publico.ctl = null; }
  }

  function init() {
    try {
      if (!AC || roto) return false;
      if (!kit) {
        var ctx;
        try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e1) { ctx = new AC(); }
        kit = crearKit(ctx, false, true);
        kit.master.gain.value = activo ? volumen : 0;
        try { ctx.onstatechange = function () { revisarPublico(); }; } catch (e2) { /* nada */ }
      }
      tInit = ahoraMs();
      var c = kit.ctx;
      if (c.state !== 'running' && c.state !== 'closed' && c.resume) {
        var pr = c.resume();
        if (pr && pr.then) pr.then(revisarPublico, function () { /* sigue suspendido: se reintenta en el próximo gesto */ });
        try {                  // desbloqueo de iOS: un búfer mudo disparado dentro del gesto
          var s = c.createBufferSource();
          s.buffer = c.createBuffer(1, 1, c.sampleRate);
          s.connect(c.destination); s.start(0);
        } catch (e3) { /* nada */ }
      }
      revisarPublico();
      return true;
    } catch (e) {
      if (!kit) roto = true;
      return false;
    }
  }

  function play(nombre, opts) {
    try {
      if (!FAB[nombre] || nombre === 'crowd' || nombre === 'charge' || !puede()) return false;
      var m = ahoraMs(), pausa = PAUSA[nombre] || 25, ret = opts && opts.retraso > 0 ? +opts.retraso : 0;
      if (!ret && ultimo[nombre] != null && m - ultimo[nombre] < pausa) return false;
      if (kit.voces >= MAX_VOCES) return false;
      ultimo[nombre] = m;
      FAB[nombre](kit, kit.ctx.currentTime + 0.006 + ret, opts || {});
      return true;
    } catch (e) { return false; }
  }

  var charge = {
    start: function () {
      try {
        if (carga || !puede()) return;
        carga = crearCarga(kit, kit.ctx.currentTime + 0.005);
      } catch (e) { carga = null; }
    },
    set: function (pct, enZona) {
      try { if (carga) carga.fijar(pct, !!enZona, kit.ctx.currentTime); } catch (e) { /* nada */ }
    },
    stop: function () {
      try { if (carga) carga.parar(kit.ctx.currentTime); } catch (e) { /* nada */ }
      carga = null;
    }
  };

  var crowd = {
    start: function () { publico.quiere = true; revisarPublico(); },
    stop: function () { publico.quiere = false; revisarPublico(); },
    setIntensity: function (i) {
      publico.intensidad = limitar(i, 0, 1);
      try { if (publico.ctl) publico.ctl.fijar(publico.intensidad, kit.ctx.currentTime, false); } catch (e) { /* nada */ }
    },
    cheer: function (opts) { return play('cheer', opts); },
    groan: function (opts) { return play('groan', opts); }
  };

  var VIBRA = { tap: 8, ok: [14, 50, 28], fail: [45, 70, 45] };
  function haptic(patron) {
    try {
      if (!vibra || !global.navigator || typeof navigator.vibrate !== 'function') return false;
      var p = typeof patron === 'string' ? VIBRA[patron] : patron;
      if (p == null) return false;
      return !!navigator.vibrate(p);
    } catch (e) { return false; }
  }

  function renderOffline(nombre, opts) {
    return new Promise(function (resolver) {
      var vacio = function () { resolver(new Float32Array(0)); };
      try {
        var o = opts || {}, dur = duracion(nombre, o);
        if (!OAC || !FAB[nombre] && nombre !== 'crowd' && nombre !== 'charge' || !(dur > 0)) { vacio(); return; }
        // El compresor arranca con la ganancia a cero y tarda en soltarse: se renderiza un tramo previo
        // de silencio y después se descarta, para medir el sonido como se oye con el contexto ya en marcha.
        var n = Math.ceil(dur * SR_PRUEBA), pre = Math.round(PREVIO * SR_PRUEBA), ctx;
        try { ctx = new OAC(1, n + pre, SR_PRUEBA); } catch (e1) { ctx = new OAC({ numberOfChannels: 1, length: n + pre, sampleRate: SR_PRUEBA }); }
        var k = crearKit(ctx, !!o.crudo, false), t = PREVIO + 0.004;
        if (nombre === 'crowd') {
          var c = crearPublico(k, t, o.intensidad != null ? o.intensidad : 0.5);
          if (o.hasta != null) c.fijar(o.hasta, PREVIO + dur * 0.4, false);
          c.parar(PREVIO + dur - 0.7);
        } else if (nombre === 'charge') {
          var g = crearCarga(k, t), z0 = o.zona ? o.zona[0] : 60, z1 = o.zona ? o.zona[1] : 80, util = dur - 0.25;
          for (var i = 0; i <= 60; i++) { var p = i / 60 * 100; g.fijar(p, p >= z0 && p <= z1, t + util * i / 60); }
          g.parar(t + util);
        } else {
          FAB[nombre](k, t, o);
        }
        var fin = function (buf) { try { resolver(new Float32Array(buf.getChannelData(0).subarray(pre, pre + n))); } catch (e2) { vacio(); } };
        ctx.oncomplete = function (ev) { fin(ev.renderedBuffer); };
        var pr = ctx.startRendering();
        if (pr && pr.then) pr.then(fin, vacio);
      } catch (e) { vacio(); }
    });
  }

  // Al ocultar la página se suspende el audio; al volver se reanuda (si el navegador lo permite sin gesto).
  try {
    if (global.document && document.addEventListener) {
      document.addEventListener('visibilitychange', function () {
        try {
          if (!kit) return;
          if (document.hidden) {
            charge.stop();
            if (kit.ctx.state === 'running' && kit.ctx.suspend) kit.ctx.suspend();
          } else if (kit.ctx.state !== 'closed' && kit.ctx.resume) {
            var pr = kit.ctx.resume();
            if (pr && pr.then) pr.then(revisarPublico, function () { /* esperará al próximo gesto */ });
          }
        } catch (e) { /* nada */ }
      });
    }
  } catch (e) { /* sin documento */ }

  global.Sfx = {
    names: NOMBRES.slice(),
    extras: EXTRAS.slice(),
    sampleRate: SR_PRUEBA,
    init: init,
    setEnabled: function (b) {
      activo = !!b;
      if (!activo) charge.stop();
      aplicarVolumen();
      revisarPublico();
    },
    isEnabled: function () { return activo; },
    setVolume: function (v) { volumen = limitar(v, 0, 1); aplicarVolumen(); },
    getVolume: function () { return volumen; },
    play: play,
    charge: charge,
    crowd: crowd,
    haptic: haptic,
    setHapticEnabled: function (b) { vibra = !!b; },
    renderOffline: renderOffline,
    duration: function (nombre, opts) { try { return duracion(nombre, opts); } catch (e) { return 0; } },
    estado: function () {
      return {
        soportado: !!AC, contexto: kit ? kit.ctx.state : 'sin-iniciar', activo: activo, volumen: volumen,
        voces: kit ? kit.voces : 0, publico: !!publico.ctl, publicoPedido: publico.quiere, carga: !!carga
      };
    }
  };
})(typeof window !== 'undefined' ? window : this);
