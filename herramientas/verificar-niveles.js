// Verifica que todos los niveles tengan solución y muestra qué tan difíciles son.
// Solo prueba jugadas de pases; conducir la pelota puede abrir otros caminos.
// Uso: node herramientas/verificar-niveles.js
const path = require('path');
const Engine = require(path.join(__dirname, '..', 'prototipo', 'engine.js'));
const LEVELS = require(path.join(__dirname, '..', 'prototipo', 'levels.js'));

let errors = 0;
LEVELS.forEach((lv, i) => {
  const s = Engine.solve(lv);
  const direct = Engine.simulate(lv, [0, 'H']);
  const best = s.best ? s.best.chain.join('→') : 'SIN SOLUCIÓN';
  console.log(
    `${String(i + 1).padStart(2)} ${lv.name.padEnd(24)} jugadas que funcionan ${String(s.wins).padStart(3)} de ${String(s.total).padEnd(4)} ` +
    `mín. movimientos ${s.minMoves ?? '-'}  mejor ${best.padEnd(12)} tiro directo: ${direct.ok ? 'entra' : direct.reason}`
  );
  if (!s.best) errors++;
});
if (errors) {
  console.error(`\n${errors} nivel(es) sin solución`);
  process.exit(1);
}
console.log('\nTodos los niveles tienen solución.');
