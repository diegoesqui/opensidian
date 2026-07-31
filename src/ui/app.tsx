import { currentPath, quickOpen, vault, view } from '../state';
import { StartScreen } from './start-screen';
import { Sidebar } from './sidebar';
import { NoteView } from './note-view';
import { JournalView } from './journal';
import { SearchPanel } from './search-panel';
import { TasksPanel } from './tasks-panel';
import { TagsPanel } from './tags-panel';
import { QuickSwitcher } from './quick-switcher';
import { Outline } from './outline';
import { TrashPanel, trashOpen } from './trash';

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
        ) : view.value === 'tasks' ? (
          <TasksPanel />
        ) : view.value === 'tags' ? (
          <TagsPanel />
        ) : currentPath.value ? (
          <NoteView path={currentPath.value} />
        ) : (
          <EmptyState />
        )}
      </main>
      {/* El índice solo acompaña a una nota: el diario y la búsqueda no lo usan. */}
      {view.value === 'note' && currentPath.value && <Outline />}
      {quickOpen.value && <QuickSwitcher />}
      {trashOpen.value && <TrashPanel />}
    </div>
  );
}
