# VarSense para Zed

Esta carpeta contiene la integracion minima de Zed para VarSense. La extension no incluye reglas propias: registra `varsense-lsp` y deja que el servidor LSP de Node publique los diagnostics desde el mismo core que usan VS Code y la CLI.

## Desarrollo local

1. Desde la raiz de VarSense, instala dependencias y compila:

```bash
npm install
npm run compile
```

2. En Zed, ejecuta `zed: install dev extension` y selecciona `integrations/zed`.

3. Abre un archivo CSS, SCSS, LESS, TSX o JSX en un proyecto con variables CSS. Zed debe iniciar `node ../../dist/lsp/server.js --stdio` desde esta carpeta.

## Resolucion del LSP

La integracion busca el servidor en este orden:

1. `VARSENSE_LSP_PATH`, para apuntar a un binario o script concreto.
2. `varsense-lsp` disponible en el `PATH` del worktree.
3. `../../dist/lsp/server.js`, pensado para desarrollo dentro de este repo.

Si la ruta termina en `.js`, la integracion usa `zed::node_binary_path()` y pasa `--stdio`. Para binarios o shims de npm, ejecuta la ruta directamente con `--stdio`.

## Tareas CLI

La raiz del repo incluye `.zed/tasks.json` con tareas de ejemplo para generar reportes desde la CLI. En un proyecto consumidor se puede copiar esa carpeta o adaptar los comandos a una instalacion global de `varsense`.

## Publicacion

Para publicar en el registro de Zed, esta carpeta debe usarse como `path` del submodulo y conservar una licencia aceptada en la misma ruta. El LSP no debe enviarse dentro de la extension publicada; debe localizarse, descargarse o verificarse en el entorno del usuario.
