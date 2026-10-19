# Roadmap — varsense

Meta activa: máxima calidad de VarSense (arquitectura, repo limpio, instalación, CLI, docs, agnosticismo, coherencia, autogate).
Orden de ejecución: de arriba abajo. Cada bloque: probar en la 89, documentar, commitear, cerrar en `Agente/completados/`.

## Pendiente

- [ ] **V1 Higiene del repo.** Quitar `tsc_output.txt` (obsoleto) y `reproduce_issue.js` (depuración suelta). Mover `PLANIFICACION.md` a `Agente/planes/completados/` y quitar sus referencias en `.vscodeignore`. Añadir `.varsense-report.md` a `.gitignore`.
- [ ] **V2 Coherencia de docs.** `docs/artifact-contract.md` muestra versión 2.2.2 como ejemplo (el proyecto está en 2.2.9); el flujo de artefacto que describe no existe tal cual. Alinear con lo real.
- [ ] **V3 Instalación en una vía.** `bin` apunta a `dist/`, que no existe tras `npm install`. Declarar `engines.node` y un único camino documentado (install + compile); valorar `prepare`.
- [ ] **V4 Dos pipelines de análisis.** La extensión usa `providers/diagnosticProvider.ts` + `parsers/cssParser.ts`; CLI y LSP usan `core/analyzeDocument.ts`. Unificar en un solo pipeline.
- [ ] **V5 Agnosticismo.** `core/classIndexBuilder.ts:721-726` fija el prefijo `clase*` del área, y los comentarios citan NAKOMI y `PanelRecordatorios.tsx`. `services/configService.ts:55-65` trae palabras clave en español por defecto. Pasar todo a configuración.
- [ ] **V6 Arquitectura.** `core/classIndexBuilder.ts` tiene 2974 líneas: partirlo por responsabilidad. Eliminar duplicación `utils/colorUtils.ts` vs `colorConversion`/`colorParsing`.
- [ ] **V7 Límites.** No hay timeout ni tamaño máximo de archivo en CLI ni LSP. Añadirlos y acotar la salida.
- [ ] **V8 CLI.** Un comando desconocido lanza el usage como error (`cli/index.ts:113`). `npm run cli` recompila en cada ejecución (`package.json`).
- [ ] **V9 Autogate.** Sin ficha de Arranque (noAplica sin-servicio). Gate vía `POST /api/gate/analizar` (`AGENTS-detalle.md:37`). Tests solo en la 89.

## Bloqueos
- Tests en la 89: sin réplica Mutagen en `~/taller`. Se verifica con clon en `/var/tmp` de la 89 desde `origin`.
- `vsce package` y publicación: reservado a la usuaria (AGENTS §3).
