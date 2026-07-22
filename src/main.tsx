import { render } from 'preact';
import './styles.css';
import { App } from './ui/app';
import { initApp } from './state';
import { initTheme } from './ui/theme';
import { initShortcuts } from './ui/shortcuts';
import { initAutosaveHooks } from './editor/autosave';

initTheme();
initShortcuts();
initAutosaveHooks();
void initApp();

render(<App />, document.getElementById('app')!);
