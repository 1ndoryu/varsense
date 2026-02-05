# Changelog

Todos los cambios notables de este proyecto serán documentados en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es/1.0.0/),
y este proyecto adhiere a [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
