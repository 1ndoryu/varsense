# Plan: hallazgos de la revisión y prueba de instalación (2026-10-19)

Origen: prueba de instalación como tercero (VarSense PASA) y revisión de diez puntos (ver `Agente/completados/tareas-2026-10-19.md` al cerrar). Este plan es la lista viva: cada casilla se marca al cerrarse.

## Corregir ahora

- [x] **LSP rendimiento.** `src/lsp/server.ts`: el índice de variables se reconstruye en cada validación (`buildVariableIndex`), sin debounce y sin reutilizar nada. Cachear por raíz con invalidación al cambiar archivos, y agrupar validaciones seguidas (debounce corto). Criterio: dos validaciones seguidas no reconstruyen el índice; resultados idénticos.
- [x] **LSP config.** `src/lsp/server.ts`: el LSP ignora `varsense.config.json` (`buildAnalysisConfig({})`). Leer el mismo archivo que la CLI (prefijos portadores, exclusiones, severidades). Criterio: un `varsense.config.json` con `prefijosPortadores` cambia el diagnóstico en LSP igual que en CLI.
- [x] **CLI `--config` inexistente.** `src/cli/index.ts:90-92` ignora la ruta en silencio. Debe salir con rc 2 y un mensaje claro en stderr.
- [x] **CLI `scan --help`.** `src/cli/args.ts:105-107` sale con rc 2. Debe salir con rc 0 y la ayuda en stdout.
- [ ] **README: opciones CLI.** `README.md:26`: documentar exit 1, `--config`, `--files-from`, `--index-dir` y la regla `token-duplicado-cross-archivo` (`src/core/tokenRules.ts:118`).
- [ ] **README: claim core.** `README.md:70` dice «sin imports de VS Code»; el código tiene la excepción `src/core/vscodeAdapter.ts`. Corregir la frase con esa excepción nombrada.
- [ ] **README: orden de búsqueda Zed.** `README.md:40`: el código busca primero `VARSENSE_LSP_PATH` (`integrations/zed/src/lib.rs:56-69`). Documentarlo.
- [ ] **README: instalar el .vsix.** Añadir cómo instalar una extensión ya empaquetada (sin `vsce package`, reservado a la usuaria). Anotar que `npm link` es necesario para el comando `varsense` (`README.md:55`), y los avisos `npm warn install-scripts` (`README.md:49-51`).
- [ ] **README: Node.** `README.md:46` dice >= 18; probado solo con Node 24. Anotarlo como no verificado en 18 o probarlo en la 89 con node 18.
- [ ] **Scripts sin README.** `check:zed`, `smoke:persistent-index`, `smoke:tramo4`, `compile:tests`, `lint` no aparecen en el README: añadirlos a la sección de instalación.
- [ ] **Skill varsense.** `~/.agents/skills/varsense/SKILL.md` (fuera del repo): refs de línea antiguas, `PARSER_VERSION 5` (código: 9), claves de config, `--timeout`, aviso de 2 MiB, `estiloBotonEspecifico`, `token-duplicado-cross-archivo`.

## Anotado para después (no se toca en este bloque)

- [ ] **Agnosticismo.** El core asume React/JSX, Tailwind (`src/core/usoVariables.ts:2`), botón fijo `<Button variante tamano>` (`src/core/reglasBotonCss.ts:58`, siempre activo: `src/core/analyzeDocument.ts:300`) y el prefijo `clase` (`src/core/config.ts:57`). Mover a configuración. Requiere diseño: decisión de la usuaria si cambia el comportamiento por defecto.
- [ ] **SOLID.** `src/core/vscodeAdapter.ts` dentro de core (exención nombrada en `scripts/check-core-no-vscode.mjs`). Tamaños: `src/extension.ts` 623, `src/cli/index.ts` 516, `src/parsers/cssParser.ts` 438, `src/providers/diagnosticProvider.ts` 340 líneas efectivas. Dividir por responsabilidad.
- [ ] **Repo.** `sentinel.config.json` sin consumidor; `roadmap.md` y `Agente/completados/tareas-2026-10-19.md` versionados (decidir si se quedan). Confirmar cuál es el alcance público del repo.
- [ ] **Core importa parsers.** `src/core/variableIndexBuilder.ts:2`, `src/core/analyzeDocument.ts:2-3` importan `@/parsers`. Decidir si los parsers son core o adapter.
- [ ] **Extensión vs CLI en configuración.** La extensión lee settings de VS Code (`src/services/configService.ts:12,216`); la CLI y ahora el LSP leen `varsense.config.json`. Documentar la correspondencia.
- [ ] **Optimización CLI.** `scan` (`src/cli/index.ts:219`) sin caché de provider, relee scripts (245-259), `filtrarClasesSuprimidas` lee disco directo (303). Autogate: `classIndexMs` 1163 de 1224 ms.
- [ ] **Persistencia.** `docs/artifact-contract.md` dice que la identidad incluye plataforma y dependencias; `src/core/persistentIndex.ts:97-101` no. Corregir doc o código.
- [ ] **Roadmap desfasado.** Decisión: no tocar en este bloque.

## Decidido por la usuaria (pendiente)

- Ninguno en VarSense.
