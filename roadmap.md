# Roadmap — varsense

Meta activa: máxima calidad de VarSense (arquitectura, repo limpio, instalación, CLI, docs, agnosticismo, coherencia, autogate).
Orden de ejecución: de arriba abajo. Cada bloque: probar en la 89, documentar, commitear, cerrar en `Agente/completados/`.

## Pendiente

- [ ] **V5 Agnosticismo.** `core/classIndexBuilder.ts:721-726` fija el prefijo `clase*` del área; comentarios citan NAKOMI y `PanelRecordatorios.tsx`. `services/configService.ts:55-65` trae palabras clave en español por defecto. Pasar a configuración.
- [ ] **V6 Arquitectura.** `core/classIndexBuilder.ts` tiene 2974 líneas: partirlo por responsabilidad. Eliminar duplicación `utils/colorUtils.ts` vs `colorConversion`/`colorParsing`.
- [ ] **V7 Límites.** No hay timeout ni tamaño máximo de archivo en CLI ni LSP. Añadirlos y acotar la salida.
- [ ] **V9 Autogate.** Sin ficha de Arranque (noAplica sin-servicio). Gate vía `POST /api/gate/analizar` (`AGENTS-detalle.md:37`). Tests en la 89.

## Bloqueos
- Verificación en la 89: clon de `HEAD` en `/var/tmp/varsense-verify` (no toca `~/taller`). `npm test` necesita VS Code + xvfb: se verifica el pretest (compile, lint, check:core, smoke:lsp) y el smoke del artefacto.
- `vsce package` y publicación: reservado a la usuaria (AGENTS §3).

## Hecho
- V4 Dos pipelines de análisis (2026-10-19): V4.1 regla de botón en el core; V4.2 la extensión delega en `analyzeVarsenseDocument` y se eliminan los detectores duplicados. Verificado en la 89 (ver `Agente/completados/tareas-2026-10-19.md`). Cambio visible: mensajes de diagnóstico del core.
- V1 Higiene del repo (2026-10-19): `tsc_output.txt`, `reproduce_issue.js` fuera; `PLANIFICACION.md` a `Agente/planes/completados/`. Verificado en la 89: pretest completo en verde (compile, compile:tests, lint con 3 warnings, check:core, smoke:lsp OK).
- V2 Coherencia de docs, V3 Instalación en una vía, V8 CLI y V10 Lint (2026-10-19): contrato del artefacto marcado como no implementado con versión de ejemplo genérica; `engines.node >=18`, `prepare` compila dist/, scripts `cli`/`lsp` sin recompilar; comando desconocido da una línea y rc 2; lint a 0 warnings. Verificado en la 89 (`/var/tmp/varsense-verify`): npm ci, compile, compile:tests, lint 0/0, check:core, smoke:lsp, `--help` rc 0, comando inexistente rc 2.
