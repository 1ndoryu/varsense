// Autogate: VarSense se analiza a sí mismo. Falla si hay más archivos con hallazgos que el umbral versionado.
// Uso: node scripts/autogate.mjs
// Lo usa quality:check (y por tanto la CI): así hay una sola definición del autogate.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Umbral versionado. Sin él, o con un valor no válido, el gate se niega a decidir.
const CONFIG_AUTOGATE = 'varsense-autogate.json';
// Acota el análisis: un análisis que se cuelga no debe bloquear la CI indefinidamente.
const TIMEOUT_ANALISIS_MS = 600_000;
// Códigos de salida de la CLI: 0 sin errores, 1 hay hallazgos de severidad error. Cualquier otro es fallo.
const SALIDAS_VALIDAS = new Set([0, 1]);

function leerUmbral() {
  let umbral;
  try {
    umbral = JSON.parse(readFileSync(CONFIG_AUTOGATE, 'utf8')).maxArchivosConHallazgos;
  } catch (error) {
    throw new Error(`no se pudo leer ${CONFIG_AUTOGATE} (${error.message})`);
  }
  if (!Number.isInteger(umbral) || umbral < 0) {
    throw new Error(`maxArchivosConHallazgos debe ser un entero >= 0 en ${CONFIG_AUTOGATE}`);
  }
  return umbral;
}

// El reporte va a un directorio temporal propio: no ensucia el repo ni lee datos de una ejecución anterior.
function analizarSelf(dir) {
  const reporte = join(dir, 'reporte.json');
  const analisis = spawnSync(
    process.execPath,
    ['dist/cli/index.js', 'scan', '--workspace', '.', '--format', 'json', '--output', reporte],
    { encoding: 'utf8', timeout: TIMEOUT_ANALISIS_MS },
  );
  if (analisis.error) throw new Error(`no se pudo lanzar el análisis (${analisis.error.message})`);
  if (!SALIDAS_VALIDAS.has(analisis.status)) {
    throw new Error(`el análisis terminó con código ${analisis.status}: ${analisis.stderr.trim()}`);
  }
  const datos = JSON.parse(readFileSync(reporte, 'utf8'));
  if (!Number.isInteger(datos.totalArchivosConHallazgos)) throw new Error('el reporte no trae totalArchivosConHallazgos');
  return datos;
}

function main() {
  const dir = mkdtempSync(join(tmpdir(), 'varsense-autogate-'));
  let resultado;
  try {
    resultado = { umbral: leerUmbral(), datos: analizarSelf(dir) };
  } catch (error) {
    resultado = { error };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (resultado.error) {
    console.error(`Autogate: ${resultado.error.message}`);
    process.exit(2);
  }
  const { umbral, datos } = resultado;
  const { totalArchivosConHallazgos: conHallazgos, totalArchivos } = datos;
  if (conHallazgos > umbral) {
    console.error(`Autogate: ${conHallazgos} de ${totalArchivos} archivos con hallazgos (umbral ${umbral}). Corrige los hallazgos nuevos.`);
    process.exit(1);
  }
  console.log(`Autogate OK: ${conHallazgos} de ${totalArchivos} archivos con hallazgos (umbral ${umbral}).`);
}

main();
