# Rendimiento de `varsense all`

Medición del 2026-10-19 en el VPS 89, con el CLI compilado (`npm run compile`) y sin caché persistente reutilizable (cada ejecución reanaliza).

Proyectos medidos y anonimizados: A y B.

Rutas de las tablas y del perfil: `consumo/`, `fuentes/` y `classIndex/` son relativas a `src/core/indices/classIndex/`; `types.ts` (`positionAtOffset`) es `src/core/types.ts`; `@/` es el alias de `src/`.

| Workspace | Archivos | Total | `variableIndexMs` | `classIndexMs` | `analyzeMs` |
|---|---|---|---|---|---|
| Proyecto A | 399 | ~880–930 ms | 130–170 | 650–870 | 40–50 |
| Proyecto B | 1040 | ~1400–2000 ms | 100–200 | 1090–1320 | 130–690 |

`classIndexMs` es la fase dominante (70–75 % del total). Las cifras varían entre ejecuciones por carga de la 89.

## Perfil de CPU (Proyecto B, `--cpu-prof`)

Autoconsumo principal: el propio binario minificado (~265 ms), recolección de basura (~160 ms), y regex de `classIndex` con alternancias `[Cc]lase[\w$]*` y `[\w$]*[Cc]lass` (~70 + 57 + 35 ms). Una regex de salto de línea `\r\n|\r|\n` aparece con ~150 ms de autoconsumo, pero su origen no se ha atribuido.

## Lo que se probó y no compensó

- `positionAtOffset` con separadores precalculados por documento (búsqueda binaria): semánticamente igual (comparado con la implementación previa en todos los offsets) pero sin ganancia medible en `classIndexMs` ni en el total. Se descartó y no se añadió al código.

## Atribución de `classIndexMs` (PERF-1, 2026-10-19)

Método: `tsc` (sin minificar) en la 89, `node -r` con un hook que resuelve `@/` a `dist/`, `--cpu-prof` sobre `dist/cli/main.js all`, sin caché. Cada sample se atribuye al archivo fuente de quien lo ejecuta; una regex nativa cuenta para la función JS que la llama. Dos ejecuciones por workspace (run 2 mostrada):

| Workspace | `classIndexMs` (wall) | CPU en `consumo/` | CPU en `fuentes/` | CPU en otros `classIndex/` | CPU total |
|---|---|---|---|---|---|
| Proyecto A | 679 ms | 280 ms | 133 ms | 20 ms | 1046 ms |
| Proyecto B | 1238 ms | 497 ms | 207 ms | 83 ms | 2125 ms |

Dentro de `classIndex` domina `consumo/` (~63 %). Los puntos calientes son:

- `consumo/consumidores.ts` `extraerTokensDeTexto` (línea 187): regex propias, 84 ms en A y 219 ms en B.
- `consumo/llamadas.ts` `cuerpoDeFuncionEn` (línea 83): 80–108 ms de autoconsumo, más 23–27 ms de regex.
- `consumo/consumidores.ts` `removeComments` y `enmascararComentarios`: 24–50 ms cada uno.
- `fuentes/carriers.ts` (`escanearPushs`, `escanearAsignacionesCompuestas`) y `fuentes/mapasJs.ts` (`escanearDeclaraciones`): 20–40 ms cada uno.

Fuera de `classIndex`: `types.ts` `positionAtOffset` (regex `\r\n|\r|\n`, 168 ms en B) lo usan los parsers CSS y `analyzeDocument`, no `classIndex`; por eso no entra en `classIndexMs`. Sobre ese punto ya se midió una alternativa sin ganancia (ver arriba).

Del tiempo total de proceso, ~300–450 ms son `(idle)` (espera de E/S al listar y leer archivos), no CPU.

Criterio para cambios: cualquier cambio de regex en `consumo/` o `fuentes/` debe medirse con el mismo método (2 ejecuciones por workspace en la 89) y mostrar ganancia en `classIndexMs`; sin ganancia, no se commitea.
