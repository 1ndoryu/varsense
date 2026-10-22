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
xvfb-run -a npm run quality:check
```

Es el único gate, y el CI ejecuta el mismo comando en Node 20.19 y 22. Compila los tests, pasa ESLint, verifica la frontera de `src/core` (`check:core`), ejecuta los smoke de LSP, CLI, índice persistente y `tramo4`, los tests unitarios, los tests de VS Code y `check:zed`; cierra con el autogate, que analiza el propio repo con `all` (scan, clases huérfanas y tokens). `xvfb-run` hace falta en Linux sin servidor gráfico. `check:zed` requiere el target de Rust: `rustup target add wasm32-wasip2`.

## Reglas del código

- `src/core/` no importa `vscode` ni built-ins de Node (`npm run check:core`). Lo que necesita disco o hash entra por puertos inyectados.
- Los cambios de salida JSON de CLI conservan `schemaVersion` o lo incrementan y lo documentan en el CHANGELOG.
- Un fallo nuevo se corrige con un test que lo reproduzca.

## Pull requests

Un cambio por PR, con el motivo en la descripción y el resultado de `npm run quality:check`.
