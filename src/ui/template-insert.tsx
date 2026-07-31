import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { EditorView } from '@codemirror/view';
import { TEMPLATES_DIR } from '../fs/vault';
import { getTargetEditor } from '../editor/autosave';
import { filePaths } from '../search';
import { applyTemplate, splitAtCursor, TEMPLATE_TOKENS } from '../templates';
import { vault, vaultError } from '../state';
import { isoDate, normalize, titleOf } from '../util';

/**
 * Visibilidad del selector de inserción de plantillas (issue #22). Mismo
 * patrón que trashOpen/templateSettingsOpen (antes de que este último se
 * borrara): señal exportada del propio módulo, renderizada desde app.tsx
 * junto al resto de modales.
 */
export const templatePickerOpen = signal(false);

// El editor donde insertar se captura al ABRIR el selector, no al elegir: en
// el momento de elegir el foco ya está en el input del propio modal, así que
// preguntarlo en ese instante devolvería null (o, peor, el editor equivocado
// si mientras tanto se enfocó otro).
let targetEditor: EditorView | null = null;

/**
 * Abre el selector sobre la nota en la que se estaba escribiendo. Se pregunta
 * por getTargetEditor() y no por getActiveEditor() porque al llegar desde el
 * botón de la barra lateral el editor YA ha perdido el foco (lo roba el
 * propio botón al pulsarlo), y con el foco actual a secas la acción se
 * quedaba en el aviso de más abajo aunque hubiera una nota abierta.
 *
 * Cuando de verdad no hay dónde insertar -vista de búsqueda, tareas...- se
 * avisa por el mismo canal que el resto de errores del vault y no se abre el
 * modal: mejor no abrir nada que insertar en un sitio inesperado.
 */
export function openTemplatePicker(): void {
  const editor = getTargetEditor();
  if (!editor) {
    vaultError.value = 'Abre una nota y pon el cursor donde quieras insertar la plantilla.';
    return;
  }
  targetEditor = editor;
  // Limpia un aviso anterior (típicamente el de «enfoca una nota» de más
  // arriba): sin esto se queda pegado en la barra lateral para siempre,
  // porque vaultError solo se limpiaba al abrir un vault.
  vaultError.value = null;
  templatePickerOpen.value = true;
}

/** Plantillas del vault que casan con `query`. filePaths ya tiene todas las
 * rutas indexadas (search/index.ts): filtrar por prefijo es más barato que
 * recorrer el vault aparte, y se mantiene sincronizado solo con el resto de
 * la app. */
function templateMatches(query: string): string[] {
  const q = normalize(query.trim());
  const paths = filePaths.value.filter((p) => p.startsWith(`${TEMPLATES_DIR}/`));
  if (!q) return paths;
  return paths.filter((p) => normalize(titleOf(p)).includes(q) || normalize(p).includes(q));
}

async function insertTemplate(view: EditorView, path: string): Promise<void> {
  const v = vault.value;
  if (!v) return;
  let raw: string;
  try {
    raw = await v.readFile(path);
  } catch (e) {
    vaultError.value = `No se pudo leer «${path}»: ${e instanceof Error ? e.message : String(e)}`;
    return;
  }
  const { text, cursorOffset } = splitAtCursor(applyTemplate(raw, isoDate(new Date())));
  const { from, to } = view.state.selection.main;
  // Un único dispatch con el cambio y la nueva selección: entra en el
  // historial de deshacer como una sola operación, no como texto insertado
  // más un salto de cursor aparte.
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + cursorOffset },
    scrollIntoView: true
  });
  view.focus();
}

export function TemplatePicker() {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const chosen = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const matches = templateMatches(q);
  const selected = Math.min(sel, Math.max(0, matches.length - 1));

  const close = () => {
    templatePickerOpen.value = false;
    targetEditor = null;
  };

  const choose = (i: number) => {
    if (chosen.current) return;
    const path = matches[i];
    if (!path) return;
    chosen.current = true;
    const view = targetEditor;
    close();
    if (view) void insertTemplate(view, path);
  };

  const anyTemplates = filePaths.value.some((p) => p.startsWith(`${TEMPLATES_DIR}/`));

  return (
    <div class="modal-backdrop" onClick={close}>
      <div class="modal" onClick={(e) => e.stopPropagation()}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (matches.length > 0) choose(selected);
          }}
        >
          <input
            ref={inputRef}
            class="modal-input"
            placeholder="Insertar plantilla…"
            value={q}
            onInput={(e) => {
              setQ((e.target as HTMLInputElement).value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((s) => Math.min(s + 1, matches.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((s) => Math.max(s - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (matches.length > 0) choose(selected);
              } else if (e.key === 'Escape') {
                close();
              }
            }}
          />
        </form>
        <ul class="modal-list">
          {matches.map((path, i) => (
            <li
              key={path}
              class={i === selected ? 'sel' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(i);
              }}
            >
              <span class="qs-title">{titleOf(path)}</span>
              <span class="qs-path">{path}</span>
            </li>
          ))}
          {matches.length === 0 && (
            <li class="qs-none">
              {anyTemplates
                ? 'Sin coincidencias'
                : `Todavía no hay plantillas: crea una nota en «${TEMPLATES_DIR}/» desde la barra lateral.`}
            </li>
          )}
        </ul>
        <p class="hint">
          Marcadores disponibles:{' '}
          {TEMPLATE_TOKENS.map(({ token, desc }, i) => (
            <span key={token}>
              {token} ({desc})
              {i < TEMPLATE_TOKENS.length - 1 ? '; ' : '.'}
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}
