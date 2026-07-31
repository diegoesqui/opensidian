import { TEMPLATES_DIR, type Vault } from './fs/vault';
import { unmarkDeleted } from './editor/autosave';
import { longDate, weekday } from './util';

/**
 * Ruta de la plantilla del diario dentro del vault (issue #13): una única
 * plantilla fija, no una por carpeta. Vive en TEMPLATES_DIR (fs/vault.ts)
 * para que el nombre de la carpeta interna se defina una sola vez en la capa
 * del vault, igual que ASSETS_DIR y TRASH_DIR.
 */
export const JOURNAL_TEMPLATE_PATH = `${TEMPLATES_DIR}/diario.md`;

/**
 * Ruta antigua de la plantilla del diario, de cuando TEMPLATES_DIR era la
 * carpeta oculta `.plantillas` (issue #13, antes de que el #22 la hiciera
 * visible). Solo se usa en migrateLegacyTemplate(); en cualquier otro sitio
 * la ruta correcta es JOURNAL_TEMPLATE_PATH.
 */
const LEGACY_JOURNAL_TEMPLATE_PATH = '.plantillas/diario.md';

const CURSOR_TOKEN = '{{cursor}}';

/**
 * Marcadores sustituibles de una plantilla, con su descripción para mostrar
 * como ayuda en el selector de inserción (issue #22, src/ui/template-insert.tsx).
 * Se definen aquí, junto a applyTemplate() y splitAtCursor(), para que la
 * ayuda que se muestra y lo que de verdad se sustituye no puedan
 * desincronizarse.
 */
export const TEMPLATE_TOKENS: ReadonlyArray<{ token: string; desc: string }> = [
  { token: '{{fecha}}', desc: 'fecha en formato ISO — p. ej. 2026-07-31' },
  { token: '{{fecha_larga}}', desc: 'fecha legible en español — p. ej. 31 de julio de 2026' },
  { token: '{{dia_semana}}', desc: 'día de la semana — p. ej. Jueves' },
  { token: CURSOR_TOKEN, desc: 'dónde queda el cursor tras insertar; al final si no aparece' }
];

/**
 * Lee la plantilla del diario. Devuelve `null` si el vault todavía no tiene
 * una -pasa siempre la primera vez que se usa la app, hasta que alguien crea
 * `templates/diario.md` como cualquier otra nota, desde la barra lateral-;
 * quien llama debe tratarlo como "sin plantilla configurada", no como un
 * error.
 */
export async function readJournalTemplate(v: Vault): Promise<string | null> {
  if (!(await v.exists(JOURNAL_TEMPLATE_PATH))) return null;
  return v.readFile(JOURNAL_TEMPLATE_PATH);
}

/**
 * Sustituye los marcadores de fecha de `template` por los valores de
 * `dateStr` (formato ISO 'AAAA-MM-DD'). Función pura, sin tocar el vault, ni
 * el editor: sirve igual para renderJournalTemplate() (auto-aplicar la
 * plantilla al crear la nota del día) que para insertar una plantilla
 * cualquiera en el cursor (issue #22, src/ui/template-insert.tsx). No toca
 * {{cursor}} -eso es cosa de splitAtCursor()-, porque no todo el que llama a
 * esta función quiere un cursor: renderJournalTemplate() no inserta en
 * ningún editor, solo escribe un archivo.
 */
export function applyTemplate(template: string, dateStr: string): string {
  return template
    .replaceAll('{{fecha_larga}}', longDate(dateStr))
    .replaceAll('{{dia_semana}}', weekday(dateStr))
    .replaceAll('{{fecha}}', dateStr);
}

/**
 * Separa `text` por el marcador {{cursor}}, quitándolo del resultado. Si
 * aparece más de una vez se usa la primera aparición y las demás se borran
 * sin más -el cursor no puede "estar" en dos sitios a la vez-. Si no aparece
 * ninguna, el cursor queda al final del texto (igual que pegar texto normal,
 * sin sorpresas).
 */
export function splitAtCursor(text: string): { text: string; cursorOffset: number } {
  const idx = text.indexOf(CURSOR_TOKEN);
  if (idx === -1) return { text, cursorOffset: text.length };
  const before = text.slice(0, idx);
  const after = text.slice(idx + CURSOR_TOKEN.length).replaceAll(CURSOR_TOKEN, '');
  return { text: before + after, cursorOffset: before.length };
}

/**
 * Contenido con el que crear la nota de un día del diario: la plantilla (si
 * existe) con sus marcadores ya sustituidos, o cadena vacía si el vault
 * todavía no tiene `${TEMPLATES_DIR}/diario.md` -el comportamiento de
 * siempre, de antes de que existiera esta plantilla-. Un {{cursor}} suelto
 * se quita igual que cualquier otro marcador: aquí no hay ningún editor
 * donde dejar el cursor, la nota simplemente se escribe en disco.
 */
export async function renderJournalTemplate(v: Vault, dateStr: string): Promise<string> {
  const template = await readJournalTemplate(v);
  if (template === null) return '';
  return splitAtCursor(applyTemplate(template, dateStr)).text;
}

/**
 * Migración de una sola vez (issue #22): antes la plantilla del diario vivía
 * en la carpeta oculta `.plantillas`; ahora vive en TEMPLATES_DIR, visible
 * como cualquier otra carpeta de notas. Si alguien ya tenía guardada su
 * plantilla en la ruta antigua, se mueve a la nueva la primera vez que se
 * abre el vault tras la actualización. Solo corre si el origen existe y el
 * destino todavía no -así no pisa una plantilla que el usuario ya haya
 * vuelto a crear en el sitio nuevo, y no repite el movimiento en cada
 * apertura una vez migrado, porque a partir de entonces el destino ya
 * existe-.
 */
export async function migrateLegacyTemplate(v: Vault): Promise<void> {
  if (!(await v.exists(LEGACY_JOURNAL_TEMPLATE_PATH))) return;
  if (await v.exists(JOURNAL_TEMPLATE_PATH)) return;
  // A partir de aquí va a existir algo real en JOURNAL_TEMPLATE_PATH: si esa
  // ruta arrastraba una marca de borrado antigua, su editor dejaría de
  // guardar en silencio (isDeleted() empareja por prefijo, ver autosave.ts).
  unmarkDeleted(JOURNAL_TEMPLATE_PATH);
  await v.rename(LEGACY_JOURNAL_TEMPLATE_PATH, JOURNAL_TEMPLATE_PATH);
}
