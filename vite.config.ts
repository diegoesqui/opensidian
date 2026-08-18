import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Antepone los avisos de licencia de terceros al HTML compilado, como
 * comentario.
 *
 * Hace falta porque el build incrusta en el único archivo tanto las
 * bibliotecas como la fuente Inter, y tanto la MIT como la OFL-1.1 de la
 * fuente exigen que el aviso de copyright y el texto de la licencia
 * acompañen a cada copia que se distribuye. Aquí «la copia» es el propio
 * opensidian.html, así que dejar los avisos solo en el repositorio no cubre
 * a quien recibe el archivo suelto.
 *
 * Va como comentario HTML justo detrás del doctype, y no como cadena dentro
 * del JavaScript, para que se vea nada más abrir el archivo con un editor.
 * El texto lo genera `npm run notices` a partir de node_modules.
 */
function licenseNotices(): Plugin {
  return {
    name: 'opensidian-license-notices',
    // `post` para que el comentario acabe delante del HTML ya ensamblado por
    // vite-plugin-singlefile, no en medio de su reescritura.
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const notices = readFileSync('THIRD-PARTY-NOTICES.txt', 'utf8');
        // Un `-->` en el texto cerraría el comentario antes de tiempo y dejaría
        // el resto de los avisos como contenido visible de la página.
        if (notices.includes('-->')) {
          throw new Error('THIRD-PARTY-NOTICES.txt contiene "-->" y no se puede incrustar como comentario HTML');
        }
        const comentario = `<!--\n${notices}\n-->`;
        // Detras del doctype, no delante: un comentario antes del doctype hace
        // que algunos motores caigan en modo quirks.
        const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
        return doctype
          ? `${doctype[0]}\n${comentario}${html.slice(doctype[0].length)}`
          : `${comentario}\n${html}`;
      }
    }
  };
}

export default defineConfig({
  plugins: [preact(), viteSingleFile(), licenseNotices()],
  build: {
    target: 'es2022',
    // Todo (incl. la fuente incrustada) debe quedar en el único HTML final:
    // sin esto, Vite emite como archivo aparte cualquier asset > 4 KB.
    assetsInlineLimit: 10 * 1024 * 1024
  }
});
