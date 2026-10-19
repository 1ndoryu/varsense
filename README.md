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
- `--timeout <segundos>`: límite del análisis (por defecto 600; `0` lo desactiva). Al agotarse, sale con código 2 y un mensaje en stderr.
- Archivos de más de 2 MiB se omiten del análisis; el CLI avisa en stderr con sus rutas (hasta 5). La salida no cambia para el resto.

## Token detection

`all` incluye `tokenDetection` con hallazgos tipados:

- `token-duplicate`: el mismo token declarado con valores distintos.
- `token-unused`: tokens declarados que no se usan en ningun documento.

La severidad es independiente y configurable; los tokens se resuelven sobre la convencion declarada en `varsense.config.json`, sin imponer paleta, idioma ni nombres de variables.

## LSP stdio

El binario `varsense-lsp` publica diagnostics desde el mismo core que la extension y el CLI. Para integracion en Zed, usa `zed: install dev extension` y selecciona `integrations/zed`; el adaptador busca el LSP en orden (dist, checkout, PATH).

Límites: un archivo de más de 2 MiB no se analiza y recibe un aviso informativo; el análisis de un documento dura como máximo 10 s (si no, se publica un error en el documento) y se muestran como máximo 500 diagnósticos por documento. Si el documento cambia durante el análisis, su resultado se descarta.

## Instalacion

Requiere Node.js >= 18.

```
npm install          # instala y compila dist/ (script prepare)
npm run check:core   # falla si src/core importa vscode fuera del adapter
npm run smoke:lsp    # levanta el server stdio y verifica publishDiagnostics
```

Tras cambiar código, `npm run compile` regenera `dist/`. Los scripts `cli` y `lsp` no compilan: ejecutan `dist/` tal cual.
Para el comando `varsense` desde el checkout: `npm link`, o `node dist/cli/index.js <comando>`.

## Configuracion

`varsense.config.json` valida estrictamente sus claves; las desconocidas fallan. Permite severidades, allowedValues para hardcoded detection, exclusiones y la convencion de tokens del proyecto.

`tokenDetection.duplicate.excludeTokens` y `tokenDetection.unused.excludeTokens`
aceptan una lista de nombres de token (con o sin el prefijo `--`) que la regla
correspondiente ignora. Sirve para lo que la regla no puede deducir sola: en
`duplicate`, los roles de un tema que comparten valor a proposito (`--card` y
`--popover` valen lo mismo que `--background` para poder re-tematizarse por
separado); en `unused`, los tokens consumidos fuera del alcance analizado.

## Arquitectura

- `src/core/`: indexadores y reglas agnosticos (VariableIndex, ClassIndex, tokenRules) sin imports de VS Code.
- `src/cli/`, `src/lsp/`, `src/extension.ts`: adapters de presentacion sobre el mismo core.
- `src/test/suite/coreContracts.test.ts`: paridad core/CLI/LSP con fixtures versionadas.
