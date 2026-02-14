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
  ]
}
```

## Comandos

| Comando | Descripción |
|---------|-------------|
| `CSS Vars: Refrescar Variables` | Re-escanea todos los archivos de variables |
| `CSS Vars: Mostrar Todas las Variables` | Muestra lista de variables en Quick Pick |
| `CSS Vars: Ir a Definición` | Navega a la definición de la variable bajo el cursor |

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
