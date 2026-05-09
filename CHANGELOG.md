# Changelog

Todos los cambios notables de este proyecto serán documentados en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es/1.0.0/),
y este proyecto adhiere a [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.1] - 2026-05-08

### Agregado
- **CLI editor-agnóstico**: nuevo binario `varsense` con `scan` y `orphan-classes`, usando los mismos indexadores y contratos core que la extensión.
- **LSP stdio**: nuevo binario `varsense-lsp` que publica diagnostics desde el core para editores compatibles.
- **Reporte Markdown/JSON desde Node**: `scan` puede escribir `.varsense-report.md` o imprimir JSON estructurado sin depender de VS Code.
- **Fixtures de equivalencia**: casos versionados que comparan hallazgos core vs CLI para `scan` y `orphan-classes`.

### Mejorado
- **Build dual extension/CLI**: esbuild genera `dist/extension.js` y `dist/cli/index.js`, evitando fugas de aliases `@/` en runtime.
- **Guard de core editor-agnóstico**: `npm test` ejecuta `check:core` y falla si `src/core/**` importa `vscode` fuera del adaptador permitido.

## [2.0.0] - 2026-02-16

### Agregado
- **Comando scanAllDiagnostics**: Escaneo completo del workspace (archivos abiertos y cerrados) para CSS/SCSS/LESS/TSX/JSX.
- **Progreso con conteo real**: Durante el escaneo global se muestra avance por archivo (`actual/total`).
- **Reporte detallado por archivo**: Nuevo resumen en OutputChannel `CSS Vars Validator` con severidades y ejemplos por línea.
- **Navegación por Quick Pick**: Desde el resultado del escaneo se puede abrir rápidamente cualquier archivo con problemas.
- **Comando autoFixAllCss**: Aplicación masiva de quick fixes para diagnósticos soportados en CSS/SCSS/LESS.
- **Resultado estructurado de escaneo**: Nuevo objeto `ResultadoEscaneoProyecto` con métricas globales y por archivo.

### Mejorado
- **Detección cross-file de clases duplicadas**: Integrada con índice de clases en scanner y diagnóstico con referencia a archivo/línea original.
- **Detección inline en React**: Validación para `style={{...}}` y `style={variable}` en TSX/JSX con severidad configurable.
- **Validación de scope local**: Variables definidas en el mismo archivo se consideran válidas para evitar falsos positivos.

## [1.0.0] - 2026-02-03

### Agregado
- **Detección de variables no definidas**: Marca como error cuando se usa `var(--nombre)` y la variable no está definida en ningún archivo de variables configurado.
- **Detección de valores hardcodeados**: Identifica valores literales en propiedades configurables (font-size, color, etc.) que deberían usar variables CSS.
- **Detección de fallbacks hardcodeados**: Marca fallbacks como `var(--color, #fff)` cuando contienen valores literales.
- **Hover con información de variable**: Al posicionar el cursor sobre una variable CSS muestra:
  - Valor definido
  - Valor resuelto (si referencia otras variables)
  - Preview de color (si aplica)
  - Archivo y línea de definición
- **Autocompletado contextual**: Sugiere variables basadas en la propiedad CSS actual con ordenamiento por frecuencia de uso.
- **Quick fixes**: Sugerencias automáticas para corregir variables no definidas y reemplazar valores hardcodeados.
- **Comando: Refrescar Variables**: Re-escanea todos los archivos de variables manualmente.
- **Comando: Mostrar Todas las Variables**: Lista todas las variables en un Quick Pick para búsqueda rápida.
- **Comando: Ir a Definición**: Navega directamente a la definición de una variable.
- **Sistema de caché**: Optimización de rendimiento con caché de variables y actualización incremental.
- **Watchers de archivos**: Actualización automática cuando se modifican archivos de variables.
- **Configuración completa**: Todas las funcionalidades son configurables vía settings.json.

### Configuración Inicial
- Patrones de archivos de variables configurables
- Propiedades CSS a verificar por hardcoded configurables
- Lista de valores permitidos personalizable
- Mapeo de sugerencias contextuales configurable
- Patrones de exclusión configurables

### Lenguajes Soportados
- CSS
- SCSS
- LESS
- Vue (sección style)

## [Próximamente]

### Planeado
- [ ] Soporte para variables SCSS (`$variable`)
- [ ] Definition provider (Ctrl+Click para ir a definición)
- [ ] Rename provider (renombrar variable en todo el proyecto)
- [ ] Code lens con número de usos
- [ ] Panel lateral con árbol de variables
- [ ] Exportar variables a JSON/TypeScript
- [ ] Análisis de variables no utilizadas
- [ ] Sugerencias de agrupación de variables
