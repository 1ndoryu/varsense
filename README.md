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

## Token detection

`all` incluye `tokenDetection` con hallazgos tipados:

- `token-duplicate`: el mismo token declarado con valores distintos.
- `token-unused`: tokens declarados que no se usan en ningun documento.

La severidad es independiente y configurable; los tokens se resuelven sobre la convencion declarada en `varsense.config.json`, sin imponer paleta, idioma ni nombres de variables.

## LSP stdio

El binario `varsense-lsp` publica diagnostics desde el mismo core que la extension y el CLI. Para integracion en Zed, usa `zed: install dev extension` y selecciona `integrations/zed`; el adaptador busca el LSP en orden (dist, checkout, PATH).

## Instalacion

```
npm install
npm run compile
npm run check:core   # falla si src/core importa vscode fuera del adapter
npm run smoke:lsp    # levanta el server stdio y verifica publishDiagnostics
```

## Configuracion

`varsense.config.json` valida estrictamente sus claves; las desconocidas fallan. Permite severidades, allowedValues para hardcoded detection, exclusiones y la convencion de tokens del proyecto.

## Arquitectura

- `src/core/`: indexadores y reglas agnosticos (VariableIndex, ClassIndex, tokenRules) sin imports de VS Code.
- `src/cli/`, `src/lsp/`, `src/extension.ts`: adapters de presentacion sobre el mismo core.
- `src/test/suite/coreContracts.test.ts`: paridad core/CLI/LSP con fixtures versionadas.
