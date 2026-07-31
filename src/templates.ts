import { TEMPLATES_DIR, type Vault } from './fs/vault';
import { longDate, weekday } from './util';

/**
 * Ruta de la plantilla del diario dentro del vault (issue #13): una única
 * plantilla fija, no una por carpeta. Vive en TEMPLATES_DIR (fs/vault.ts)
 * para que el nombre de la carpeta interna se defina una sola vez en la capa
 * del vault, igual que ASSETS_DIR y TRASH_DIR.
 */
export const JOURNAL_TEMPLATE_PATH = `${TEMPLATES_DIR}/diario.md`;

/**
 * Marcadores sustituibles de la plantilla, con su descripción para mostrar
 * como ayuda en el modal de configuración. Se definen aquí, junto a
 * applyTemplate(), para que ambos no puedan desincronizarse.
 */
export const TEMPLATE_TOKENS: ReadonlyArray<{ token: string; desc: string }> = [
  { token: '{{fecha}}', desc: 'fecha en formato ISO — p. ej. 2026-07-31' },
  { token: '{{fecha_larga}}', desc: 'fecha legible en español — p. ej. 31 de julio de 2026' },
  { token: '{{dia_semana}}', desc: 'día de la semana — p. ej. Jueves' }
];

/**
 * Lee la plantilla del diario. Devuelve `null` si el vault todavía no tiene
 * una -pasa siempre la primera vez que se usa la app, hasta que alguien
 * guarda algo desde el modal de configuración-; quien llama debe tratarlo
 * como "sin plantilla configurada", no como un error.
 */
export async function readJournalTemplate(v: Vault): Promise<string | null> {
  if (!(await v.exists(JOURNAL_TEMPLATE_PATH))) return null;
  return v.readFile(JOURNAL_TEMPLATE_PATH);
}

/**
 * Guarda la plantilla del diario. A propósito no llama a notifySaved(): como
 * TEMPLATES_DIR empieza por '.', listTree()/buildIndex() ya la ignoran (ver
 * fs/vault.ts) igual que ASSETS_DIR o TRASH_DIR, y no debe aparecer como si
 * fuera una nota más en el buscador o en el selector rápido (Ctrl/⌘K).
 */
export async function writeJournalTemplate(v: Vault, content: string): Promise<void> {
  await v.writeFile(JOURNAL_TEMPLATE_PATH, content);
}

/**
 * Sustituye los marcadores de `template` por los valores de `dateStr`
 * (formato ISO 'AAAA-MM-DD'). Función pura, sin tocar el vault, para poder
 * aplicarla sobre un texto que ya se tiene en memoria.
 */
export function applyTemplate(template: string, dateStr: string): string {
  return template
    .replaceAll('{{fecha_larga}}', longDate(dateStr))
    .replaceAll('{{dia_semana}}', weekday(dateStr))
    .replaceAll('{{fecha}}', dateStr);
}

/**
 * Contenido con el que crear la nota de un día del diario: la plantilla (si
 * existe) con sus marcadores ya sustituidos, o cadena vacía si el vault
 * todavía no tiene `${TEMPLATES_DIR}/diario.md` -el comportamiento de
 * siempre, de antes de que existiera esta plantilla-.
 */
export async function renderJournalTemplate(v: Vault, dateStr: string): Promise<string> {
  const template = await readJournalTemplate(v);
  return template === null ? '' : applyTemplate(template, dateStr);
}
