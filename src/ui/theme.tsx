import { signal } from '@preact/signals';
import { IconMoon, IconSun, IconThemeAuto } from './icons';

export type ThemePref = 'auto' | 'light' | 'dark';

const KEY = 'opensidian.theme';

export const themePref = signal<ThemePref>('auto');

function apply() {
  document.documentElement.dataset.theme = themePref.value;
}

export function initTheme() {
  const stored = localStorage.getItem(KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'auto') {
    themePref.value = stored;
  }
  apply();
}

export function cycleTheme() {
  const order: ThemePref[] = ['auto', 'light', 'dark'];
  themePref.value = order[(order.indexOf(themePref.value) + 1) % order.length];
  localStorage.setItem(KEY, themePref.value);
  apply();
}

export const themeLabel = () =>
  themePref.value === 'auto' ? 'Tema: automático' : themePref.value === 'light' ? 'Tema: claro' : 'Tema: oscuro';

export function ThemeIcon() {
  if (themePref.value === 'auto') return <IconThemeAuto size={15} />;
  return themePref.value === 'light' ? <IconSun size={15} /> : <IconMoon size={15} />;
}
