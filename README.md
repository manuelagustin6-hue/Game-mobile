# Jugada Maestra

Juego móvil de básquet por niveles. En cada nivel el jugador arma la jugada movimiento a movimiento
(pase, conducción o tiro) hasta convertir, esquivando defensores (entre ellos pívots de alcance mayor). Crea su propio jugador
estrella, ficha por clubes de distintos países y es convocado por la selección de su nacionalidad.

Pensado para publicarse en la App Store y Google Play con anuncios (recompensados y entre niveles) y una
compra única premium (sin anuncios, vidas infinitas, extras).

## Estructura

| Carpeta / archivo | Qué es |
| --- | --- |
| `prototipo/index.html` | Interfaz del juego (pantallas, estilos, ventanas). |
| `prototipo/game.js` | Flujo del juego: progreso, vidas, monedas, anuncios y premium simulados, creador de jugador, niveles, partida. |
| `prototipo/engine.js` | Reglas: simula cada movimiento (pase, conducción, tiro) y busca soluciones de un nivel. No dibuja nada. |
| `prototipo/levels.js` | Niveles como datos (jugadores, defensores con rutas o pívots, pistas). |
| `prototipo/scene3d.js`, `prototipo/players3d.js` | Escena 3D (estadio, cancha, cámara) y jugadores 3D, con Three.js. |
| `prototipo/vendor/` | Three.js (build UMD, licencia MIT). |
| `herramientas/verificar-niveles.js` | Comprueba que todos los niveles tengan solución y muestra su dificultad. |

## Probarlo

```bash
cd prototipo && python3 -m http.server 8765
# abrir http://localhost:8765/ en el navegador (ideal con la vista de móvil)
```

Verificar los niveles:

```bash
node herramientas/verificar-niveles.js
```

## Hoja de ruta

1. Prototipo jugable en el navegador (este repositorio).
2. Más mundos y niveles, editor de niveles.
3. App nativa con Capacitor; anuncios con AdMob; compras con RevenueCat.
4. Arte definitivo (modelos 3D y animaciones) y publicación en las tiendas.
