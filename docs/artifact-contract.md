# Contrato del artifact publicado de VarSense

> **Estado:** aceptado (Fase 3 de la auditoría, 2026-08-10; tarea `108A-1`)
> **Vigencia:** a partir del release que adopte este contrato (publicación en Fase 8)

## Objetivo

Que los consumidores obtengan VarSense por **descarga y verificación de un
artifact publicado**, no por `npm ci + compile` en cada checkout. El build
desde source queda como **modo de desarrollo explícito**.

## Contenido del artifact

1. **Runtime dependencies mínimas:** el artifact incluye sus dependencias
   (`node_modules` o bundle autocontenido) — el consumidor no ejecuta `npm
   install` ni compila.
2. **Manifiesto `manifest.json`** dentro del artifact, firmado por el release:

   ```json
   {
     "schemaVersion": 1,
     "name": "varsense",
     "version": "2.2.1",
     "commit": "<sha256 del commit del release>",
     "protocol": 1,
     "capabilities": ["all", "scan", "orphan-classes", "index-dir", "files-from"],
     "sha256": "<sha256 del artifact comprimido>",
     "platform": "win32-x64",
     "node": ">=18"
   }
   ```

   - `sha256` verifica la integridad del artifact descargado.
   - `commit`/`version` permiten reproducir y fijar exactamente lo que se
     ejecuta; un cambio de cualquiera invalida el índice persistente
     (identidad de `--index-dir`).
   - `protocol` versiona el contrato de salida JSON (`schemaVersion`,
     `metrics`, `phaseDurationMs`).

## Verificación en el consumidor

- `quality:setup` descarga/verifica el artifact (SHA-256) antes de fijar el
  pin; el doctor reporta `cliVersion`/`commit` contra `quality-tools.json` y
  `sentinel.lock.json` (ya existente).
- El índice persistente se invalida por **contenido, config, versión,
  plataforma y dependencias** (identidad actual en `createIndexStore`).

## Retención y rollback

- Se conservan versiones del runtime con retención acotada (configurable) y
  limpieza segura; **nunca** editar `sentinel.lock.json` a mano.
- Rollback = repinear el consumidor al artifact previo verificado; sin
  migración destructiva de índices (los snapshots son descartables y
  versionados).

## Referencias

- Auditoría §14 Fase 3 (setup/distribución, gate de rendimiento, rollback).
- `bench-varsense` del consumidor: `phaseDurationMs` + `metrics` del CLI
  (108A-1 F3) alimentan el benchmark versionado.
