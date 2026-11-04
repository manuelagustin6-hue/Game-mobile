// Niveles de "Jugada Maestra".
// Cancha de 360 x 600, aro en (180, 70).
// players: el primero tiene la pelota.
// defenders: {x, y} fijos, o con path (puntos de su ruta, ida y vuelta) y speed (px/s).
// walls: obstáculos [x1, y1, x2, y2].
// stage: 'club' (partido con tu club) o 'seleccion' (partido con tu selección).
(function (root) {
  'use strict';

  const LEVELS = [
    // ---------- Temporada 1: club de tu país ----------
    {
      name: 'Primer tiro', stage: 'club',
      tip: 'Arrastra desde el jugador con la pelota hasta el aro y suelta.',
      players: [[180, 270]],
      defenders: [],
    },
    {
      name: 'Pásala', stage: 'club',
      tip: 'Desde lejos no llegas al aro. Pasa por un compañero y termina en el aro.',
      players: [[90, 490], [240, 230]],
      defenders: [],
    },
    {
      name: 'Línea de pase', stage: 'club',
      tip: 'Si un defensor está en la línea del pase, te roba la pelota.',
      players: [[60, 480], [300, 240], [110, 250]],
      defenders: [{ x: 180, y: 360 }],
    },
    {
      name: 'Triangulación', stage: 'club',
      tip: 'A veces el camino más corto no es el mejor.',
      players: [[300, 520], [70, 420], [250, 250]],
      defenders: [{ x: 275, y: 385 }],
    },
    {
      name: 'Tapón', stage: 'club',
      tip: 'Un defensor pegado al tirador le tapa el tiro. Busca al compañero libre.',
      players: [[180, 250], [290, 200], [70, 200]],
      defenders: [{ x: 180, y: 212 }, { x: 125, y: 225 }],
    },
    {
      name: 'Convocatoria', stage: 'seleccion',
      tip: 'Este defensor se mueve. Mira su recorrido antes de pasar.',
      players: [[180, 520], [100, 260], [270, 260]],
      defenders: [{ x: 320, y: 390, path: [[40, 390]], speed: 150 }],
    },

    // ---------- Temporada 2: tu nuevo club ----------
    {
      name: 'Va y viene', stage: 'club',
      tip: 'Calcula dónde va a estar el defensor cuando llegue la pelota.',
      players: [[60, 540], [300, 430], [70, 300], [260, 230]],
      defenders: [
        { x: 320, y: 480, path: [[40, 480]], speed: 170 },
        { x: 165, y: 265 },
      ],
    },
    {
      name: 'Obstáculos', stage: 'club',
      tip: 'La pelota no atraviesa los obstáculos.',
      players: [[180, 540], [60, 360], [300, 360], [180, 230]],
      defenders: [{ x: 180, y: 420 }],
      walls: [[140, 300, 220, 300], [60, 440, 130, 440]],
    },
    {
      name: 'Presión', stage: 'club',
      tip: 'Dos defensores cubren el centro. Ábrete por las bandas.',
      players: [[180, 560], [50, 450], [310, 450], [60, 230], [300, 230]],
      defenders: [
        { x: 180, y: 380, path: [[180, 300]], speed: 90 },
        { x: 120, y: 250, path: [[240, 250]], speed: 160 },
        { x: 285, y: 205 },
      ],
    },
    {
      name: 'Zona', stage: 'club',
      tip: 'Hay un pase largo que nadie cubre. Encuéntralo.',
      players: [[40, 560], [320, 540], [320, 330], [50, 330], [180, 200]],
      defenders: [
        { x: 180, y: 545 },
        { x: 180, y: 430, path: [[180, 280]], speed: 120 },
        { x: 210, y: 160 },
      ],
      walls: [[230, 400, 330, 400]],
    },
    {
      name: 'Contraataque', stage: 'club',
      tip: 'Los defensores vuelven rápido. Juega antes de que lleguen.',
      players: [[180, 580], [70, 400], [290, 400], [180, 250]],
      defenders: [
        { x: 180, y: 120, path: [[180, 230]], speed: 120 },
        { x: 40, y: 330, path: [[320, 330]], speed: 200 },
      ],
    },
    {
      name: 'Final con la selección', stage: 'seleccion',
      tip: 'La final. Defensores en movimiento, obstáculos y poco espacio.',
      players: [[60, 570], [300, 560], [300, 380], [60, 380], [180, 240]],
      defenders: [
        { x: 180, y: 560, path: [[180, 470]], speed: 110 },
        { x: 40, y: 470, path: [[320, 470]], speed: 180 },
        { x: 180, y: 300, path: [[100, 300], [260, 300]], speed: 140 },
        { x: 215, y: 205 },
      ],
      walls: [[140, 380, 220, 380]],
    },
  ];

  if (typeof module !== 'undefined' && module.exports) module.exports = LEVELS;
  else root.LEVELS = LEVELS;
})(typeof window !== 'undefined' ? window : globalThis);
