
const VAR_REGEX = /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\s*\)/g;

function extraerVariablesDeValor(valor) {
    const matches = [];
    let match;
    
    // Reset del regex
    VAR_REGEX.lastIndex = 0;
    
    while ((match = VAR_REGEX.exec(valor)) !== null) {
        matches.push({
            nombreCompleto: match[0],
            nombreVariable: match[1],
            fallback: match[2]?.trim() || null,
            inicio: match.index
        });
    }
    
    return matches;
}

console.log("--- Probando Regex Actual ---");

// Caso 1: Simple (Funciona)
const casoSimple = 'var(--color, #fff)';
console.log(`\nProbando: "${casoSimple}"`);
console.log(extraerVariablesDeValor(casoSimple));

// Caso 2: Fallback con función (Falla)
const casoFuncion = 'var(--color, rgb(0, 0, 0))';
console.log(`\nProbando: "${casoFuncion}"`);
const resultadoFuncion = extraerVariablesDeValor(casoFuncion);
console.log(resultadoFuncion);

if (resultadoFuncion.length > 0 && resultadoFuncion[0].fallback === 'rgb(0, 0, 0)') {
    console.log("✅ ÉXITO: Fallback capturado correctamente.");
} else {
    console.log("❌ FALLO: Fallback incorrecto (probablemente cortado).");
}

// Caso 3: Anidado (Falla)
const casoAnidado = 'var(--primary, var(--secondary))';
console.log(`\nProbando: "${casoAnidado}"`);
const resultadoAnidado = extraerVariablesDeValor(casoAnidado);
console.log(resultadoAnidado);

if (resultadoAnidado.length > 0 && resultadoAnidado[0].fallback === 'var(--secondary)') {
    console.log("✅ ÉXITO: Fallback anidado capturado correctamente.");
} else {
    console.log("❌ FALLO: Fallback anidado incorrecto.");
}
