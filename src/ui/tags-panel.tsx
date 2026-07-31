import { indexReady } from '../search';
import { allTagCounts, notesUsingTag, tagsVersion, type TagHit } from '../search/tags';
import { activeTag, openTag } from '../state';
import { titleOf } from '../util';
import { openNoteAt } from './task-jump';

interface Group {
  path: string;
  title: string;
  items: TagHit[];
}

/** Agrupa los usos de la etiqueta activa por nota, en el mismo orden que TasksPanel. */
function buildGroups(tag: string): Group[] {
  const byPath = new Map<string, TagHit[]>();
  for (const hit of notesUsingTag(tag)) {
    const list = byPath.get(hit.path);
    if (list) list.push(hit);
    else byPath.set(hit.path, [hit]);
  }
  return [...byPath.keys()]
    .sort()
    .map((path) => ({ path, title: titleOf(path), items: byPath.get(path)! }));
}

/** Índice de etiquetas del vault con su número de usos (issue #12). */
function TagIndex() {
  const counts = indexReady.value ? allTagCounts() : [];
  return (
    <div class="tasks-panel">
      <div class="tasks-header">
        <h1>Etiquetas</h1>
      </div>
      {!indexReady.value && <p class="muted">Indexando notas…</p>}
      {indexReady.value && counts.length === 0 && (
        <p class="muted">
          Todavía no hay ninguna etiqueta. Escribe <code>#etiqueta</code> en una nota para crear la
          primera.
        </p>
      )}
      <ul class="tag-index">
        {counts.map((t) => (
          <li key={t.name} class="tag-index-item" onClick={() => openTag(t.name)}>
            <span class="tag-index-name">#{t.name}</span>
            <span class="tag-index-count">{t.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Notas y líneas que usan la etiqueta activa, con vuelta al índice completo. */
function TagResults({ tag }: { tag: string }) {
  const groups = buildGroups(tag);
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div class="tasks-panel">
      <div class="tasks-header tags-result-header">
        <button
          class="btn subtle small tags-back"
          title="Volver al índice de etiquetas"
          onClick={() => (activeTag.value = null)}
        >
          ← Etiquetas
        </button>
        <h1>#{tag}</h1>
      </div>
      {total === 0 && <p class="muted">Ninguna nota usa ya esta etiqueta.</p>}
      {groups.map((g) => (
        <section key={g.path} class="tasks-group">
          <h2
            class="tasks-group-title"
            title={g.path}
            onClick={() => openNoteAt(g.path, g.items[0].pos)}
          >
            {g.title}
          </h2>
          <ul class="tasks-list">
            {g.items.map((hit, i) => (
              <li key={i} class="backlinks-item" onClick={() => openNoteAt(hit.path, hit.pos)}>
                <p class="backlinks-context">{hit.lineText.trim() || '(línea vacía)'}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function TagsPanel() {
  // Nos suscribimos a tagsVersion (mismo patrón que tasksVersion/linksVersion)
  // para recalcular índice y resultados cada vez que el índice de etiquetas
  // cambia (guardar, renombrar, borrar en cualquier nota).
  void tagsVersion.value;
  const tag = activeTag.value;
  return tag ? <TagResults tag={tag} /> : <TagIndex />;
}
