import { useEffect, useRef, useState } from 'preact/hooks';
import { refreshTree, vault, vaultError } from '../state';
import { notifyExternalChange, unmarkDeleted } from '../editor/autosave';
import { notifySaved } from '../search';
import { renderJournalTemplate } from '../templates';
import { formatDay, isoDate } from '../util';
import { MarkdownEditor } from './markdown-editor';

const CHUNK = 10;
export const JOURNAL_DIR = 'journal';

function dayHeading(dateStr: string, today: string): string {
  if (dateStr === today) return 'Hoy';
  if (dateStr === isoDate(new Date(Date.now() - 86_400_000))) return 'Ayer';
  return formatDay(dateStr);
}

export function JournalView() {
  const [today] = useState(() => isoDate(new Date()));
  const [pastDates, setPastDates] = useState<string[] | null>(null);
  const [count, setCount] = useState(CHUNK);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const v = vault.value;
    if (!v) return;
    void (async () => {
      const todayPath = `${JOURNAL_DIR}/${today}.md`;
      if (!(await v.exists(todayPath))) {
        // La plantilla (issue #13) solo se aplica al CREAR la nota de hoy:
        // esta rama solo se alcanza cuando todavía no existe, así que nunca
        // pisa una nota con contenido (aunque esté vacía por otro motivo).
        const content = await renderJournalTemplate(v, today);
        // Igual que createNote() en state.ts: si 'journal' se borró y se
        // recreó, una marca de borrado vieja dejaría este archivo sin
        // guardar en silencio (isDeleted() empareja por prefijo de carpeta).
        unmarkDeleted(todayPath);
        await v.writeFile(todayPath, content);
        // Con contenido de plantilla (p. ej. checkboxes) el archivo debe
        // entrar en los índices de búsqueda, tareas y enlaces desde ya, no
        // solo cuando el usuario lo edite y dispare el autoguardado.
        notifySaved(todayPath, content);
        // Defensivo: si por lo que sea ya hay un editor montado sobre esta
        // ruta, que recargue en vez de quedarse con lo que tenía en memoria.
        await notifyExternalChange(todayPath);
        await refreshTree();
      }
      const root = await v.listTree();
      const journalDir = root.children?.find((c) => c.kind === 'dir' && c.name === JOURNAL_DIR);
      const dates = (journalDir?.children ?? [])
        .filter((c) => c.kind === 'file' && /^\d{4}-\d{2}-\d{2}\.md$/.test(c.name))
        .map((c) => c.name.slice(0, 10))
        .filter((d) => d < today)
        .sort()
        .reverse();
      setPastDates(dates);
    })();
  }, [today]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) setCount((c) => c + CHUNK);
      },
      { rootMargin: '300px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [pastDates, count]);

  if (pastDates === null) {
    return <div class="journal-loading">Cargando el diario…</div>;
  }

  const visible = [today, ...pastDates.slice(0, count)];
  const hasMore = pastDates.length > count;

  return (
    <div class="journal">
      {vaultError.value && <p class="error">{vaultError.value}</p>}
      {visible.map((d) => (
        <section key={d} class="day">
          <h2 class={d === today ? 'day-title today' : 'day-title'}>
            {dayHeading(d, today)}
            {d === today || dayHeading(d, today) === 'Ayer' ? (
              <span class="day-sub">{formatDay(d)}</span>
            ) : null}
          </h2>
          <MarkdownEditor
            path={`${JOURNAL_DIR}/${d}.md`}
            autofocus={d === today}
            placeholder={d === today ? 'Escribe aquí lo de hoy…' : undefined}
          />
        </section>
      ))}
      {hasMore ? (
        <div ref={sentinel} class="journal-more">
          Cargando días anteriores…
        </div>
      ) : (
        <div class="journal-end">— principio del diario —</div>
      )}
    </div>
  );
}
