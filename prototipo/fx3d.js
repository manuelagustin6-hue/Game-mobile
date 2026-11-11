/* fx3d.js — efectos visuales sobre la escena 3D de "Jugada Maestra" → window.Fx3D
 * Requiere THREE (r158, build UMD) como global.
 *
 * API
 *   const fx = Fx3D.create({ add: (obj) => scene.add(obj), remove: (obj) => scene.remove(obj),
 *                            courtToWorld: (x, y, h) => scene.courtToWorld(x, y, h) });
 *   fx.trail.start(color)            empieza una estela (borra la anterior). color: número, texto o THREE.Color
 *   fx.trail.push(worldVec3)         posición de la pelota en el mundo; llamarlo en cada fotograma del vuelo
 *   fx.trail.stop()                  deja de crecer; lo que queda se afina y se desvanece solo
 *   fx.ring(x, y, color, radio)      onda expansiva en el piso, en coordenadas de cancha (radio final: 30)
 *   fx.spark(worldVec3, color)       destello con chispas (p. ej. en el aro al convertir)
 *   fx.dust(x, y, fuerza)            polvo a ras del piso al picar fuerte o frenar (fuerza 0..1,5; por defecto 1)
 *   fx.update(now, dt)               now en ms, dt en segundos (como scene.update); llamarlo en cada fotograma
 *   fx.clear()                       apaga todo al instante (cambio de nivel, reinicio)
 *   fx.dispose()                     quita los objetos de la escena y libera geometrías y materiales
 *   fx.info() → { activos, drawCalls, particulas, estela }   (partículas dibujadas y tramos de la estela)
 *
 * Costo: 2 objetos en total, creados una sola vez. Uno dibuja TODAS las partículas (ondas, halos, chispas y
 * polvo) con instancias; el otro, la cinta de la estela. Máximo 2 draw calls con todo activo y 0 cuando no
 * hay nada (visible = false). No se crean geometrías, materiales ni vectores por fotograma: el estado vive
 * en arreglos tipados de tamaño fijo y, si el pool se llena, se recicla la partícula más vieja.
 * Los colores se mezclan con alfa premultiplicado: un mismo material sirve para luz (aditivo) y polvo (normal).
 * El azar es determinista (sin Math.random).
 */
(function (global) {
  'use strict';

  var MAX = 112;             // partículas simultáneas
  var MAXP = 44;             // puntos de la estela
  var VIDA_ESTELA = 0.45;    // segundos que tarda en apagarse cada punto
  var LARGO_ESTELA = 95;     // largo máximo de la cinta, en unidades de mundo
  var PASO_ESTELA = 2.2;     // distancia mínima entre puntos
  var G = 230;               // gravedad (9,8 m/s² ≈ 235 unidades/s²)
  var LEJOS = 0.85;          // cuánto se agranda el destello visto de lejos (0 = nada)
  var PISO = 0.75;           // altura de lo que va apoyado en el piso (los overlays de la escena van a 0,6)

  // orientación: 0 = cartel hacia la cámara, 1 = apoyado en el piso, 2 = estirado a lo largo de su velocidad
  // forma: 0 halo, 1 anillo, 2 chispa, 3 polvo, 4 estrella, 5 disco suave
  var VERT_P = [
    'attribute vec3 aPos; attribute vec4 aEje; attribute vec4 aDat; attribute vec4 aCol;',
    'varying vec2 vUv; varying vec4 vCol; varying vec3 vDat;',
    'void main() {',
    '  vec2 c = position.xy;',
    '  float forma = floor(aDat.y / 4.0 + 0.01);',
    '  float orient = aDat.y - forma * 4.0;',
    '  vec4 mv = modelViewMatrix * vec4(aPos, 1.0);',
    '  float lejos = 1.0 + aDat.w * clamp((-mv.z - 260.0) / 260.0, 0.0, 2.5);',   // de lejos se agranda para que se note
    '  float tam = aDat.x * lejos;',
    '  if (orient < 0.5) {',
    '    float cs = cos(aEje.x); float sn = sin(aEje.x);',
    '    mv.xy += vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * tam;',
    '  } else if (orient < 1.5) {',
    '    mv = modelViewMatrix * vec4(aPos + vec3(c.x, 0.0, c.y) * tam, 1.0);',
    '  } else {',
    '    vec3 ev = (modelViewMatrix * vec4(aEje.xyz, 0.0)).xyz * lejos;',
    '    vec3 lat = cross(ev, mv.xyz);',
    '    float l = length(lat);',
    '    lat = l > 1e-5 ? lat / l : vec3(1.0, 0.0, 0.0);',
    '    mv.xyz += ev * c.x + lat * c.y * tam;',
    '  }',
    '  vUv = c; vCol = aCol; vDat = vec3(forma, aDat.z, aEje.w);',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');

  var FRAG_P = [
    'varying vec2 vUv; varying vec4 vCol; varying vec3 vDat;',
    'void main() {',
    '  float forma = vDat.x; float prog = vDat.y; float adit = vDat.z;',
    '  float r = length(vUv);',
    '  float a = 0.0; float blanco = 0.0;',
    '  if (forma < 0.5) {',                                   // halo
    '    float f = max(0.0, 1.0 - r);',
    '    a = f * f; blanco = smoothstep(0.45, 0.0, r) * 0.9;',
    '  } else if (forma < 1.5) {',                            // anillo que se afina
    '    float w = mix(0.27, 0.085, prog);',
    '    float d = abs(r - (0.97 - w));',
    '    a = smoothstep(w, w * 0.3, d);',
    '    blanco = smoothstep(w * 0.55, 0.0, d) * 0.55;',
    '    a += 0.3 * (1.0 - prog) * (1.0 - prog) * smoothstep(0.97 - w, 0.1, r);',
    '  } else if (forma < 2.5) {',                            // chispa: cabeza brillante y cola fina
    '    float lado = 1.0 - abs(vUv.y);',
    '    float cola = smoothstep(-1.0, 0.75, vUv.x) * smoothstep(1.0, 0.8, vUv.x);',
    '    a = lado * lado * cola; blanco = lado * cola * 0.75;',
    '  } else if (forma < 3.5) {',                            // polvo: mancha blanda e irregular
    '    float ang = atan(vUv.y, vUv.x);',
    '    float rr = r * (1.0 + 0.16 * sin(ang * 3.0 + prog * 2.0) + 0.08 * sin(ang * 5.0 + 1.7));',
    '    a = smoothstep(1.0, 0.4, rr) * (0.75 + 0.25 * smoothstep(0.0, 0.7, rr));',
    '  } else if (forma < 4.5) {',                            // estrella de cuatro puntas
    '    float k = abs(vUv.x * vUv.y);',
    '    float f = max(0.0, 1.0 - r);',
    '    a = f * (0.012 / (k + 0.012)) + f * f * f * 0.6; blanco = smoothstep(0.5, 0.0, r);',
    '  } else {',                                             // disco suave
    '    float f = max(0.0, 1.0 - r);',
    '    a = f * f;',
    '  }',
    '  a = clamp(a, 0.0, 1.0) * vCol.a;',
    '  vec3 col = mix(vCol.rgb, vec3(1.0), clamp(blanco, 0.0, 1.0));',
    '  gl_FragColor = vec4(col * a, a * (1.0 - adit));',
    '}'
  ].join('\n');

  var VERT_E = [
    'attribute vec3 aTan; attribute vec2 aLado;',
    'uniform float uAncho;',
    'varying vec2 vLado;',
    'void main() {',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  vec3 tv = (modelViewMatrix * vec4(aTan, 0.0)).xyz;',
    '  vec3 lat = cross(tv, mv.xyz);',
    '  float l = length(lat);',
    '  lat = l > 1e-5 ? lat / l : vec3(1.0, 0.0, 0.0);',
    '  float u = clamp(aLado.y, 0.0, 1.0);',
    '  float lejos = 1.0 + 0.5 * clamp((-mv.z - 260.0) / 260.0, 0.0, 2.5);',
    '  mv.xyz += lat * aLado.x * uAncho * lejos * (0.12 + 0.88 * pow(u, 0.75));',
    '  vLado = vec2(aLado.x, u);',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');

  var FRAG_E = [
    'uniform vec3 uColor; uniform float uAlfa; uniform float uAdit;',
    'varying vec2 vLado;',
    'void main() {',
    '  float v = abs(vLado.x); float u = vLado.y;',
    '  float nucleo = smoothstep(0.6, 0.05, v);',
    '  float halo = (1.0 - v) * (1.0 - v);',
    '  float a = (nucleo * 0.95 + halo * 0.5) * pow(u, 1.2) * uAlfa;',
    '  a = clamp(a, 0.0, 1.0);',
    '  vec3 col = mix(uColor, vec3(1.0), nucleo * u * u * 0.8);',
    '  gl_FragColor = vec4(col * a, a * (1.0 - uAdit));',
    '}'
  ].join('\n');

  function crear(dep) {
    var T = global.THREE;
    dep = dep || {};
    var agregar = typeof dep.add === 'function' ? dep.add : function () {};
    var quitar = typeof dep.remove === 'function' ? dep.remove : function () {};
    var aMundo = typeof dep.courtToWorld === 'function' ? dep.courtToWorld : function (x, y, h) { return { x: x - 180, y: h || 0, z: y - 300 }; };

    var semilla = 987654321;
    function rnd() {                  // mulberry32
      semilla = (semilla + 0x6D2B79F5) >>> 0;
      var x = semilla;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    }

    var _c = new T.Color();
    var _rgb = [1, 1, 1];
    function color(c, porDefecto) {   // deja en _rgb el color en sRGB (0..1)
      try { _c.set(c == null ? porDefecto : c); } catch (e) { _c.set(porDefecto); }
      if (_c.convertLinearToSRGB) _c.convertLinearToSRGB();
      _rgb[0] = _c.r; _rgb[1] = _c.g; _rgb[2] = _c.b;
    }

    function mezcla() {               // alfa premultiplicado: rgb + destino * (1 - alfa)
      return {
        transparent: true, depthWrite: false, depthTest: true, side: T.DoubleSide, toneMapped: false, fog: false,
        blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.OneFactor, blendDst: T.OneMinusSrcAlphaFactor,
        blendSrcAlpha: T.OneFactor, blendDstAlpha: T.OneMinusSrcAlphaFactor
      };
    }

    // ------------------------------------------------------------ partículas (1 draw call)

    var pPos = new Float32Array(MAX * 3), pVel = new Float32Array(MAX * 3);
    var pEdad = new Float32Array(MAX), pVida = new Float32Array(MAX);       // vida 0 = libre
    var pTam0 = new Float32Array(MAX), pTam1 = new Float32Array(MAX);
    var pOri = new Uint8Array(MAX), pForma = new Uint8Array(MAX);
    var pCol = new Float32Array(MAX * 3), pAlfa = new Float32Array(MAX), pAdit = new Float32Array(MAX);
    var pEntra = new Float32Array(MAX), pCae = new Float32Array(MAX);       // entrada (fracción) y exponente de salida
    var pGrav = new Float32Array(MAX), pFreno = new Float32Array(MAX);
    var pRot = new Float32Array(MAX), pVRot = new Float32Array(MAX), pEstira = new Float32Array(MAX), pLejos = new Float32Array(MAX);
    var cursor = 0, vivas = 0, dibujadas = 0;

    var geoP = new T.InstancedBufferGeometry();
    geoP.setAttribute('position', new T.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    geoP.setIndex([0, 1, 2, 0, 2, 3]);
    var bPos = new T.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    var bEje = new T.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    var bDat = new T.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    var bCol = new T.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    var bufs = [bPos, bEje, bDat, bCol];
    for (var bi = 0; bi < bufs.length; bi++) bufs[bi].setUsage(T.DynamicDrawUsage);
    geoP.setAttribute('aPos', bPos); geoP.setAttribute('aEje', bEje); geoP.setAttribute('aDat', bDat); geoP.setAttribute('aCol', bCol);
    geoP.instanceCount = 0;
    var optP = mezcla();
    optP.vertexShader = VERT_P; optP.fragmentShader = FRAG_P;
    var matP = new T.ShaderMaterial(optP);
    var mallaP = new T.Mesh(geoP, matP);
    mallaP.frustumCulled = false; mallaP.visible = false; mallaP.renderOrder = 31;
    mallaP.castShadow = false; mallaP.receiveShadow = false; mallaP.matrixAutoUpdate = false;
    mallaP.name = 'fx-particulas';

    // Reserva una partícula (recicla la más vieja si no hay libres) y la deja con valores por defecto.
    function nueva(x, y, z) {
      var i = -1, k, j;
      for (k = 0; k < MAX; k++) { j = (cursor + k) % MAX; if (pVida[j] === 0) { i = j; break; } }
      if (i < 0) i = cursor;                   // pool lleno: se recicla en ronda (el cursor apunta a la más vieja)
      else vivas++;
      cursor = (i + 1) % MAX;
      pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
      pVel[i * 3] = 0; pVel[i * 3 + 1] = 0; pVel[i * 3 + 2] = 0;
      pEdad[i] = 0; pVida[i] = 0.5; pTam0[i] = 1; pTam1[i] = 1; pOri[i] = 0; pForma[i] = 0;
      pCol[i * 3] = _rgb[0]; pCol[i * 3 + 1] = _rgb[1]; pCol[i * 3 + 2] = _rgb[2];
      pAlfa[i] = 1; pAdit[i] = 1; pEntra[i] = 0.06; pCae[i] = 1.5;
      pGrav[i] = 0; pFreno[i] = 0; pRot[i] = 0; pVRot[i] = 0; pEstira[i] = 0; pLejos[i] = 0;
      return i;
    }

    function avanzarParticulas(dt) {
      var n = 0, aP = bPos.array, aE = bEje.array, aD = bDat.array, aC = bCol.array;
      vivas = 0;
      for (var i = 0; i < MAX; i++) {
        if (pVida[i] === 0) continue;
        pEdad[i] += dt;
        if (pEdad[i] >= pVida[i]) { pVida[i] = 0; continue; }
        vivas++;
        if (pEdad[i] < 0) continue;              // todavía en espera (retraso)
        var i3 = i * 3, k = pEdad[i] / pVida[i];
        var fr = pFreno[i] > 0 ? Math.exp(-pFreno[i] * dt) : 1;
        pVel[i3 + 1] -= pGrav[i] * dt;
        pVel[i3] *= fr; pVel[i3 + 1] *= fr; pVel[i3 + 2] *= fr;
        pPos[i3] += pVel[i3] * dt; pPos[i3 + 1] += pVel[i3 + 1] * dt; pPos[i3 + 2] += pVel[i3 + 2] * dt;
        if (pGrav[i] > 0 && pPos[i3 + 1] < PISO && pVel[i3 + 1] < 0) {       // rebote en el parqué
          pPos[i3 + 1] = PISO; pVel[i3 + 1] *= -0.38; pVel[i3] *= 0.7; pVel[i3 + 2] *= 0.7;
        }
        pRot[i] += pVRot[i] * dt;
        var e = 1 - k, sal = 1 - e * e * e;       // tamaño: sale rápido y frena
        var tam = pTam0[i] + (pTam1[i] - pTam0[i]) * sal;
        var alfa = pAlfa[i] * Math.min(1, k / pEntra[i]) * Math.pow(e, pCae[i]);
        var n3 = n * 3, n4 = n * 4;
        aP[n3] = pPos[i3]; aP[n3 + 1] = pPos[i3 + 1]; aP[n3 + 2] = pPos[i3 + 2];
        if (pOri[i] === 2) {
          var vx = pVel[i3], vy = pVel[i3 + 1], vz = pVel[i3 + 2], sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
          var largo = Math.max(tam * 1.3, sp * pEstira[i]), inv = sp > 1e-4 ? largo / sp : 0;
          aE[n4] = vx * inv; aE[n4 + 1] = sp > 1e-4 ? vy * inv : largo; aE[n4 + 2] = vz * inv;
        } else {
          aE[n4] = pRot[i]; aE[n4 + 1] = 0; aE[n4 + 2] = 0;
        }
        aE[n4 + 3] = pAdit[i];
        aD[n4] = tam; aD[n4 + 1] = pOri[i] + 4 * pForma[i]; aD[n4 + 2] = k; aD[n4 + 3] = pLejos[i];
        aC[n4] = pCol[i3]; aC[n4 + 1] = pCol[i3 + 1]; aC[n4 + 2] = pCol[i3 + 2]; aC[n4 + 3] = alfa;
        n++;
      }
      dibujadas = n;
      geoP.instanceCount = n;
      if (n > 0) { bPos.needsUpdate = true; bEje.needsUpdate = true; bDat.needsUpdate = true; bCol.needsUpdate = true; }
      mallaP.visible = n > 0;
    }

    // ------------------------------------------------------------ estela (1 draw call)

    var ePts = new Float32Array(MAXP * 3), eT = new Float32Array(MAXP);
    var eN = 0, eActiva = false, eSegs = 0, reloj = 0;
    var geoE = new T.BufferGeometry();
    var ePos = new T.BufferAttribute(new Float32Array(MAXP * 2 * 3), 3);
    var eTan = new T.BufferAttribute(new Float32Array(MAXP * 2 * 3), 3);
    var eLado = new T.BufferAttribute(new Float32Array(MAXP * 2 * 2), 2);
    ePos.setUsage(T.DynamicDrawUsage); eTan.setUsage(T.DynamicDrawUsage); eLado.setUsage(T.DynamicDrawUsage);
    geoE.setAttribute('position', ePos); geoE.setAttribute('aTan', eTan); geoE.setAttribute('aLado', eLado);
    var idx = new Uint16Array((MAXP - 1) * 6);
    for (var s = 0; s < MAXP - 1; s++) {
      var a0 = s * 2, o6 = s * 6;
      idx[o6] = a0; idx[o6 + 1] = a0 + 1; idx[o6 + 2] = a0 + 2; idx[o6 + 3] = a0 + 1; idx[o6 + 4] = a0 + 3; idx[o6 + 5] = a0 + 2;
    }
    geoE.setIndex(new T.BufferAttribute(idx, 1));
    geoE.setDrawRange(0, 0);
    var optE = mezcla();
    optE.vertexShader = VERT_E; optE.fragmentShader = FRAG_E;
    optE.uniforms = { uColor: { value: new T.Vector3(1, 0.8, 0.5) }, uAncho: { value: 6.2 }, uAlfa: { value: 1.0 }, uAdit: { value: 0.45 } };
    var matE = new T.ShaderMaterial(optE);
    var mallaE = new T.Mesh(geoE, matE);
    mallaE.frustumCulled = false; mallaE.visible = false; mallaE.renderOrder = 30;
    mallaE.castShadow = false; mallaE.receiveShadow = false; mallaE.matrixAutoUpdate = false;
    mallaE.name = 'fx-estela';

    function soltarCola(cuantos) {
      if (cuantos <= 0) return;
      if (cuantos >= eN) { eN = 0; return; }
      ePts.copyWithin(0, cuantos * 3, eN * 3);
      eT.copyWithin(0, cuantos, eN);
      eN -= cuantos;
    }

    function empujar(v) {
      if (!eActiva || !v) return;
      var x = +v.x, y = +v.y, z = +v.z;
      if (!(x === x && y === y && z === z)) return;
      if (eN >= 2) {
        var j = (eN - 2) * 3, dx = x - ePts[j], dy = y - ePts[j + 1], dz = z - ePts[j + 2];
        if (dx * dx + dy * dy + dz * dz < PASO_ESTELA * PASO_ESTELA) {        // mueve la cabeza sin agregar punto
          j = (eN - 1) * 3; ePts[j] = x; ePts[j + 1] = y; ePts[j + 2] = z; eT[eN - 1] = reloj;
          return;
        }
      }
      if (eN === MAXP) soltarCola(1);
      var q = eN * 3; ePts[q] = x; ePts[q + 1] = y; ePts[q + 2] = z; eT[eN] = reloj; eN++;
    }

    function avanzarEstela() {
      if (eN === 0) { eSegs = 0; mallaE.visible = false; return; }
      // Vida de cada punto: por edad y por distancia a la cabeza. Se sueltan los de la cola ya apagados.
      var aL = eLado.array, aPo = ePos.array, aTa = eTan.array, i, j, dist = 0, primero = 0;
      for (i = eN - 1; i >= 0; i--) {
        if (i < eN - 1) {
          j = i * 3;
          var ax = ePts[j + 3] - ePts[j], ay = ePts[j + 4] - ePts[j + 1], az = ePts[j + 5] - ePts[j + 2];
          dist += Math.sqrt(ax * ax + ay * ay + az * az);
        }
        var u = Math.min(1 - (reloj - eT[i]) / VIDA_ESTELA, 1 - dist / LARGO_ESTELA);
        aL[i * 4 + 1] = u;               // provisorio: se reubica abajo si se suelta la cola
        if (u <= 0 && primero === 0) primero = i;
      }
      if (!eActiva && aL[(eN - 1) * 4 + 1] <= 0) primero = eN;                // todo apagado
      if (primero > 0) {
        for (i = primero; i < eN; i++) aL[(i - primero) * 4 + 1] = aL[i * 4 + 1];
        soltarCola(primero);
      }
      // Menos de dos puntos, o solo la cabeza encendida (pelota quieta): no hay nada que dibujar.
      if (eN < 2 || aL[(eN - 2) * 4 + 1] <= 0) { eSegs = 0; geoE.setDrawRange(0, 0); mallaE.visible = false; return; }
      var tx = 0, ty = 0, tz = 1;
      for (i = 0; i < eN; i++) {
        var a = (i > 0 ? i - 1 : i) * 3, b = (i < eN - 1 ? i + 1 : i) * 3, p = i * 3;
        var dx = ePts[b] - ePts[a], dy = ePts[b + 1] - ePts[a + 1], dz = ePts[b + 2] - ePts[a + 2];
        if (dx * dx + dy * dy + dz * dz > 1e-6) { tx = dx; ty = dy; tz = dz; }
        var uu = aL[i * 4 + 1], o = i * 6, o4 = i * 4;
        aPo[o] = aPo[o + 3] = ePts[p]; aPo[o + 1] = aPo[o + 4] = ePts[p + 1]; aPo[o + 2] = aPo[o + 5] = ePts[p + 2];
        aTa[o] = aTa[o + 3] = tx; aTa[o + 1] = aTa[o + 4] = ty; aTa[o + 2] = aTa[o + 5] = tz;
        aL[o4] = -1; aL[o4 + 1] = uu; aL[o4 + 2] = 1; aL[o4 + 3] = uu;
      }
      ePos.needsUpdate = true; eTan.needsUpdate = true; eLado.needsUpdate = true;
      eSegs = eN - 1;
      geoE.setDrawRange(0, eSegs * 6);
      mallaE.visible = true;
    }

    agregar(mallaP); agregar(mallaE);
    var vivo = true, ultimoNow = -1;

    // ------------------------------------------------------------ efectos

    function onda(x, y, col, radio) {
      if (!vivo) return;
      var w = aMundo(x, y, 0), R = radio > 0 ? +radio : 30, i;
      color(col, 0xffffff);
      i = nueva(w.x, PISO, w.z);               // anillo principal
      pOri[i] = 1; pForma[i] = 1; pVida[i] = 0.62; pTam0[i] = R * 0.25; pTam1[i] = R; pAlfa[i] = 1; pAdit[i] = 0.15; pCae[i] = 1.1; pEntra[i] = 0.04;
      i = nueva(w.x, PISO + 0.05, w.z);        // segundo anillo, más tenue y retrasado
      pOri[i] = 1; pForma[i] = 1; pVida[i] = 0.6; pEdad[i] = -0.13; pTam0[i] = R * 0.15; pTam1[i] = R * 0.7; pAlfa[i] = 0.75; pAdit[i] = 0.15; pCae[i] = 1.2;
      i = nueva(w.x, PISO + 0.1, w.z);         // fogonazo en el centro
      pOri[i] = 1; pForma[i] = 5; pVida[i] = 0.3; pTam0[i] = R * 0.35; pTam1[i] = R * 0.75; pAlfa[i] = 0.7; pAdit[i] = 0.8; pCae[i] = 1.6; pEntra[i] = 0.1;
    }

    function destello(v, col) {
      if (!vivo || !v) return;
      var x = +v.x, y = +v.y, z = +v.z, i, k;
      if (!(x === x && y === y && z === z)) return;
      color(col, 0xffc94a);
      i = nueva(x, y, z);                      // halo
      pForma[i] = 0; pVida[i] = 0.5; pTam0[i] = 12; pTam1[i] = 40; pAlfa[i] = 1; pCae[i] = 1.7; pEntra[i] = 0.07; pLejos[i] = LEJOS;
      i = nueva(x, y, z);                      // estrella que gira apenas
      pForma[i] = 4; pVida[i] = 0.58; pTam0[i] = 20; pTam1[i] = 66; pAlfa[i] = 1; pCae[i] = 1.6; pEntra[i] = 0.1; pRot[i] = 0.5; pVRot[i] = 1.4; pLejos[i] = LEJOS;
      i = nueva(x, y - 1, z);                  // anillo horizontal a la altura del aro
      pOri[i] = 1; pForma[i] = 1; pVida[i] = 0.55; pTam0[i] = 6; pTam1[i] = 28; pAlfa[i] = 0.9; pAdit[i] = 0.8; pCae[i] = 1.3; pLejos[i] = LEJOS * 0.6;
      for (k = 0; k < 22; k++) {               // chispas
        var ang = (k + rnd() * 0.8) / 22 * Math.PI * 2, sube = rnd(), vel = 55 + 100 * rnd();
        i = nueva(x + Math.cos(ang) * 4.5, y + (rnd() - 0.5) * 3, z + Math.sin(ang) * 4.5);
        pVel[i * 3] = Math.cos(ang) * vel; pVel[i * 3 + 1] = 30 + 115 * sube; pVel[i * 3 + 2] = Math.sin(ang) * vel;
        pOri[i] = 2; pForma[i] = 2; pVida[i] = 0.55 + 0.5 * rnd(); pTam0[i] = 1.5 + 0.8 * rnd(); pTam1[i] = 0.5;
        pEstira[i] = 0.065; pGrav[i] = G; pFreno[i] = 1.2; pAlfa[i] = 1; pCae[i] = 0.9; pEntra[i] = 0.02; pLejos[i] = LEJOS;
        if (k % 3 === 0) { pCol[i * 3] = 1; pCol[i * 3 + 1] = 0.97; pCol[i * 3 + 2] = 0.86; }
      }
      for (k = 0; k < 8; k++) {                // brillitos que flotan
        var a2 = rnd() * Math.PI * 2, r2 = 7 + 14 * rnd();
        i = nueva(x + Math.cos(a2) * r2, y + (rnd() - 0.3) * 10, z + Math.sin(a2) * r2);
        pVel[i * 3] = Math.cos(a2) * 14; pVel[i * 3 + 1] = 10 + 16 * rnd(); pVel[i * 3 + 2] = Math.sin(a2) * 14;
        pForma[i] = 4; pVida[i] = 0.55 + 0.4 * rnd(); pEdad[i] = -0.05 - 0.2 * rnd(); pTam0[i] = 3; pTam1[i] = 8 + 5 * rnd();
        pFreno[i] = 1.5; pAlfa[i] = 0.95; pCae[i] = 1.2; pEntra[i] = 0.2; pVRot[i] = 2 * (rnd() - 0.5); pLejos[i] = LEJOS;
      }
    }

    function polvo(x, y, fuerza) {
      if (!vivo) return;
      var f = fuerza == null ? 1 : Math.max(0.2, Math.min(1.5, +fuerza || 1));
      var w = aMundo(x, y, 0), i, k, cant = Math.round(8 + 5 * f);
      color(0xf3e7d3, 0xf3e7d3);
      i = nueva(w.x, PISO, w.z);               // onda baja y pálida
      pOri[i] = 1; pForma[i] = 1; pVida[i] = 0.42; pTam0[i] = 5; pTam1[i] = 15 + 8 * f; pAlfa[i] = 0.55; pAdit[i] = 0.1; pCae[i] = 1.3;
      for (k = 0; k < cant; k++) {             // nubecitas que se abren a ras del piso
        var ang = (k + rnd() * 0.7) / cant * Math.PI * 2, vel = (34 + 34 * rnd()) * (0.6 + 0.5 * f);
        i = nueva(w.x + Math.cos(ang) * 3, 2.2 + 1.5 * rnd(), w.z + Math.sin(ang) * 3);
        pVel[i * 3] = Math.cos(ang) * vel; pVel[i * 3 + 1] = 8 + 13 * rnd(); pVel[i * 3 + 2] = Math.sin(ang) * vel;
        pForma[i] = 3; pVida[i] = 0.65 + 0.35 * rnd(); pTam0[i] = 1.8 + rnd(); pTam1[i] = (5 + 3.6 * rnd()) * (0.8 + 0.25 * f);
        pFreno[i] = 3.4; pAlfa[i] = 0.62 + 0.15 * rnd(); pAdit[i] = 0; pCae[i] = 1.1; pEntra[i] = 0.08;
        pRot[i] = rnd() * 6.28; pVRot[i] = (rnd() - 0.5) * 1.5;
      }
    }

    function limpiar() {
      for (var i = 0; i < MAX; i++) pVida[i] = 0;
      vivas = 0; dibujadas = 0; geoP.instanceCount = 0; mallaP.visible = false;
      eN = 0; eActiva = false; eSegs = 0; geoE.setDrawRange(0, 0); mallaE.visible = false;
    }

    return {
      trail: {
        start: function (col) {
          if (!vivo) return;
          color(col, 0xffb060);
          matE.uniforms.uColor.value.set(_rgb[0], _rgb[1], _rgb[2]);
          eN = 0; eActiva = true;
        },
        push: empujar,
        stop: function () { eActiva = false; }
      },
      ring: onda,
      spark: destello,
      dust: polvo,
      update: function (now, dt) {
        if (!vivo) return;
        if (!(dt >= 0)) dt = ultimoNow >= 0 && now > ultimoNow ? (now - ultimoNow) / 1000 : 0.016;
        if (typeof now === 'number') ultimoNow = now;
        if (dt > 0.05) dt = 0.05;
        reloj += dt;
        if (vivas > 0 || mallaP.visible) avanzarParticulas(dt);
        if (eN > 0 || mallaE.visible) avanzarEstela();
      },
      clear: limpiar,
      dispose: function () {
        if (!vivo) return;
        limpiar(); vivo = false;
        quitar(mallaP); quitar(mallaE);
        geoP.dispose(); matP.dispose(); geoE.dispose(); matE.dispose();
      },
      info: function () {
        var est = mallaE.visible ? eSegs : 0;
        return { activos: vivas + (eActiva || est > 0 ? 1 : 0), drawCalls: (mallaP.visible ? 1 : 0) + (mallaE.visible ? 1 : 0), particulas: dibujadas, estela: est };
      }
    };
  }

  global.Fx3D = { create: crear, MAX_PARTICULAS: MAX, MAX_DRAW_CALLS: 2 };
})(typeof window !== 'undefined' ? window : this);
