# Contrato del artifact publicado de VarSense

> **Estado:** el estado actual de la instalación vive en el README, sección Instalación (fuente única). Este documento describe el contrato objetivo: hasta el primer artifact publicado, describe el destino y no el comportamiento actual.

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
     "version": "<version de package.json>",
     "commit": "<sha256 del commit del release>",
     "protocol": 1,
     "capabilities": ["all", "scan", "orphan-classes", "index-dir", "files-from"],
     "sha256": "<sha256 del artifact comprimido>",
     "platform": "win32-x64",
     "node": ">=20.19"
   }
   ```

   - `sha256` verifica la integridad del artifact descargado.
   - `commit`/`version` permiten reproducir y fijar exactamente lo que se
     ejecuta. El `commit` no forma parte de la identidad del índice
     persistente: solo la versión de la herramienta, la del parser y el hash
     de la configuración (ver abajo).
   - `protocol` versiona el contrato de salida JSON (`schemaVersion`,
     `metrics`, `phaseDurationMs`).

## Verificación en el consumidor

- En el repo consumidor (no en VarSense, y todavía sin implementar), un paso
  tipo `quality:setup` descargaría y verificaría el artifact (SHA-256) antes de
  fijar el pin; el doctor de Sentinel reporta `cliVersion`/`commit` contra
  `quality-tools.json` y `sentinel.lock.json`.
- El índice persistente se invalida por **versión de la herramienta, versión
  del parser y hash de la configuración** (`indexIdentity`,
  `src/node/persistentIndexStore.ts`). No incluye plataforma ni dependencias: el
  índice se regenera en cada máquina.

## Retención y rollback

- Se conservan versiones del runtime con retención acotada (configurable) y
  limpieza segura; **nunca** editar `sentinel.lock.json` a mano.
- Rollback = repinear el consumidor al artifact previo verificado; sin
  migración destructiva de índices (los snapshots son descartables y
  versionados).

## Referencias

- Benchmarks de consumidores: `phaseDurationMs` y `metrics` de la salida JSON
  del CLI son la fuente de medición.
