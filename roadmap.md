# Roadmap — varsense

Meta activa: máxima calidad de VarSense (arquitectura, repo limpio, instalación, CLI, docs, agnosticismo, coherencia, autogate).
Orden de ejecución: de arriba abajo. Cada bloque: probar en la 89, documentar, commitear, cerrar en `Agente/completados/`.

## Pendiente

- [ ] **V7 Límites.** No hay timeout ni tamaño máximo de archivo en CLI ni LSP. Añadirlos y acotar la salida.

## Bloqueos
- Verificación en la 89: clon de `HEAD` en `/var/tmp/varsense-verify` (no toca `~/taller`). `npm test` necesita VS Code + xvfb: se verifica el pretest (compile, lint, check:core, smoke:lsp) y el smoke del artefacto.
- `vsce package` y publicación: reservado a la usuaria (AGENTS §3).

## Hecho
- V6 Arquitectura (2026-10-19): `core/classIndexBuilder.ts` pasa de 2989 líneas a un barrel de re-exports; la clase queda en `core/classIndex/builder.ts` (380 líneas) y los auxiliares en `core/classIndex/` (15 módulos por responsabilidad, incluido `carga.ts` con las cachés explícitas). Sin cambio de comportamiento: diferencial `orphan-classes` idéntico salvo `durationMs` y el número de archivos del árbol. Color: no había duplicación; `utils/colorUtils.ts` es barrel de `colorConversion`/`colorParsing` con 6+ importadores y se mantiene.
- V5 Agnosticismo (2026-10-19): prefijos portadores configurables (`prefijosPortadores` en CLI, `cssVarsValidator.carrierPrefixes` en la extensión); el core no asume `clase`; sugerencias contextuales sin palabras en español en el código. Verificado en la 89; gate Sentinel `--cierre` 0 nuevos. Test `coreContracts` actualizado, no ejecutado (requiere VS Code).
- V9 Autogate (2026-10-19): `varsense.config.json` excluye `fixtures/` y `src/test/` (código de prueba con CSS inline intencionado). Autogate `all` en la 89: 0 errores, 0 warnings, 80 archivos (antes 11 errores, 5 warnings). Gate Sentinel: base 53, cierre 0 nuevos.
- V4 Dos pipelines de análisis (2026-10-19): V4.1 regla de botón en el core; V4.2 la extensión delega en `analyzeVarsenseDocument` y se eliminan los detectores duplicados. Verificado en la 89 (ver `Agente/completados/tareas-2026-10-19.md`). Cambio visible: mensajes de diagnóstico del core.
- V1 Higiene del repo (2026-10-19): `tsc_output.txt`, `reproduce_issue.js` fuera; `PLANIFICACION.md` a `Agente/planes/completados/`. Verificado en la 89: pretest completo en verde (compile, compile:tests, lint con 3 warnings, check:core, smoke:lsp OK).
- V2 Coherencia de docs, V3 Instalación en una vía, V8 CLI y V10 Lint (2026-10-19): contrato del artefacto marcado como no implementado con versión de ejemplo genérica; `engines.node >=18`, `prepare` compila dist/, scripts `cli`/`lsp` sin recompilar; comando desconocido da una línea y rc 2; lint a 0 warnings. Verificado en la 89 (`/var/tmp/varsense-verify`): npm ci, compile, compile:tests, lint 0/0, check:core, smoke:lsp, `--help` rc 0, comando inexistente rc 2.
