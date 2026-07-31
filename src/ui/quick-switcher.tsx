import { useEffect, useRef, useState } from 'preact/hooks';
import { createNote, openNote, quickOpen } from '../state';
import { quickMatch } from '../search';
import { normalize, titleOf } from '../util';
import { IconPlus } from './icons';

export function QuickSwitcher() {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const chosen = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const matches = quickMatch(q);
  const offerCreate =
    q.trim().length > 0 && !matches.some((m) => normalize(titleOf(m)) === normalize(q.trim()));
  const total = matches.length + (offerCreate ? 1 : 0);
  const selected = Math.min(sel, Math.max(0, total - 1));

  const close = () => (quickOpen.value = false);
  const choose = (i: number) => {
    if (chosen.current) return;
    chosen.current = true;
    if (i < matches.length) openNote(matches[i]);
    else void createNote('', q.trim());
    close();
  };

  return (
    <div class="modal-backdrop" onClick={close}>
      <div class="modal" onClick={(e) => e.stopPropagation()}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (total > 0) choose(selected);
          }}
        >
          <input
            ref={inputRef}
            class="modal-input"
            placeholder="Abrir o crear nota…"
            value={q}
            onInput={(e) => {
              setQ((e.target as HTMLInputElement).value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((s) => Math.min(s + 1, total - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((s) => Math.max(s - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (total > 0) choose(selected);
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
          {offerCreate && (
            <li
              class={selected === matches.length ? 'sel' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(matches.length);
              }}
            >
              <span class="qs-title">
                <IconPlus size={14} />
                Crear «{q.trim()}»
              </span>
            </li>
          )}
          {total === 0 && <li class="qs-none">Sin coincidencias</li>}
        </ul>
      </div>
    </div>
  );
}
