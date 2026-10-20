# Contribuir a VarSense

Gracias por el interés. Alcance: VarSense es un motor de validación de variables CSS con tres superficies (extensión de VS Code, CLI y LSP) sobre un mismo core.

## Preparar el entorno

Requiere Node.js >= 20.19. Desde la raíz:

```
npm install
```

`npm install` compila `dist/` (script `prepare`). Ver [README](README.md), sección Instalación.

## Antes de abrir un cambio

```
npm run quality:check
```

Compila los tests, pasa ESLint, verifica que `src/core` no importe `vscode` ni built-ins de Node, ejecuta el smoke de LSP y los tests unitarios. Los tests de VS Code van con `npm test`; en Linux sin servidor gráfico, prefija con `xvfb-run -a`.

## Reglas del código

- `src/core/` no importa `vscode` ni built-ins de Node (`npm run check:core`). Lo que necesita disco o hash entra por puertos inyectados.
- Los cambios de salida JSON de CLI conservan `schemaVersion` o lo incrementan y lo documentan en el CHANGELOG.
- Un fallo nuevo se corrige con un test que lo reproduzca.

## Pull requests

Un cambio por PR, con el motivo en la descripción y el resultado de `npm run quality:check`.
