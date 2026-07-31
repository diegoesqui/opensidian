import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { vault, vaultError } from '../state';
import { notifyExternalChange } from '../editor/autosave';
import { JOURNAL_TEMPLATE_PATH, readJournalTemplate, TEMPLATE_TOKENS, writeJournalTemplate } from '../templates';

/**
 * Visibilidad del modal de la plantilla del diario (issue #13). Mismo patrón
 * que trashOpen en trash.tsx: señal exportada del propio módulo (no vive en
 * state.ts para no sumar fricción con el trabajo en paralelo sobre ese
 * archivo) y componente renderizado desde app.tsx junto al resto de modales.
 */
export const templateSettingsOpen = signal(false);

export function TemplateSettings() {
  // null mientras se lee el archivo de la plantilla (o si todavía no existe,
  // en cuyo caso queda en '' tras la carga: no hay nada que distinguir entre
  // "sin plantilla" y "plantilla vacía", ambas se comportan igual).
  const [text, setText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const v = vault.value;
    if (!v) return;
    void readJournalTemplate(v).then((t) => setText(t ?? ''));
    return () => window.clearTimeout(savedTimer.current);
  }, []);

  const close = () => (templateSettingsOpen.value = false);

  const save = async () => {
    const v = vault.value;
    if (!v || text === null) return;
    setSaving(true);
    try {
      await writeJournalTemplate(v, text);
      // Defensivo (mismo canal que usa journal.tsx al crear la nota de hoy):
      // hoy esta ruta nunca se abre como nota desde la UI, así que no hay
      // ningún editor con un reloader registrado para ella, pero si eso
      // cambiara es el mecanismo ya existente para avisarlo, no uno nuevo.
      await notifyExternalChange(JOURNAL_TEMPLATE_PATH);
      setSaved(true);
      window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      vaultError.value = e instanceof Error ? e.message : String(e);
    }
    setSaving(false);
  };

  return (
    <div class="modal-backdrop" onClick={close}>
      <div class="modal template-modal" onClick={(e) => e.stopPropagation()}>
        <div class="template-header">
          <span class="template-title">🗒️ Plantilla del diario</span>
          <button class="icon" title="Cerrar" onClick={close}>
            ✕
          </button>
        </div>
        {vaultError.value && <p class="error">{vaultError.value}</p>}
        <p class="template-hint">
          Se aplica solo al crear la nota de un día nuevo, nunca a una que ya tenga contenido.
          Marcadores disponibles:{' '}
          {TEMPLATE_TOKENS.map(({ token, desc }, i) => (
            <span key={token}>
              <code>{token}</code> ({desc})
              {i < TEMPLATE_TOKENS.length - 1 ? '; ' : '.'}
            </span>
          ))}
        </p>
        <textarea
          class="template-textarea"
          value={text ?? ''}
          disabled={text === null}
          placeholder={
            text === null
              ? 'Cargando…'
              : '## Pendientes\n- [ ] \n\n## Notas de reuniones\n\n{{fecha_larga}} · {{dia_semana}}'
          }
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
        />
        <div class="template-footer">
          <span class="template-saved">{saved ? 'Guardado.' : ''}</span>
          <button
            class="btn primary small"
            disabled={text === null || saving}
            onClick={() => void save()}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
