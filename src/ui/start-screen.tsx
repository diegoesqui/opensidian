import {
  pickFolder,
  reopenStored,
  storedVaultName,
  useBrowserVault,
  vaultError
} from '../state';
import { supportsFolders } from '../fs/vault';

export function StartScreen() {
  const folders = supportsFolders();
  const stored = storedVaultName.value;
  return (
    <div class="start">
      <div class="start-card">
        <h1>📝 Opensidian</h1>
        <p class="tagline">
          Notas en markdown guardadas como archivos en tu equipo.
          <br />
          Sin instalación, sin cuentas, sin nube.
        </p>
        {folders ? (
          <div class="start-actions">
            {stored && (
              <button class="btn primary" onClick={() => void reopenStored(true)}>
                Reabrir «{stored}»
              </button>
            )}
            <button class={stored ? 'btn' : 'btn primary'} onClick={() => void pickFolder()}>
              Abrir carpeta de notas…
            </button>
            <button class="btn subtle" onClick={() => void useBrowserVault()}>
              Usar almacenamiento del navegador
            </button>
          </div>
        ) : (
          <div class="start-actions">
            <p class="warn">
              Este navegador no permite abrir carpetas locales (necesitas Chrome o Edge).
              Puedes continuar guardando dentro del navegador:
            </p>
            <button class="btn primary" onClick={() => void useBrowserVault()}>
              Usar almacenamiento del navegador
            </button>
          </div>
        )}
        {vaultError.value && <p class="error">{vaultError.value}</p>}
        <p class="hint">
          Consejo: elige una carpeta dentro de OneDrive o Documentos para tener copia de
          seguridad automática de tus notas.
        </p>
      </div>
    </div>
  );
}
