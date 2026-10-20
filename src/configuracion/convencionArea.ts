/* [G1] Convención del design system del área de trabajo. Vive fuera de core: la raíz (CLI, LSP,
 * extensión) la inyecta en core. Otro proyecto la cambia en varsense.config.json, no aquí. */
import type { VarsenseEstiloBotonConfig } from '../core/analisis/reglasBotonCss';

/* Valores por defecto de la regla de botón (EstiloBotonEspecifico). */
export const ESTILO_BOTON_CONVENCION: VarsenseEstiloBotonConfig = {
    habilitado: true,
    severidad: 'warning',
    carpeta: 'components',
    patronSelector: 'btn|button',
    patronExcluirArchivo: '^button',
    nombreComponente: 'Button',
    propiedadesComponente: ['variante', 'tamano'],
    propiedadesEstilo: ['padding', 'background', 'background-color', 'border', 'border-radius', 'cursor'],
    minimoPropiedadesEstilo: 2,
};

/* Prefijos que marcan props portadoras de clases (clase, claseAdicional...) además de className/class. */
export const PREFIJOS_PORTADORES_CONVENCION: readonly string[] = ['clase'];

/* Lo que la raíz pasa al core cuando el usuario no configura nada. */
export interface ConvencionArea {
    estiloBoton: VarsenseEstiloBotonConfig;
    prefijosPortadores: string[];
}

export const CONVENCION_AREA: ConvencionArea = {
    estiloBoton: ESTILO_BOTON_CONVENCION,
    prefijosPortadores: [...PREFIJOS_PORTADORES_CONVENCION],
};
