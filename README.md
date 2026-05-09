# CSS Variables Validator

Extensión de VS Code para validación y gestión de variables CSS. Detecta errores, sugiere variables y mejora el flujo de trabajo con CSS custom properties.

## Características

### 🔍 Detección de Variables No Definidas
- Detecta automáticamente el uso de `var(--variable)` que no están definidas
- Marca los errores directamente en el editor
- Sugiere variables similares como quick fix

### ⚠️ Detección de Valores Hardcodeados
- Identifica valores literales que deberían usar variables CSS
- Configurable por propiedad (color, font-size, etc.)
- Lista de valores permitidos personalizable

### 🎨 Hover con Preview de Colores
- Muestra el valor de la variable al posicionar el cursor
- Preview visual de colores
- Información de archivo y línea de definición

### ⌨️ Autocompletado Contextual
- Sugiere variables basadas en la propiedad CSS actual
- Ordenado por frecuencia de uso
- Preview del valor en el autocompletado

### 🧭 Escaneo Global con Reporte por Archivo
- Escanea CSS/SCSS/LESS/TSX/JSX de todo el workspace (abiertos y cerrados)
- Muestra barra de progreso con conteo real de archivos (`actual/total`)
- Escribe reporte detallado en Output (`CSS Vars Validator`) con:
  - archivo
  - total por severidad
  - ejemplos de problemas por línea
- Permite navegar a archivos con problemas desde Quick Pick

### 🧹 Auto-fix Masivo de CSS
- Comando para aplicar quick fixes en lote sobre CSS/SCSS/LESS
- Aplica fixes preferidos para:
  - valores hardcodeados
  - fallbacks hardcodeados
  - variables no definidas (cuando hay sugerencia)
- Guarda archivos automáticamente y re-escanea al finalizar

### ⚛️ Detección de CSS Inline en React
- Soporte para TSX/JSX (`style={{...}}` y `style={variable}`)
- Diagnóstico configurable por severidad
- Mensaje estándar: `CSS inline detectado — usa clases CSS con variables`

### 🗂️ Escaneo Completo de Variables
- Opción `scanAllFiles` para escanear TODOS los archivos CSS del workspace en busca de definiciones
- Cuando está desactivado, solo se escanean archivos que coinciden con `variableFiles`
- Útil para proyectos donde las variables están distribuidas en múltiples archivos

## Instalación

### Desde el Marketplace
1. Abre VS Code
2. Ve a Extensions (Ctrl+Shift+X)
3. Busca "CSS Variables Validator"
4. Haz clic en Install

### Desarrollo Local
```bash
cd css-vars-validator
npm install
npm run compile
```

Presiona F5 para abrir una ventana de VS Code con la extensión cargada.

### CLI editor-agnóstico

El mismo núcleo de análisis se puede ejecutar fuera de VS Code:

```bash
npm run compile
node ./dist/cli/index.js scan --workspace . --format markdown --output .varsense-report.md
node ./dist/cli/index.js orphan-classes --workspace . --format json
```

`scan` valida variables no definidas, valores hardcodeados, propiedades prohibidas y CSS inline en React. `orphan-classes` usa los mismos indexadores core para reportar clases CSS definidas pero no consumidas.

### Language Server

VarSense tambien expone un servidor LSP stdio para editores compatibles:

```bash
npm run compile
node ./dist/lsp/server.js --stdio
```

El servidor publica diagnostics desde el mismo core que usa el CLI. La integracion de cada editor solo debe lanzar este binario y registrar los lenguajes CSS/SCSS/LESS/TSX/JSX.

## Configuración

Agrega estas opciones a tu `settings.json`:

```json
{
  // Habilitar/deshabilitar la extensión
  "cssVarsValidator.enable": true,
  
  // Archivos donde buscar definiciones de variables
  "cssVarsValidator.variableFiles": [
    "**/variables.css",
    "**/vars.css",
    "**/_variables.scss"
  ],
  
  // Configuración de detección de hardcoded
  "cssVarsValidator.hardcodedDetection.enabled": true,
  "cssVarsValidator.hardcodedDetection.severity": "warning",
  "cssVarsValidator.hardcodedDetection.properties": {
    "font-size": true,
    "color": true,
    "background-color": true,
    "margin": false,
    "padding": false
  },
  "cssVarsValidator.hardcodedDetection.allowedValues": [
    "0", "auto", "inherit", "initial", "unset", "none", "100%", "50%"
  ],
  
  // Mapeo de propiedades a palabras clave para sugerencias
  "cssVarsValidator.contextualSuggestions": {
    "font-size": ["font", "size", "fs", "text"],
    "color": ["color", "text", "primary", "secondary"],
    "background": ["bg", "background", "fondo"]
  },
  
  // Patrones a excluir del análisis
  "cssVarsValidator.excludePatterns": [
    "**/node_modules/**",
    "**/vendor/**",
    "**/*.min.css"
  ],
  
  // Escanear TODOS los archivos CSS para variables (más lento)
  "cssVarsValidator.scanAllFiles": false,
  
  // Detección de CSS inline en React
  "cssVarsValidator.inlineDetection.enabled": true,
  "cssVarsValidator.inlineDetection.severity": "error"
}
```

## Comandos

| Comando | Descripción |
|---------|-------------|
| `CSS Vars: Refrescar Variables` | Re-escanea todos los archivos de variables |
| `CSS Vars: Mostrar Todas las Variables` | Muestra lista de variables en Quick Pick |
| `CSS Vars: Ir a Definición` | Navega a la definición de la variable bajo el cursor |
| `CSS Vars: Escanear Todo el Proyecto` | Analiza todos los archivos soportados y genera reporte detallado |
| `CSS Vars: Auto-fix en Todos los CSS` | Intenta corregir automáticamente diagnósticos soportados en lote |
| `CSS Vars: Limpiar Caché` | Limpia caché, re-escanea variables y refresca diagnósticos |

## Uso

### Definir Variables
Define tus variables CSS en archivos que coincidan con los patrones configurados:

```css
/* variables.css */
:root {
  --color-primary: #3498db;
  --color-secondary: #2ecc71;
  --font-size-base: 16px;
  --spacing-unit: 8px;
}
```

### Usar Variables
La extensión validará el uso de variables en tus archivos CSS:

```css
/* styles.css */
.button {
  /* ✅ Variable definida */
  color: var(--color-primary);
  
  /* ❌ Error: Variable no definida */
  background: var(--color-undefined);
  
  /* ⚠️ Warning: Valor hardcodeado */
  font-size: 14px;
  
  /* ⚠️ Warning: Fallback hardcodeado */
  border: 1px solid var(--border-color, #ccc);
}
```

### Autocompletado
Escribe `var(` y la extensión sugerirá variables relevantes:

```css
.heading {
  font-size: var(  /* Sugerencias: --font-size-base, --font-size-lg, etc */
}
```

## Lenguajes Soportados

- CSS
- SCSS
- LESS
- Vue (sección `<style>`)
- TypeScript React (TSX) para detección de CSS inline
- JavaScript React (JSX) para detección de CSS inline

## Arquitectura

```
css-vars-validator/
├── src/
│   ├── extension.ts           # Punto de entrada
│   ├── providers/
│   │   ├── diagnosticProvider.ts   # Diagnósticos
│   │   ├── hoverProvider.ts        # Hover info
│   │   └── completionProvider.ts   # Autocompletado
│   ├── services/
│   │   ├── variableScanner.ts      # Escaneo de variables
│   │   ├── variableResolver.ts     # Resolución de valores
│   │   └── configService.ts        # Configuración
│   ├── parsers/
│   │   ├── cssParser.ts            # Parser CSS
│   │   └── valueParser.ts          # Parser de valores
│   ├── utils/
│   │   ├── colorUtils.ts           # Utilidades de color
│   │   └── fileUtils.ts            # Utilidades de archivos
│   └── types/
│       └── index.ts                # Definiciones de tipos
└── test/
    └── suite/
        └── extension.test.ts       # Tests
```

## Contribuir

1. Fork el repositorio
2. Crea una rama para tu feature (`git checkout -b feature/nueva-funcionalidad`)
3. Commit tus cambios (`git commit -am 'Agrega nueva funcionalidad'`)
4. Push a la rama (`git push origin feature/nueva-funcionalidad`)
5. Abre un Pull Request

## Licencia

MIT

## Changelog

Ver [CHANGELOG.md](CHANGELOG.md) para historial de cambios.
