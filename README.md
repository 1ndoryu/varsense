# VarSense

Validacion y gestion de variables CSS y clases con deteccion de tokens, orientado a disenos con convenciones de tokens (temas claros/oscuros, roles semanticos). Extension de VS Code, CLI y LSP con el mismo core editor-agnostico.

## Superficies

| Superficie | Descripcion |
|------------|-------------|
| **Extension VS Code** | Diagnostico en vivo, hover con preview de colores y autocompletado contextual |
| **CLI `varsense`** | `scan`, `orphan-classes` y `all` con salida Markdown/JSON |
| **LSP `varsense-lsp`** | Servidor stdio editor-agnostico; integrable en Zed u otros editores |

## CLI

```
varsense scan --workspace . --format markdown --output .varsense-report.md
varsense orphan-classes --workspace . --format json
varsense all --workspace . --format json
varsense --version
```

- `scan`: detecta variables no definidas, fallbacks hardcodeados, inline styles y propiedades prohibidas.
- `orphan-classes`: detecta clases CSS sin uso en el workspace con un indice compartido.
- `all`: ejecuta scan + orphan-classes en una sola pasada, compartiendo el snapshot de documentos y los indices de variables y clases.
- Salida JSON versionada (`schemaVersion: 1`) con conteos por severidad, apta para automatizacion y gates.
- Códigos de salida: `0` sin errores; `1` si hay hallazgos de severidad `error`; `2` por uso incorrecto, `--config` inexistente o agotamiento del tiempo.
- `--config <ruta>`: carga un `varsense.config.json` concreto. Si la ruta no existe, sale con código 2.
- `--files-from <ruta>`: limita los archivos reportados a un manifiesto de rutas relativas.
- `--index-dir <ruta>`: guarda el índice entre ejecuciones en ese directorio.
- `--max-hallazgos <n>` (`scan` y `all`): muestra como máximo `n` hallazgos; `0` (por defecto) no limita. Si recorta, el JSON añade `truncado` (con `hallazgosTotal` y `hallazgosOmitidos`) y el Markdown lo indica; los conteos siguen siendo los del análisis completo.
- `--timeout <segundos>`: límite del análisis (por defecto 600; `0` lo desactiva). Al agotarse, el análisis se cancela en sus puntos de control, sale con código 2 y muestra un mensaje en stderr.
- `--help` / `-h` y `--version`: muestran la ayuda o la versión y salen con código 0.
- Archivos de más de 2 MiB se omiten del análisis; el CLI avisa en stderr con sus rutas (hasta 5). La salida no cambia para el resto.

## Token detection

`all` incluye `tokenDetection` con hallazgos tipados:

- `token-duplicate`: el mismo token declarado con valores distintos.
- `token-unused`: tokens declarados que no se usan en ningun documento.
- `token-duplicado-cross-archivo`: un token repite el valor de otro declarado en un archivo distinto, con nombre similar (`src/core/analisis/tokenRules.ts`).

La severidad es independiente y configurable; los tokens se resuelven sobre la convencion declarada en `varsense.config.json`, sin imponer paleta, idioma ni nombres de variables.

## LSP stdio

El binario `varsense-lsp` publica diagnostics desde el mismo core que la extension y el CLI. Para integracion en Zed, usa `zed: install dev extension` y selecciona `integrations/zed`; el adaptador busca el LSP en este orden: variable de entorno `VARSENSE_LSP_PATH`, luego `varsense-lsp` en el PATH, y por último el `dist/` del checkout si Zed se abrió desde él.

Límites: el tope de 2 MiB por archivo (ver CLI) aplica aquí con un aviso informativo; el índice de contexto de la raíz tiene como máximo 60 s la primera vez (si no, se publica un error en el documento y el índice sigue construyéndose), y el análisis de un documento dura como máximo 10 s (si no, se cancela y se publica un error en el documento) y se muestran como máximo 500 diagnósticos por documento. Si el documento cambia o se cierra durante el análisis, el análisis en curso se cancela y su resultado se descarta.

## Instalacion

Hoy VarSense se instala compilando desde el checkout: `npm install` es el único paso (el script `prepare` compila `dist/`). Un artifact publicado que se instale sin compilar todavía no existe; su contrato, pendiente de implementar, está en `docs/artifact-contract.md`.

Requiere Node.js >= 20.19 (la suite de tests usa mocha 12). Instalación limpia probada con Node 22.23 en Linux. Windows no está en la matriz de pruebas: `npm install` y `npm run smoke:lsp` no se han verificado allí.

```
npm install                                    # instala y compila dist/ (script prepare)
npm run -s cli -- all --workspace . --format json # ejecuta la CLI desde dist/ (-s: stdout solo JSON)
npm run check:core                             # falla si src/core importa vscode o un built-in de Node (fs, path, crypto…)
npm run smoke:lsp                              # levanta el server stdio y verifica publishDiagnostics
```

Este es el único camino de instalación del CLI y del LSP. Los pasos siguientes son opcionales y no forman parte de él.

Otros scripts: `npm run compile:tests` (compila `dist/` y los tests), `npm run test:unit` (tests sin VS Code, con mocha), `npm run test:vscode` (tests dentro de VS Code; la primera vez descarga VS Code; en Linux sin escritorio necesita un servidor X en `DISPLAY`, p. ej. `DISPLAY=:99 TMPDIR=/var/tmp npm run quality:check`), `npm test` (compila los tests y ejecuta `test:vscode`), `npm run lint` (ESLint sobre `src`), `npm run check:zed` (cargo check del adaptador Zed, requiere el target `wasm32-wasip2`), `npm run smoke:cli`, `npm run smoke:persistent-index` y `npm run smoke:tramo4`.
Gate completo, igual que el CI: `xvfb-run -a npm run quality:check` (en Linux; `xvfb-run` aporta el servidor gráfico que necesitan los tests de VS Code). Ver [CONTRIBUTING](CONTRIBUTING.md).

Tras cambiar código, `npm run compile` regenera `dist/`. Los scripts `cli` y `lsp` no compilan: ejecutan `dist/` tal cual.
Opcional: para escribir `varsense` en lugar de `npm run -s cli --`, ejecuta `npm link`. Si tras enlazar `varsense` no se encuentra, el directorio de binarios globales de npm (`npm prefix -g` + `/bin`, o `\bin` en Windows) no está en el PATH: añádelo o sigue usando `npm run -s cli --`. Sin `-s`, npm imprime su cabecera (`> varsense@… cli`) en stdout y rompe el JSON.
Durante `npm install` pueden aparecer avisos `npm warn install-scripts` y avisos de dependencias obsoletas (`deprecated`); no impiden la instalación.

Extensión de VS Code (aparte del CLI): para instalar un `.vsix` ya empaquetado, `code --install-extension <ruta>.vsix`. El `.vsix` lo genera el mantenedor con `npm run package` (`vsce package`).

## Configuracion

`varsense.config.json` valida estrictamente sus claves; las desconocidas fallan. Permite severidades, allowedValues para hardcoded detection, exclusiones y la convencion de tokens del proyecto.

Cada entorno lee su propia fuente, y las dos se documentan aquí para no confundirlas:

| Entorno | Qué lee | Ejemplo |
|---|---|---|
| CLI y LSP (Zed u otro cliente LSP) | `varsense.config.json` del workspace (o `--config`) | `tokenDetection`, exclusiones |
| Extensión de VS Code | ajustes `cssVarsValidator.*` de VS Code | `cssVarsValidator.excludePatterns`, `cssVarsValidator.carrierPrefixes` |

Son dos mecanismos equivalentes para la misma funcionalidad, no un único archivo compartido: un cambio de convención en el JSON no altera los ajustes de la extensión y viceversa.

`tokenDetection.duplicate.excludeTokens` y `tokenDetection.unused.excludeTokens`
aceptan una lista de nombres de token (con o sin el prefijo `--`) que la regla
correspondiente ignora. Sirve para lo que la regla no puede deducir sola: en
`duplicate`, los roles de un tema que comparten valor a proposito (`--card` y
`--popover` valen lo mismo que `--background` para poder re-tematizarse por
separado); en `unused`, los tokens consumidos fuera del alcance analizado.

`buttonStyleDetection` configura la regla `estiloBotonEspecifico` (CSS de componente con clase tipo botón): `enabled`, `severity`, `componentFolder` (nombre de carpeta, sin `/`), `selectorPattern` y `excludeFilePattern` (expresiones regulares sin flags, sin distinguir mayúsculas; una regex inválida falla al cargar). Los valores por defecto son la convención del área (`components`, `btn|button`, `^button`). La extensión de VS Code no lee este bloque: aplica esos mismos defaults.

La misma regla acepta la forma del mensaje y las propiedades estructurales: `componentName` (identificador JSX, por defecto `Button`), `componentProps` (props que se sugieren, por defecto `variante`, `tamano`), `styleProperties` (propiedades CSS que cuentan como estructurales) y `minStyleProperties` (entero positivo, por defecto 2). Cada lista se valida al cargar y no puede estar vacía.

`tokenDetection.themeNamespaces` define los namespaces de tema de Tailwind v4 que reconoce `token-unused`: una lista de `{ "namespace": "--prefijo-", "utilities": ["clase", ...] }`. Sin configurar usa `--color-`, `--radius-` y `--font-` (los de Tailwind v4). El namespace debe tener la forma `--prefijo-`.

`tokenDetection.tailwindShorthand` (por defecto `true`) decide si el shorthand de Tailwind v4 `bg-(--x)` cuenta como uso de la variable `--x` en `token-unused`. Con `false` solo cuentan `var(--x)` y `getPropertyValue('--x')`.

`languages` indica qué identificadores de lenguaje analiza cada familia de regla: `css`, `react` (inline styles en JSX) y `script` (inline styles en TS/JS), más `cssExtensions` (extensiones que alimentan el índice de variables; por defecto `.css`). Una lista vacía desactiva esa familia en ese proyecto. Los defaults son los del core (`LENGUAJES_POR_DEFECTO`).

## Arquitectura

- `src/core/`: indexadores y reglas agnosticos (VariableIndex, ClassIndex, tokenRules) sin imports de VS Code ni de built-ins de Node (`fs`, `path`, `crypto`, `url`…, con o sin `node:`); `check:core` no admite excepciones. Lo que necesita disco o hash entra por puertos inyectados (p. ej. `PersistentIndexAdaptadores`).
- `src/node/`: adaptador Node (lectura de archivos y proveedores del workspace, carga de `varsense.config.json`, índice persistente en disco con hash SHA-256). Lo usan la CLI y el LSP; no importa `vscode`.
- Código que usa la API de VS Code: `src/extension.ts` y `src/vscode/` (providers, services, comandos, utils y `vscodeAdapter.ts`). Es la capa de la extensión, no del core; no se usa desde `src/cli/` ni `src/lsp/`.
- `src/cli/`, `src/lsp/`, `src/extension.ts`: adapters de presentacion sobre el mismo core.
- `src/test/suite/core/coreContracts*.test.ts` (3 partes): paridad core/CLI/LSP con fixtures versionadas.
