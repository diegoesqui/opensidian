import { quickOpen, vault, view } from '../state';
import { flushAll } from '../editor/autosave';
import { cycleEditorMode } from '../editor/mode';
import { openTemplatePicker } from './template-insert';

export function initShortcuts() {
  // Fase de captura: los atajos globales deben ganar a los del editor
  // (en macOS CodeMirror liga Ctrl+K a «borrar hasta fin de línea»).
  window.addEventListener(
    'keydown',
    (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      let handled = false;
      if (key === 'k') {
        if (vault.value) quickOpen.value = !quickOpen.value;
        handled = true;
      } else if (key === 's') {
        void flushAll();
        handled = true;
      } else if (key === 'j' && !e.shiftKey) {
        if (vault.value) view.value = 'journal';
        handled = true;
      } else if (key === 'f' && e.shiftKey) {
        if (vault.value) view.value = 'search';
        handled = true;
      } else if (key === 't' && e.shiftKey) {
        if (vault.value) view.value = 'tasks';
        handled = true;
      } else if (key === 'e' && !e.shiftKey) {
        // Mod+E rueda entre Live Preview, código fuente y solo lectura
        // (issue #32). Es la misma tecla con la que Obsidian alterna entre
        // editar y leer, y aquí va en la fase de captura como el resto: el
        // modo también debe poder cambiarse desde el diario, que no tiene
        // menú de nota donde ponerlo.
        if (vault.value) cycleEditorMode();
        handled = true;
      } else if (key === 'p' && e.shiftKey) {
        // Mod+Shift+P: "P" de Plantilla, y coincide con el atajo de paleta
        // de comandos de VSCode/Slack/GitHub, que es justo lo que es este
        // selector (issue #22). No choca con ninguno de los atajos ya
        // usados (Mod+K/S/J, Mod+Shift+F/T).
        if (vault.value) openTemplatePicker();
        handled = true;
      }
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );
}
