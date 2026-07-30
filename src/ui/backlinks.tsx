import { backlinksFor, linksVersion } from '../search/links';
import { openNote } from '../state';
import { titleOf } from '../util';

/**
 * Panel de menciones entrantes (issue #7): notas que enlazan a la que se
 * está viendo, con su línea de contexto. Va al pie de la nota, dentro del
 * mismo flujo de scroll que el editor (ver .backlinks en styles.css). Si no
 * hay menciones no se renderiza nada, para no estorbar.
 */
export function Backlinks({ path }: { path: string }) {
  // Se lee para suscribirse: cuando el índice de enlaces cambia (guardar,
  // renombrar, borrar en cualquier nota) este panel se recalcula.
  linksVersion.value;
  const items = backlinksFor(path);
  if (items.length === 0) return null;

  return (
    <section class="backlinks">
      <h2 class="backlinks-title">Menciones a esta nota ({items.length})</h2>
      <ul class="backlinks-list">
        {items.map((b, i) => (
          <li
            key={i}
            class="backlinks-item"
            title="Abrir esta nota"
            onClick={() => openNote(b.path)}
          >
            <span class="backlinks-source">{titleOf(b.path)}</span>
            <p class="backlinks-context">{b.lineText.trim() || '(línea vacía)'}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
