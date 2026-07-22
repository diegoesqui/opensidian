import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [preact(), viteSingleFile()],
  build: {
    target: 'es2022',
    // Todo (incl. la fuente incrustada) debe quedar en el único HTML final:
    // sin esto, Vite emite como archivo aparte cualquier asset > 4 KB.
    assetsInlineLimit: 10 * 1024 * 1024
  }
});
