# CSS Variables Validator - Extensión VS Code

## 📋 Descripción General

Extensión de VS Code especializada en validación y gestión de variables CSS. Detecta errores, sugiere variables y mejora el flujo de trabajo con CSS custom properties.

---

## 🎯 Funcionalidades Principales

### 1. Detección de Variables CSS Inexistentes
- Escanear archivos CSS/SCSS en busca de `var(--nombre-variable)`
- Verificar si la variable está definida en algún archivo del proyecto
- Marcar como **error** las variables no encontradas
- Mostrar diagnóstico con mensaje claro: "Variable '--nombre' no está definida"

### 2. Detección de Valores Hardcodeados (Configurable)
- Identificar propiedades con valores literales que deberían usar variables
- **Propiedades configurables** por el usuario:
  - `font-size` → detectar `12px`, `1rem`, etc.
  - `color` / `background-color` → detectar `#fff`, `rgb()`, etc.
  - `margin` / `padding` → detectar valores numéricos
  - `border-radius`, `gap`, `line-height`, etc.
- Marcar como **warning** o **error** según configuración
- Permitir **lista de excepciones** (ej: `0`, `inherit`, `auto`)

### 3. Hover con Valor de Variable
- Al posicionar el cursor sobre `var(--mi-variable)`:
  - Mostrar el valor definido
  - Mostrar el archivo donde está definida
  - Mostrar preview de color si es un color

### 4. Autocompletado Contextual de Variables
- Al escribir `font-size:` sugerir variables que contengan `font`, `size`, `text`, `fs`
- Al escribir `color:` sugerir variables que contengan `color`, `bg`, `text`
- **Sistema de mapeo configurable:**
  ```json
  {
    "font-size": ["font", "size", "fs", "text"],
    "color": ["color", "clr", "text"],
    "background": ["bg", "background"],
    "spacing": ["space", "gap", "margin", "padding"]
  }
  ```
- También sugerir por **prefijos comunes** detectados automáticamente

---

## 🏗️ Arquitectura del Proyecto

```
css-vars-validator/
├── .vscode/
│   └── launch.json           # Configuración de debugging
├── src/
│   ├── extension.ts          # Punto de entrada principal
│   ├── providers/
│   │   ├── diagnosticProvider.ts    # Diagnósticos (errores/warnings)
│   │   ├── hoverProvider.ts         # Info al hover
│   │   └── completionProvider.ts    # Autocompletado
│   ├── services/
│   │   ├── variableScanner.ts       # Escaneo de variables definidas
│   │   ├── variableResolver.ts      # Resolución y caché de variables
│   │   └── configService.ts         # Gestión de configuración
│   ├── parsers/
│   │   ├── cssParser.ts             # Parser de archivos CSS
│   │   └── valueParser.ts           # Parser de valores CSS
│   ├── utils/
│   │   ├── colorUtils.ts            # Utilidades para colores
│   │   └── fileUtils.ts             # Utilidades de archivos
│   └── types/
│       └── index.ts                 # Tipos TypeScript
├── test/
│   └── suite/
│       └── extension.test.ts
├── package.json
├── tsconfig.json
├── .eslintrc.json
├── .gitignore
├── README.md
├── CHANGELOG.md
└── PLANIFICACION.md
```

---

## ⚙️ Configuración de Usuario (settings.json)

```json
{
  "cssVarsValidator.enable": true,
  
  "cssVarsValidator.variableFiles": [
    "**/variables.css",
    "**/vars.css",
    "**/_variables.scss"
  ],
  
  "cssVarsValidator.hardcodedDetection": {
    "enabled": true,
    "severity": "warning",
    "properties": {
      "font-size": true,
      "color": true,
      "background-color": true,
      "margin": false,
      "padding": false
    },
    "allowedValues": ["0", "auto", "inherit", "initial", "unset", "none", "100%", "50%"]
  },
  
  "cssVarsValidator.contextualSuggestions": {
    "font-size": ["font", "size", "fs", "text", "tipo"],
    "color": ["color", "clr", "text", "primary", "secondary"],
    "background": ["bg", "background", "fondo"],
    "gap": ["space", "gap", "espacio"],
    "border-radius": ["radius", "round", "borde"]
  },
  
  "cssVarsValidator.excludePatterns": [
    "**/node_modules/**",
    "**/vendor/**",
    "**/*.min.css"
  ]
}
```

---

## 📦 Dependencias

```json
{
  "devDependencies": {
    "@types/vscode": "^1.85.0",
    "@types/node": "^20.x",
    "typescript": "^5.3.0",
    "esbuild": "^0.19.0",
    "@vscode/test-electron": "^2.3.0",
    "eslint": "^8.56.0",
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "@typescript-eslint/parser": "^6.0.0"
  }
}
```

---

## 🔄 Flujo de Funcionamiento

### Al Abrir el Workspace:
1. Escanear archivos según `variableFiles` pattern
2. Construir índice de variables: `{ nombre: { valor, archivo, línea } }`
3. Cachear el índice en memoria

### Al Editar un Archivo CSS:
1. Parsear el documento en busca de:
   - Usos de `var(--*)` → verificar existencia
   - Valores literales en propiedades configuradas → detectar hardcoded
2. Generar diagnósticos y enviarlos al editor

### Al Guardar Archivo de Variables:
1. Re-escanear y actualizar el índice
2. Re-evaluar diagnósticos en archivos abiertos

### Al Hacer Hover:
1. Detectar si el cursor está sobre una variable CSS
2. Buscar en el índice y mostrar información

### Al Autocompletar:
1. Detectar la propiedad CSS actual
2. Filtrar variables según mapeo contextual
3. Ordenar por relevancia

---

## ❓ DUDAS PARA ACLARAR

### Duda 1: Alcance de Variables
¿Las variables deben buscarse solo en archivos específicos (ej: `variables.css`) o en **todos** los archivos CSS del proyecto? 
- **Opción A:** Solo en archivos configurados (más rápido, más preciso)
- **Opción B:** En todos los archivos CSS (más completo pero puede tener falsos positivos)

USUARIO: OPCION A, Intentar optimizar todo lo posible.

### Duda 2: Soporte para SCSS/SASS
¿Necesitas soporte para variables SCSS (`$variable`) además de CSS custom properties (`--variable`)?
- Si es solo CSS custom properties, el desarrollo es más directo
- Si incluye SCSS, hay que considerar compilación y scope

USUARIO: no, solo css por el momento

### Duda 3: Variables con Fallback
En `var(--color, #fff)` el fallback `#fff` ¿debería marcarse como hardcoded o se permite por ser fallback?

USUARIO: Marcarse como harcode

### Duda 4: Severidad de Errores
- Variable no existe: ¿**Error** (rojo) o **Warning** (amarillo)?
- Valor hardcodeado: ¿**Warning** o configurable?

Error para variables que no existen, y warning para harcodeado.

### Duda 5: Archivos Específicos para Testeo
¿Hay archivos CSS específicos en el proyecto actual que deba usar como referencia para las variables? Por ejemplo, mencionaste `variables.css` o similar.

Tengo este proyecto donde el css es un desastre, no se si sirva,

### Duda 6: Prioridad de Variables en Sugerencias
Cuando hay muchas variables, ¿cómo ordenarlas?
- **Opción A:** Alfabéticamente
- **Opción B:** Por frecuencia de uso
- **Opción C:** Por relevancia al contexto (más inteligente pero más complejo)

opcion b

---

## 📅 Roadmap de Desarrollo

### Fase 1: Estructura Base ✅ COMPLETADA
- [x] Inicializar proyecto con estructura de carpetas
- [x] Configurar TypeScript, ESLint, esbuild
- [x] Crear manifest (package.json) con contributes
- [x] Configurar debugging (launch.json, tasks.json)

### Fase 2: Escaneo de Variables ✅ COMPLETADA
- [x] Implementar `variableScanner.ts`
- [x] Implementar sistema de caché con invalidación parcial
- [x] Implementar watch de archivos de variables
- [x] Implementar `variableResolver.ts` para resolución de referencias

### Fase 3: Diagnósticos ✅ COMPLETADA
- [x] Implementar detección de variables inexistentes
- [x] Implementar detección de valores hardcodeados
- [x] Implementar detección de fallbacks hardcodeados
- [x] Integrar con sistema de diagnósticos de VS Code
- [x] Implementar Code Action Provider (quick fixes)

### Fase 4: Hover Provider ✅ COMPLETADA
- [x] Implementar hover sobre variables
- [x] Mostrar valor y ubicación
- [x] Mostrar valor resuelto (para variables que referencian otras)
- [x] Agregar preview de colores con SVG inline
- [x] Sugerir variables similares para no encontradas

### Fase 5: Autocompletado ✅ COMPLETADA
- [x] Implementar completion provider
- [x] Implementar filtrado contextual por propiedad CSS
- [x] Ordenar sugerencias por frecuencia de uso
- [x] Preview de colores en autocompletado

### Fase 6: Testing y Pulido ✅ COMPLETADA
- [x] Tests unitarios para parsers
- [x] Tests unitarios para utilidades
- [x] Tests de integración básicos
- [x] Documentación (README.md, CHANGELOG.md)
- [x] Preparado para desarrollo local

### Próximas Mejoras (Backlog)
- [ ] Soporte para variables SCSS (`$variable`)
- [ ] Definition provider (Ctrl+Click)
- [ ] Rename provider
- [ ] Code lens con número de usos
- [ ] Panel lateral con árbol de variables
- [ ] Análisis de variables no utilizadas

---

## 🚀 Comandos de la Extensión

| Comando | Descripción |
|---------|-------------|
| `cssVarsValidator.refreshVariables` | Re-escanear variables manualmente |
| `cssVarsValidator.showAllVariables` | Mostrar lista de todas las variables detectadas |
| `cssVarsValidator.goToDefinition` | Ir a la definición de una variable |

---

## 📝 Notas Técnicas

### API de VS Code a Utilizar:
- `vscode.languages.registerHoverProvider` - Para hover
- `vscode.languages.registerCompletionItemProvider` - Para autocompletado
- `vscode.languages.createDiagnosticCollection` - Para errores/warnings
- `vscode.workspace.findFiles` - Para buscar archivos
- `vscode.workspace.createFileSystemWatcher` - Para detectar cambios

### Lenguajes Soportados:
- CSS
- SCSS (si se confirma)
- Vue (sección `<style>`)
- HTML (estilos inline, si se requiere)

---

**Estado:** ✅ Implementación Completa (v1.0.2) - Sin errores de compilación ni lint
**Última actualización:** 3 de febrero de 2026

### Notas de Implementación
- Todos los providers implementados y funcionales
- Sistema de caché optimizado con invalidación parcial
- Soporte para resolución de variables anidadas
- Quick fixes implementados para errores comunes
- Tests unitarios cubriendo parsers y utilidades
- Compilación exitosa con esbuild (38kb bundle)
- TypeScript sin errores (`tsc --noEmit` pasa correctamente)

### Correcciones Aplicadas (v1.0.1)
- tsconfig.json: Agregado "DOM" a libs y "types" explícitos
- Corregidos tipos incompatibles en funciones debounce
- Actualizada versión de @types/vscode a 1.85.0 (compatible con engine)
- Corregidos imports de glob y mocha en test runner

### Correcciones Aplicadas (v1.0.2)
- **Regex de detección mejorada**: Ahora soporta múltiples declaraciones CSS por línea y estilos minificados
- **Sistema de metadatos refactorizado**: Uso de WeakMap en lugar de hack con .data para almacenar metadatos de diagnósticos
- **Script de tests corregido**: Manejo correcto de rutas con espacios
- Variables no usadas eliminadas para código más limpio
- Corregidos tipos incompatibles en funciones debounce
- Corregidos accesos a propiedades `data` usando casts para compatibilidad
- Actualizada versión de @types/vscode a 1.85.0 (compatible con engine)
- Corregidos imports de glob y mocha en test runner
