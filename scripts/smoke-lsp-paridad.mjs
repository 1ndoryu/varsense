// Comprueba que la LSP usa el mismo índice que la CLI: setProperty y :host fuera de variableFiles no dan variableNoDefinida.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const serverPath = path.join(root, 'dist', 'lsp', 'server.js');
const fixtureRoot = path.join(root, 'fixtures', 'equivalence', 'runtime-host-scope');
const fixtureFile = path.join(fixtureRoot, 'src', 'component.css');
const rootUri = `file:///${fixtureRoot.replace(/\\/g, '/')}`;
const documentUri = `file:///${fixtureFile.replace(/\\/g, '/')}`;
const ESPERADO = ['--ausente'];
const TIMEOUT_MS = 15000;

function sendMessage(child, message) {
    const body = JSON.stringify(message);
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
}

// Extrae los mensajes JSON-RPC completos del flujo (cabecera Content-Length + cuerpo).
function extraerMensajes(buffer) {
    const mensajes = [];
    let resto = buffer;
    for (;;) {
        const cabecera = resto.indexOf('\r\n\r\n');
        if (cabecera < 0) break;
        const longitud = Number(/Content-Length: (\d+)/i.exec(resto.slice(0, cabecera))?.[1]);
        const inicio = cabecera + 4;
        if (!Number.isFinite(longitud) || Buffer.byteLength(resto.slice(inicio), 'utf8') < longitud) break;
        const cuerpo = Buffer.from(resto.slice(inicio), 'utf8').subarray(0, longitud).toString('utf8');
        mensajes.push(JSON.parse(cuerpo));
        resto = Buffer.from(resto.slice(inicio), 'utf8').subarray(longitud).toString('utf8');
    }
    return { mensajes, resto };
}

function fallar(motivo, extra = '') {
    console.error(`[smoke-lsp-paridad] ${motivo}${extra ? `\n${extra}` : ''}`);
    process.exit(1);
}

const child = spawn(process.execPath, [serverPath, '--stdio'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
let buffer = '';
let stderr = '';
let diagnosticosUltimos = null;

const timeout = setTimeout(() => {
    child.kill();
    fallar('sin publishDiagnostics del documento en el tiempo previsto', stderr);
}, TIMEOUT_MS);

child.stderr.on('data', chunk => {
    stderr += chunk.toString('utf8');
});

child.stdout.on('data', chunk => {
    buffer += chunk.toString('utf8');
    const { mensajes, resto } = extraerMensajes(buffer);
    buffer = resto;
    for (const mensaje of mensajes) {
        if (mensaje.method !== 'textDocument/publishDiagnostics' || mensaje.params?.uri !== documentUri) continue;
        diagnosticosUltimos = mensaje.params.diagnostics;
        // El índice se completa antes de publicar: la primera publicación ya es la definitiva.
        clearTimeout(timeout);
        verificar(diagnosticosUltimos);
    }
});

function verificar(diagnosticos) {
    child.kill();
    const sinDefinir = diagnosticos
        .filter(d => d.code === 'variableNoDefinida')
        .flatMap(d => d.data?.variable ? [d.data.variable] : [])
        .sort();
    const esperado = [...ESPERADO].sort();
    if (JSON.stringify(sinDefinir) !== JSON.stringify(esperado)) {
        fallar(`variableNoDefinida distinto de lo esperado: ${JSON.stringify(sinDefinir)} (esperado ${JSON.stringify(esperado)})`);
    }
    console.log('[smoke-lsp-paridad] OK');
    process.exit(0);
}

child.on('exit', code => {
    if (diagnosticosUltimos) return;
    clearTimeout(timeout);
    fallar(`LSP terminó antes de publicar diagnósticos (código ${code})`, stderr);
});

sendMessage(child, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { processId: process.pid, rootUri, capabilities: {}, workspaceFolders: [{ uri: rootUri, name: 'runtime-host-scope' }] },
});

setTimeout(() => {
    sendMessage(child, {
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: { textDocument: { uri: documentUri, languageId: 'css', version: 1, text: fs.readFileSync(fixtureFile, 'utf8') } },
    });
}, 200);
