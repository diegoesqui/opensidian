import { signal } from '@preact/signals';
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';

/**
 * Modos de visualización y edición del editor (issue #32):
 *
 *  - `live` («Live Preview»): el de siempre, con los marcadores markdown
 *    ocultos y el formato aplicado en el sitio.
 *  - `raw` («Código fuente»): el texto tal cual está en el archivo. No se
 *    renderiza NADA -ni encabezados, ni tablas, ni imágenes, ni el botón de
 *    copiar de los bloques de código-, pero se puede seguir escribiendo.
 *  - `read` («Solo lectura»): como `live` pero sin poder tocar el documento.
 *
 * Los nombres visibles se quedan en «Live Preview» y «Código fuente» -los que
 * usa Obsidian, uno sin traducir y el otro en español- porque son los que ya
 * le suenan a quien venga de ahí. Y el tercero es «Solo lectura» y no
 * «Lectura» porque se ve IDÉNTICO a Live Preview: lo único que cambia es que
 * no se puede escribir, así que es de eso de lo que tiene que hablar el
 * nombre, o no se entiende para qué está.
 *
 * El modo es de la app, no de cada nota: cambiarlo afecta a la nota abierta y
 * también a los editores del diario (que son varios a la vez). Guardarlo por
 * nota exigiría un almacén propio indexado por ruta, y la petición del issue
 * es evitar ediciones accidentales y poder mirar el markdown, dos cosas que
 * se hacen "ahora mismo", no "para esta nota y para siempre".
 *
 * Se guarda en localStorage igual que el tema y los paneles plegados
 * (ui/layout.ts, ui/theme.tsx): quien deja una nota en solo lectura para no
 * estropearla espera encontrársela igual al volver.
 */

export type EditorMode = 'live' | 'raw' | 'read';

const KEY = 'opensidian.editorMode';

function storedMode(): EditorMode {
  const value = localStorage.getItem(KEY);
  return value === 'raw' || value === 'read' ? value : 'live';
}

export const editorMode = signal<EditorMode>(storedMode());

export function setEditorMode(mode: EditorMode): void {
  editorMode.value = mode;
  localStorage.setItem(KEY, mode);
}

const ORDER: EditorMode[] = ['live', 'raw', 'read'];

/** Rueda entre los tres modos, igual que el botón de tema (ui/theme.tsx). */
export function cycleEditorMode(): void {
  setEditorMode(ORDER[(ORDER.indexOf(editorMode.value) + 1) % ORDER.length]);
}

export const MODE_LABEL: Record<EditorMode, string> = {
  live: 'Live Preview',
  raw: 'Código fuente',
  read: 'Solo lectura'
};

export const MODE_HINT: Record<EditorMode, string> = {
  live: 'El formato se ve aplicado y los marcadores se ocultan',
  raw: 'El texto tal cual está en el archivo, sin renderizar nada',
  read: 'Se ve igual que Live Preview, pero no se puede escribir'
};

// -------- lado CodeMirror --------

/**
 * El modo entra en el estado del editor como un StateField y no como un
 * `Compartment` que se reconfigura. Con un campo, quien dibuja algo
 * (live-preview, tablas, imágenes, el botón de copiar…) se limita a
 * preguntarle al estado que ya tiene delante, y `readOnly`/`editable` se
 * calculan solos a partir de él. Con compartimentos habría que mantener en el
 * sitio de la llamada la lista de qué extensión entra en qué modo, incluidas
 * las que se inyectan desde fuera (la vista previa de imágenes necesita el
 * vault, así que la monta ui/markdown-editor.tsx).
 */
export const setModeEffect = StateEffect.define<EditorMode>();

const modeField = StateField.define<EditorMode>({
  create: () => 'live',
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setModeEffect)) value = effect.value;
    }
    return value;
  }
});

/** El modo de un estado. Si el campo no estuviera instalado, `live`: ninguna
 * extensión debe dejar de dibujar por el hecho de no encontrarlo. */
export function modeOf(state: EditorState): EditorMode {
  return state.field(modeField, false) ?? 'live';
}

/** Modo «Código fuente»: quien decore algo debe devolver `Decoration.none`. */
export function isRawMode(state: EditorState): boolean {
  return modeOf(state) === 'raw';
}

/**
 * Cambio de modo dentro de una actualización. Los ViewPlugin que solo
 * recalculan ante `docChanged`/`selectionSet`/`viewportChanged` no se enterarían
 * de un cambio de modo (no es ninguna de esas cosas) y se quedarían con las
 * decoraciones del modo anterior hasta la siguiente tecla.
 */
export function modeChanged(update: ViewUpdate): boolean {
  return modeOf(update.state) !== modeOf(update.startState);
}

/** Lo mismo para un StateField, que ve las transacciones sueltas. */
export function modeChangedIn(tr: { effects: readonly StateEffect<unknown>[] }): boolean {
  return tr.effects.some((e) => e.is(setModeEffect));
}

export function editorModeExtension(initial: EditorMode): Extension {
  return [
    modeField.init(() => initial),
    // `readOnly` es lo que consultan los comandos de CodeMirror; `editable`
    // es lo que quita el contenteditable del DOM. Hacen falta los dos: sin
    // `editable` el cursor seguiría parpadeando y el navegador aceptaría
    // texto del teclado o de un arrastre antes de que ningún comando pudiera
    // rechazarlo.
    EditorState.readOnly.compute([modeField], (s) => s.field(modeField) === 'read'),
    EditorView.editable.compute([modeField], (s) => s.field(modeField) !== 'read'),
    EditorView.contentAttributes.compute([modeField], (s) => ({
      class: `cm-mode-${s.field(modeField)}`
    }))
  ];
}
