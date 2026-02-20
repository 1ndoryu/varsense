/*
 * Utilidades funcionales genéricas
 * Debounce, throttle, hashing - no dependen de VS Code API
 */

/*
 * Debounce para funciones (útil para watchers)
 */
export function debounce<T extends (...args: unknown[]) => void>(
    funcion: T,
    espera: number
): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout | null = null;
    
    return (...args: Parameters<T>) => {
        if (timeout) {
            clearTimeout(timeout);
        }
        timeout = setTimeout(() => {
            funcion(...args);
            timeout = null;
        }, espera);
    };
}

/*
 * Throttle para funciones (útil para eventos frecuentes)
 */
export function throttle<T extends (...args: unknown[]) => void>(
    funcion: T,
    limite: number
): (...args: Parameters<T>) => void {
    let enEspera = false;
    
    return (...args: Parameters<T>) => {
        if (!enEspera) {
            funcion(...args);
            enEspera = true;
            setTimeout(() => {
                enEspera = false;
            }, limite);
        }
    };
}

/*
 * Genera un hash simple para strings (útil para caché)
 */
export function hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash;
}
