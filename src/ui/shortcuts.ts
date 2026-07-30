import { quickOpen, vault, view } from '../state';
import { flushAll } from '../editor/autosave';

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
      }
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );
}
