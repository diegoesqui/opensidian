import { useState } from 'preact/hooks';
import { openNote } from '../state';
import { indexReady, searchNotes } from '../search';

export function SearchPanel() {
  const [q, setQ] = useState('');
  const hits = indexReady.value ? searchNotes(q) : [];

  return (
    <div class="search-panel">
      <input
        autofocus
        class="search-input"
        placeholder="Buscar en todas las notas…"
        value={q}
        onInput={(e) => setQ((e.target as HTMLInputElement).value)}
      />
      {!indexReady.value && <p class="muted">Indexando notas…</p>}
      <ul class="results">
        {hits.map((h) => (
          <li key={h.path} onClick={() => openNote(h.path)}>
            <div class="r-title">{h.title}</div>
            <div class="r-path">{h.path}</div>
            {h.snippet && <div class="r-snippet">{h.snippet}</div>}
          </li>
        ))}
      </ul>
      {indexReady.value && q.trim() && hits.length === 0 && (
        <p class="muted">Sin resultados para «{q}»</p>
      )}
    </div>
  );
}
