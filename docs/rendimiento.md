# Rendimiento de `varsense all`

Medición de `PERF-1` (2026-10-19) en el VPS 89, con el CLI compilado (`npm run compile`) y sin caché persistente reutilizable (cada ejecución reanaliza).

| Workspace | Archivos | Total | `variableIndexMs` | `classIndexMs` | `analyzeMs` |
|---|---|---|---|---|---|
| MN-Inmobiliaria | 399 | ~880–930 ms | 130–170 | 650–870 | 40–50 |
| NAKOMI | 1040 | ~1400–2000 ms | 100–200 | 1090–1320 | 130–690 |

`classIndexMs` es la fase dominante (70–75 % del total). Las cifras varían entre ejecuciones por carga de la 89.

## Perfil de CPU (NAKOMI, `--cpu-prof`)

Autoconsumo principal: el propio binario minificado (~265 ms), recolección de basura (~160 ms), y regex de `classIndex` con alternancias `[Cc]lase[\w$]*` y `[\w$]*[Cc]lass` (~70 + 57 + 35 ms). Una regex de salto de línea `\r\n|\r|\n` aparece con ~150 ms de autoconsumo, pero su origen no se ha atribuido.

## Lo que se probó y no compensó

- `positionAtOffset` con separadores precalculados por documento (búsqueda binaria): semánticamente igual (comparado con la implementación previa en todos los offsets) pero sin ganancia medible en `classIndexMs` ni en el total. Se descartó y no se añadió al código.

## Pendiente de medir

Atribuir el coste de `classIndexMs` a sus patrones (`fuentes/` y `consumo/`) con el perfil ya tomado, antes de tocar regex. Cualquier cambio debe probar ganancia con la misma medición (2 ejecuciones por workspace, 89).
