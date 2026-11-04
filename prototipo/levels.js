// Niveles de "Jugada Maestra".
// Cancha de 360 x 600, aro en (180, 70).
// players: tus jugadores; `holder` indica cuál empieza con la pelota (0 si falta) y `star` cuál es
// el jugador del usuario (0 si falta).
// defenders: {x, y} fijos, o con path (puntos de su ruta, ida y vuelta) y speed (px/s).
//   Un defensor con tall: true es un pívot: más alto y fornido, con reach (radio en el que roba
//   pases y conducciones; base 22) y block (distancia a la que tapa un tiro; base 40) mayores.
// stage: 'club' (partido con tu club) o 'seleccion' (partido con tu selección).
(function (root) {
  'use strict';

  const LEVELS = [
    // ---------- Temporada 1: club de tu país ----------
    {
      name: 'Primer tiro', stage: 'club',
      tip: 'Arrastra desde el jugador con la pelota hasta el aro y suelta. Después carga la fuerza y suelta en la zona verde.',
      players: [[180, 210]],
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
      tip: 'La pelota la tiene el base. Tu jugador espera libre: si un defensor está en la línea del pase, roba.',
      players: [[110, 250], [60, 480], [300, 240]],
      holder: 1,
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
      tip: 'Este defensor se mueve. Mira su recorrido antes de pasar; tu jugador espera a la izquierda.',
      players: [[100, 260], [180, 520], [270, 260]],
      holder: 1,
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
      name: 'El pívot', stage: 'club',
      tip: 'El pívot es más alto: roba los pases que pasan cerca de él, aunque no esté en la línea. Pasa lejos de él.',
      players: [[180, 540], [60, 360], [300, 360], [180, 230]],
      defenders: [{ x: 180, y: 420 }, { x: 90, y: 470, tall: true, reach: 36, block: 50 }],
    },
    {
      name: 'Presión', stage: 'club',
      tip: 'Dos defensores cubren el centro. Ábrete por las bandas y busca a tu jugador en la esquina.',
      players: [[60, 230], [180, 560], [50, 450], [310, 450], [300, 230]],
      holder: 1,
      defenders: [
        { x: 180, y: 380, path: [[180, 300]], speed: 90 },
        { x: 120, y: 250, path: [[240, 250]], speed: 160 },
        { x: 285, y: 205 },
      ],
    },
    {
      name: 'Zona', stage: 'club',
      tip: 'El pívot cierra la banda derecha con sus brazos largos. Hay un pase largo que nadie cubre: encuéntralo.',
      players: [[40, 560], [320, 540], [320, 330], [50, 330], [180, 200]],
      defenders: [
        { x: 180, y: 545 },
        { x: 180, y: 430, path: [[180, 280]], speed: 120 },
        { x: 210, y: 160 },
        { x: 290, y: 400, tall: true, reach: 36, block: 50 },
      ],
    },
    {
      name: 'Contraataque', stage: 'club',
      tip: 'Los defensores vuelven rápido. Juega antes de que lleguen y define con tu jugador.',
      players: [[180, 250], [180, 580], [70, 400], [290, 400]],
      holder: 1,
      defenders: [
        { x: 180, y: 120, path: [[180, 230]], speed: 120 },
        { x: 40, y: 330, path: [[320, 330]], speed: 200 },
      ],
    },
    {
      name: 'Final con la selección', stage: 'seleccion',
      tip: 'La final. Defensores en movimiento y un pívot plantado frente a tu jugador. El último tiro es tuyo.',
      players: [[180, 240], [60, 570], [300, 560], [300, 380], [60, 380]],
      holder: 1,
      defenders: [
        { x: 180, y: 560, path: [[180, 470]], speed: 110 },
        { x: 40, y: 470, path: [[320, 470]], speed: 180 },
        { x: 180, y: 300, path: [[100, 300], [260, 300]], speed: 140 },
        { x: 215, y: 205 },
        { x: 180, y: 350, tall: true, reach: 36, block: 50 },
      ],
    },
  ];

  if (typeof module !== 'undefined' && module.exports) module.exports = LEVELS;
  else root.LEVELS = LEVELS;
})(typeof window !== 'undefined' ? window : globalThis);
