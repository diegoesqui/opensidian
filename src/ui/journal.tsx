import { useEffect, useRef, useState } from 'preact/hooks';
import { refreshTree, vault, vaultError } from '../state';
import { MarkdownEditor } from './markdown-editor';

const CHUNK = 10;
export const JOURNAL_DIR = 'journal';

const pad = (n: number) => String(n).padStart(2, '0');
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function formatDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const label = new Date(y, m - 1, d).toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

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
        await v.writeFile(todayPath, '');
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
