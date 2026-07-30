import { signal } from '@preact/signals';

const KEY = 'opensidian.sidebarCollapsed';
const OUTLINE_KEY = 'opensidian.outlineCollapsed';

export const sidebarCollapsed = signal(localStorage.getItem(KEY) === '1');

export function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
  localStorage.setItem(KEY, sidebarCollapsed.value ? '1' : '0');
}

export const outlineCollapsed = signal(localStorage.getItem(OUTLINE_KEY) === '1');

export function toggleOutline() {
  outlineCollapsed.value = !outlineCollapsed.value;
  localStorage.setItem(OUTLINE_KEY, outlineCollapsed.value ? '1' : '0');
}
