// Smoke 028A-8 tramo 4: análisis scoped vía índice inverso + métricas Fase 0.
// Autónomo: crea fixture temporal en C:/tmp, corre el CLI, verifica y limpia.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = 'C:/tmp/varsense-persistent-index';
const cli = path.join(root, 'dist/cli/index.js');
const fixture = path.join(os.tmpdir(), 'varsense-tramo4-smoke');
const indexDir = path.join(fixture, 'index');
const manifestPath = path.join(fixture, 'scope.txt');

function clean() {
  fs.rmSync(fixture, { recursive: true, force: true });
}
function runCli(args) {
  const res = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd: fixture });
  if (res.status !== 0) {
    throw new Error(`CLI exit ${res.status}: ${res.stdout}\n${res.stderr}`);
  }
  return JSON.parse(res.stdout);
}
function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

try {
  clean();
  fs.mkdirSync(path.join(fixture, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(fixture, 'varsense.config.json'),
    JSON.stringify({
      includePatterns: ['src/**'],
      variableFiles: ['src/**/*.css'],
      excludePatterns: ['node_modules/**'],
      tokenDetection: {
        unused: { enabled: true, severity: 'warning' },
        duplicate: { enabled: true, severity: 'warning' },
      },
    }, null, 2)
  );
  fs.writeFileSync(path.join(fixture, 'src/tokens.css'), ':root { --color-primario: #123456; --color-secundario: #abcdef; }');
  // componente.css usa --color-primario (consumidor real)
  fs.writeFileSync(path.join(fixture, 'src/componente.css'), '.boton { color: var(--color-primario); }');
  // app.ts usa la clase .boton
  fs.writeFileSync(path.join(fixture, 'src/app.ts'), 'const el = document.querySelector(".boton");');

  // Run 1: full scan con index-dir -> snapshot con variableUsages + métricas
  const r1 = runCli(['all', '--workspace', fixture, '--config', path.join(fixture, 'varsense.config.json'), '--format', 'json', '--index-dir', indexDir]);
  assert(r1.cache?.enabled === true, `cache.enabled en run1: ${JSON.stringify(r1.cache)}`);
  assert(r1.metrics && typeof r1.metrics.filesDiscovered === 'number', 'métricas Fase 0 presentes');
  assert(r1.metrics.cacheHitRate === 0, `cacheHitRate run1 debe ser 0 (reparse completo), fue ${r1.metrics.cacheHitRate}`);
  assert(r1.metrics.peakRssMb > 0, 'peakRssMb > 0');
  const unusedRun1 = (r1.entries ?? []).flatMap(e => e.findings ?? []).filter(f => f.ruleId === 'token-unused');
  assert(unusedRun1.some(f => f.message.includes('--color-primario')) === false, `run1 no debe reportar unused de --color-primario (se usa): ${JSON.stringify(unusedRun1.map(f => f.message))}`);
  assert(unusedRun1.some(f => f.message.includes('--color-secundario')), `run1 sí debe reportar unused de --color-secundario: ${JSON.stringify(unusedRun1.map(f => f.message))}`);
  const cache1 = r1.cache;
  assert(cache1.reparsed > 0 && cache1.reused === 0, `run1 reparse todo: ${JSON.stringify(cache1)}`);

  // Run 2: mismo index-dir -> reutiliza sin reparsear
  const r2 = runCli(['all', '--workspace', fixture, '--config', path.join(fixture, 'varsense.config.json'), '--format', 'json', '--index-dir', indexDir]);
  assert(r2.cache.reused > 0 && r2.cache.reparsed === 0, `run2 reutiliza todo: ${JSON.stringify(r2.cache)}`);
  assert(r2.metrics.cacheHitRate === 1, `cacheHitRate run2 debe ser 1, fue ${r2.metrics.cacheHitRate}`);
  assert(r2.metrics.filesAnalyzed === r1.metrics.filesAnalyzed, 'filesAnalyzed igual entre runs');

  // Run 3: --files-from solo tokens.css -> análisis scoped; el índice inverso
  // resuelve que --color-primario se usa en componente.css (sin abrirlo).
  fs.writeFileSync(manifestPath, 'src/tokens.css\n');
  const r3 = runCli(['all', '--workspace', fixture, '--config', path.join(fixture, 'varsense.config.json'), '--format', 'json', '--index-dir', indexDir, '--files-from', manifestPath]);
  assert(r3.metrics.filesAnalyzed < r1.metrics.filesAnalyzed, `run3 analiza menos archivos: ${r3.metrics.filesAnalyzed} < ${r1.metrics.filesAnalyzed}`);
  assert(r3.metrics.filesAnalyzed === 1, `run3 solo abre el scoped (tokens.css): ${r3.metrics.filesAnalyzed}`);
  const unusedRun3 = (r3.entries ?? []).flatMap(e => e.findings ?? []).filter(f => f.ruleId === 'token-unused');
  assert(unusedRun3.some(f => f.message.includes('--color-primario')) === false, `run3 no debe reportar falso positivo de --color-primario (uso en componente.css resuelto por índice inverso): ${JSON.stringify(unusedRun3.map(f => f.message))}`);
  // Los findings reportados se limitan al scoped
  const reportedFiles = (r3.entries ?? []).map(e => e.ruta);
  assert(reportedFiles.every(f => f.includes('tokens.css')), `run3 solo reporta scoped: ${JSON.stringify(reportedFiles)}`);

  // Run 4: quitar el uso en componente.css y re-correr full -> token-unused debe aparecer
  fs.writeFileSync(path.join(fixture, 'src/componente.css'), '.boton { color: #ff0000; }');
  const r4 = runCli(['all', '--workspace', fixture, '--config', path.join(fixture, 'varsense.config.json'), '--format', 'json', '--index-dir', indexDir]);
  const unusedRun4 = (r4.entries ?? []).flatMap(e => e.findings ?? []).filter(f => f.ruleId === 'token-unused');
  assert(unusedRun4.some(f => f.message.includes('--color-primario')), `run4 detecta unused tras quitar el uso: ${JSON.stringify(unusedRun4.map(f => f.message))}`);

  console.log('[smoke-tramo4] OK — scoped analysis, reverse-index accuracy, metrics, invalidation on usage change');
} finally {
  clean();
}
