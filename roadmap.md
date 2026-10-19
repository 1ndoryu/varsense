# Roadmap — varsense

Meta activa: máxima calidad de VarSense (arquitectura, repo limpio, instalación, CLI, docs, agnosticismo, coherencia, autogate).
Orden de ejecución: de arriba abajo. Cada bloque: probar en la 89, documentar, commitear, cerrar en `Agente/completados/`.

## Pendiente

- [ ] **V2 Coherencia de docs.** `docs/artifact-contract.md` muestra versión 2.2.2 como ejemplo (el proyecto está en 2.2.9) y describe un flujo de artefacto no implementado. Alinear con lo real.
- [ ] **V3 Instalación en una vía.** `bin` apunta a `dist/`, que no existe tras `npm install`. Declarar `engines.node` y un único camino documentado (install + compile); valorar `prepare`.
- [ ] **V4 Dos pipelines de análisis.** La extensión usa `providers/diagnosticProvider.ts` + `parsers/cssParser.ts`; CLI y LSP usan `core/analyzeDocument.ts`. Unificar en un solo pipeline.
- [ ] **V5 Agnosticismo.** `core/classIndexBuilder.ts:721-726` fija el prefijo `clase*` del área; comentarios citan NAKOMI y `PanelRecordatorios.tsx`. `services/configService.ts:55-65` trae palabras clave en español por defecto. Pasar a configuración.
- [ ] **V6 Arquitectura.** `core/classIndexBuilder.ts` tiene 2974 líneas: partirlo por responsabilidad. Eliminar duplicación `utils/colorUtils.ts` vs `colorConversion`/`colorParsing`.
- [ ] **V7 Límites.** No hay timeout ni tamaño máximo de archivo en CLI ni LSP. Añadirlos y acotar la salida.
- [ ] **V8 CLI.** Un comando desconocido lanza el usage como error (`src/cli/index.ts:113`). `npm run cli` recompila en cada ejecución.
- [ ] **V10 Lint.** 3 warnings de `npm run lint`. Dejar a 0.
- [ ] **V9 Autogate.** Sin ficha de Arranque (noAplica sin-servicio). Gate vía `POST /api/gate/analizar` (`AGENTS-detalle.md:37`). Tests en la 89.

## Bloqueos
- Verificación en la 89: clon de `HEAD` en `/var/tmp/varsense-verify` (no toca `~/taller`). `npm test` necesita VS Code + xvfb: se verifica el pretest (compile, lint, check:core, smoke:lsp) y el smoke del artefacto.
- `vsce package` y publicación: reservado a la usuaria (AGENTS §3).

## Hecho
- V1 Higiene del repo (2026-10-19): `tsc_output.txt`, `reproduce_issue.js` fuera; `PLANIFICACION.md` a `Agente/planes/completados/`. Verificado en la 89: pretest completo en verde (compile, compile:tests, lint con 3 warnings, check:core, smoke:lsp OK).
