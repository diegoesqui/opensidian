import { render } from 'preact';
import './font';
import './styles.css';
import { App } from './ui/app';
import { initApp } from './state';
import { initTheme } from './ui/theme';
import { initShortcuts } from './ui/shortcuts';
import { initAutosaveHooks } from './editor/autosave';
import { initUpdateCheck } from './update-check';

initTheme();
initShortcuts();
initAutosaveHooks();
void initApp();
initUpdateCheck();

render(<App />, document.getElementById('app')!);
