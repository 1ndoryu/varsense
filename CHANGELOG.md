# Changelog

Todos los cambios notables de este proyecto serán documentados en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es/1.0.0/),
y este proyecto adhiere a [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.2] - 2026-09-14

### Agregado
- [149A-1 F3.11] `orphan-plantilla-resuelta`: `claseHuerfana` resuelve
  expresiones exactas antes de marcar (concatenacion `'pref-' + ident`,
  templates anidados, ternarios compuestos) con evaluador fail-closed
  (literales/identificadores declarados/ternarios; llamadas, miembros y
  desconocidos no resuelven). Solo añade tokens de uso: 0 FP por
  construccion. Tope `MAX_COMBINACIONES_CLASE_EXACTA=25`.
- [149A-1 F3.13] `todo-prosa-sin-marcador` (`todoProsaSinMarcador`,
  warning, `todoProseDetection` en `varsense.config.json`): exige marcador
  `TODO:`/`TODO(`/`FIXME`/`XXX` en comentarios; no marca prosa española
  con articulo (`el|la|los|las|lo`), cuantificador minusculo en ultima
  posicion (caso real `persistentIndex` "re-parsear todo."), strings, URLs
  ni compuestos (`todo-list`); `TODO` mayusculo solo si marca (se exige
  `TODO:`). H11: 0 hits en self-scan tras las guardas.
  Enganche verificado en `analyzeDocument` (opcion A del plan; sin
  fallback a sentinel).
- [149A-1 F3.15] `duplicado-cross-crate`
  (`token-duplicado-cross-archivo`, information escalable a warning,
  `tokenDetection.crossFile` en `varsense.config.json`): mismo valor en
  archivos distintos con similitud de nombres Levenshtein >= 0.75, mensaje
  con ambas rutas y similitud. `token-duplicate` (same-file, 318A-7V8)
  intacto; overrides de cascada (mismo nombre) no marcan. Tope
  `MAX_HALLAZGOS_CROSS_FILE=25`.
- [149A-1 F3.12] Opcion `hardcodedDetection.severity` (default `warning`
  intacto, 089A-3): solo cambia la severidad del finding core cuando el
  proyecto la fija. Sin `DiagnosticType` nuevo.

### Aparcado
- [149A-1 F3.14] `ui-fanout-directorio` aparcada (escalera H11): el plan
  solo fija la politica de excepcion y el modelo de diagnosticos de
  VarSense es por documento sin agregacion por directorio; inventar la
  semantica (umbral, alcance, ancla) seria alcance no pedido con riesgo
  de ruido. Reabrir con semantica explicita si el gate lo requiere.

### Verificado
- `coreContracts`: 54 pruebas PASS (39 previas + 15 [149A-1]).
- Precision H11: self-scan del repo sin falsos positivos en las reglas
  nuevas (ver evidencia en commit).

## [2.2.1] - 2026-08-11

### Mejorado
- El índice de clases reutiliza un único recorrido del workspace para todos los patrones de consumidores.
- El provider Node cachea snapshots por exclusiones durante una ejecución CLI, reduciendo el coste cold sin cambiar los hallazgos.

### Verificado
- Suite upstream: 61 pruebas PASS.
- Benchmark sobre `glory-rust-template`: cold ~3.3 s y warm ~2.8 s, por debajo del presupuesto de 6 s.

## [2.2.0] - 2026-07-29

### Agregado
- Validación estricta de `varsense.config.json` y salida JSON versionada con conteos por severidad.
- Detección de estilos inline en Vanilla TypeScript/JavaScript.
- `--help` y `--version` aptos para automatización.
- Subcomando `all` que combina scan + orphan-classes en una sola pasada con snapshot compartido.
- `tokenDetection` con hallazgos `token-duplicate` y `token-unused`.

### Corregido
- `orphan-classes` respeta una severidad configurable y devuelve fallo cuando existen huérfanos configurados como `error`.

## [2.0.1] - 2026-05-08

### Agregado
- **CLI editor-agnóstico**: nuevo binario `varsense` con `scan` y `orphan-classes`, usando los mismos indexadores y contratos core que la extensión.
- **LSP stdio**: nuevo binario `varsense-lsp` que publica diagnostics desde el core para editores compatibles.
- **Integración Zed dev**: nueva carpeta `integrations/zed/` con adaptador Rust/WASM que registra `varsense-lsp` para CSS/SCSS/LESS/TSX/JSX/TS/JS sin duplicar reglas.
- **Tareas Zed**: `.zed/tasks.json` permite ejecutar reportes CLI desde Zed.
- **Reporte Markdown/JSON desde Node**: `scan` puede escribir `.varsense-report.md` o imprimir JSON estructurado sin depender de VS Code.
- **Fixtures de equivalencia**: casos versionados que comparan hallazgos core vs CLI para `scan` y `orphan-classes`.

### Mejorado
- **Build dual extension/CLI**: esbuild genera `dist/extension.js` y `dist/cli/index.js`, evitando fugas de aliases `@/` en runtime.
- **Boundary CLI/LSP**: los defaults de analisis viven en `core/config`, evitando que el LSP importe o ejecute el entrypoint CLI al bundlear.
- **Smoke LSP stdio**: `npm test` ejecuta `npm run smoke:lsp` para confirmar que `dist/lsp/server.js --stdio` publica diagnostics reales.
- **Guard de core editor-agnóstico**: `npm test` ejecuta `check:core` y falla si `src/core/**` importa `vscode` fuera del adaptador permitido.

## [2.0.0] - 2026-02-16

### Agregado
- **Comando scanAllDiagnostics**: Escaneo completo del workspace (archivos abiertos y cerrados) para CSS/SCSS/LESS/TSX/JSX.
- **Progreso con conteo real**: Durante el escaneo global se muestra avance por archivo (`actual/total`).
- **Reporte detallado por archivo**: Nuevo resumen en OutputChannel `CSS Vars Validator` con severidades y ejemplos por línea.
- **Navegación por Quick Pick**: Desde el resultado del escaneo se puede abrir rápidamente cualquier archivo con problemas.
- **Comando autoFixAllCss**: Aplicación masiva de quick fixes para diagnósticos soportados en CSS/SCSS/LESS.
- **Resultado estructurado de escaneo**: Nuevo objeto `ResultadoEscaneoProyecto` con métricas globales y por archivo.

### Mejorado
- **Detección cross-file de clases duplicadas**: Integrada con índice de clases en scanner y diagnóstico con referencia a archivo/línea original.
- **Detección inline en React**: Validación para `style={{...}}` y `style={variable}` en TSX/JSX con severidad configurable.
- **Validación de scope local**: Variables definidas en el mismo archivo se consideran válidas para evitar falsos positivos.

## [1.0.0] - 2026-02-03

### Agregado
- **Detección de variables no definidas**: Marca como error cuando se usa `var(--nombre)` y la variable no está definida en ningún archivo de variables configurado.
- **Detección de valores hardcodeados**: Identifica valores literales en propiedades configurables (font-size, color, etc.) que deberían usar variables CSS.
- **Detección de fallbacks hardcodeados**: Marca fallbacks como `var(--color, #fff)` cuando contienen valores literales.
- **Hover con información de variable**: Al posicionar el cursor sobre una variable CSS muestra:
  - Valor definido
  - Valor resuelto (si referencia otras variables)
  - Preview de color (si aplica)
  - Archivo y línea de definición
- **Autocompletado contextual**: Sugiere variables basadas en la propiedad CSS actual con ordenamiento por frecuencia de uso.
- **Quick fixes**: Sugerencias automáticas para corregir variables no definidas y reemplazar valores hardcodeados.
- **Comando: Refrescar Variables**: Re-escanea todos los archivos de variables manualmente.
- **Comando: Mostrar Todas las Variables**: Lista todas las variables en un Quick Pick para búsqueda rápida.
- **Comando: Ir a Definición**: Navega directamente a la definición de una variable.
- **Sistema de caché**: Optimización de rendimiento con caché de variables y actualización incremental.
- **Watchers de archivos**: Actualización automática cuando se modifican archivos de variables.
- **Configuración completa**: Todas las funcionalidades son configurables vía settings.json.

### Configuración Inicial
- Patrones de archivos de variables configurables
- Propiedades CSS a verificar por hardcoded configurables
- Lista de valores permitidos personalizable
- Mapeo de sugerencias contextuales configurable
- Patrones de exclusión configurables

### Lenguajes Soportados
- CSS
- SCSS
- LESS
- Vue (sección style)

## [Próximamente]

### Planeado
- [ ] Soporte para variables SCSS (`$variable`)
- [ ] Definition provider (Ctrl+Click para ir a definición)
- [ ] Rename provider (renombrar variable en todo el proyecto)
- [ ] Code lens con número de usos
- [ ] Panel lateral con árbol de variables
- [ ] Exportar variables a JSON/TypeScript
- [ ] Análisis de variables no utilizadas
- [ ] Sugerencias de agrupación de variables
