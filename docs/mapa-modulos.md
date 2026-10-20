# Mapa de módulos y ficheros de configuración

Mapa de capas de `src/` y de los ficheros de configuración de la raíz. Las reglas de dependencia se verifican con `npm run check:core` (script `scripts/check-core-no-vscode.mjs`); lo demás es convención revisada en código.

## Capas

| Capa | Ruta | Puede importar | No puede importar |
|---|---|---|---|
| Core | `src/core/` | `src/core/` y tipos de `src/types/` | `vscode`, built-ins de Node (`fs`, `path`, `crypto`, `url`…, con o sin `node:`) |
| Adaptador Node | `src/node/` | core, built-ins de Node | `vscode` |
| CLI | `src/cli/` | core, `src/node/`, `src/parsers/`, `src/configuracion/` | `vscode` (verificado: `dist/cli` no contiene `require('vscode')`) |
| LSP | `src/lsp/` | core, `src/node/`, `src/parsers/`, `src/configuracion/` | `vscode` |
| Parsers CSS | `src/parsers/` | core, `src/types/`, `src/utils/color/` (utilidades puras de color) | `vscode` |
| Extensión VS Code | `src/extension.ts`, `src/providers/`, `src/services/`, `src/comandos/`, `src/utils/`, `src/vscode/` | todo lo anterior y `vscode` | — |

Notas:

- `src/services/` (`variableScanner`, `classScanner`, `variableResolver`) y `src/comandos/` son la capa de la extensión. La CLI no los usa: `scan`, `orphan-classes` y `all` componen los índices en `src/cli/analisis/objetivos.ts`.
- `src/utils/` mezcla utilidades de editor (`documentUtils.ts`, `positionUtils.ts`) con utilidades puras; por eso no se considera core.
- Las pruebas de paridad core/CLI/LSP viven en `src/test/suite/core/coreContracts*.test.ts` y `src/test/suite/integracion/`.

## Ficheros de configuración de la raíz

| Fichero | Quién lo lee | Uso |
|---|---|---|
| `esbuild.config.mjs` | `package.json` (`compile`, `compile:tests`, `watch`); `prepare` y `vscode:prepublish` llaman a `compile`; CI vía `npm ci` y `quality:check` | Vivo y explícito. No mover sin ajustar `package.json`. |
| `varsense.config.json` | El propio producto, por nombre, desde la raíz del workspace: `src/cli/configuracion.ts` y `src/lsp/server.ts`. `scripts/smoke-lsp-stdio.mjs` abre un documento con la raíz como workspace, dentro de `quality:check` | Vivo, por convención de nombre. No mover: cambiaría el comportamiento del LSP en la raíz. |
| `sentinel.config.json` | Sentinel, por nombre por defecto (si falta, usa `{}` y se pierde `mode: enforce`). Su patrón `tooling` cita `/esbuild.config.mjs` | Vivo, por convención de herramienta. No borrar sin fijar el modo. |
| `quality-tools.json` | Sentinel `doctor`, por nombre. Lo cita también `docs/artifact-contract.md`, como superficie legacy de Sentinel | Vivo por convención. Retirable cuando Sentinel deje de necesitarlo; ir junto con `sentinel.lock.json`. |

## Decisiones

- **Mensajes en español sin i18n (G3).** Los mensajes de la extensión y de la CLI están escritos directamente en español. Es la decisión para este proyecto: un único idioma de producto, sin capa de traducción que mantener. Si algún día hay un segundo idioma, la extracción de cadenas se hace entonces.
- **`varsense.config.json` y ajustes de VS Code son mecanismos distintos** (ver README, sección Configuración). No se unifican.
