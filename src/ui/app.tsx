import { currentPath, quickOpen, vault, view } from '../state';
import { StartScreen } from './start-screen';
import { Sidebar } from './sidebar';
import { NoteView } from './note-view';
import { JournalView } from './journal';
import { SearchPanel } from './search-panel';
import { QuickSwitcher } from './quick-switcher';

function EmptyState() {
  return (
    <div class="empty">
      <p>
        Abre una nota con <kbd>Ctrl/⌘ K</kbd> o crea una desde la barra lateral.
      </p>
    </div>
  );
}

export function App() {
  if (!vault.value) return <StartScreen />;
  return (
    <div class="app">
      <Sidebar />
      <main class="main">
        {view.value === 'journal' ? (
          <JournalView />
        ) : view.value === 'search' ? (
          <SearchPanel />
        ) : currentPath.value ? (
          <NoteView path={currentPath.value} />
        ) : (
          <EmptyState />
        )}
      </main>
      {quickOpen.value && <QuickSwitcher />}
    </div>
  );
}
