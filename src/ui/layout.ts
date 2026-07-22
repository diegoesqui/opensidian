import { signal } from '@preact/signals';

const KEY = 'opensidian.sidebarCollapsed';

export const sidebarCollapsed = signal(localStorage.getItem(KEY) === '1');

export function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
  localStorage.setItem(KEY, sidebarCollapsed.value ? '1' : '0');
}
