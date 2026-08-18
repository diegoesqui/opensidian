/**
 * Regenera THIRD-PARTY-NOTICES.txt a partir de las licencias reales que hay en
 * node_modules.
 *
 * El archivo resultante se incrusta en el HTML compilado (ver src/licenses.ts):
 * tanto la MIT de las bibliotecas como la OFL-1.1 de la fuente Inter exigen que
 * el aviso de copyright y el texto de la licencia acompañen a cada copia que se
 * distribuye, y aquí «la copia» es el propio opensidian.html.
 *
 * Recorre el árbol de dependencias de producción completo (no solo las directas)
 * porque en el bundle acaban también las transitivas.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const ARCHIVOS_LICENCIA = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'LICENCE', 'COPYING'];

const arbol = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
);

const paquetes = new Set();
(function recorrer(nodo) {
  for (const [nombre, hijo] of Object.entries(nodo.dependencies ?? {})) {
    if (!paquetes.has(nombre)) {
      paquetes.add(nombre);
      recorrer(hijo);
    }
  }
})(arbol);

const leerManifiesto = (pkg) => JSON.parse(readFileSync(join('node_modules', pkg, 'package.json'), 'utf8'));
const idLicencia = (pkg) => leerManifiesto(pkg).license ?? '(sin declarar)';

const textoLicencia = (pkg) => {
  for (const archivo of ARCHIVOS_LICENCIA) {
    const ruta = join('node_modules', pkg, archivo);
    if (existsSync(ruta)) return readFileSync(ruta, 'utf8').trim();
  }
  return null;
};

const ordenados = [...paquetes].sort();
const sinTexto = ordenados.filter((p) => textoLicencia(p) === null);
if (sinTexto.length) {
  // Un paquete sin archivo de licencia no se puede reproducir, así que se avisa
  // en vez de generar en silencio unos avisos incompletos.
  console.error(`AVISO: sin archivo de licencia propio: ${sinTexto.join(', ')}`);
}

// Los paquetes que comparten texto exacto (todo CodeMirror y Lezer son del mismo
// autor) se agrupan para no repetir la misma MIT treinta veces.
const grupos = new Map();
for (const pkg of ordenados) {
  const texto = textoLicencia(pkg);
  if (texto === null) continue;
  const clave = createHash('sha256').update(texto).digest('hex');
  if (!grupos.has(clave)) grupos.set(clave, { texto, pkgs: [] });
  grupos.get(clave).pkgs.push(pkg);
}

const raya = '='.repeat(78);
const partes = [
  `AVISOS DE TERCEROS - Opensidian
===============================

Opensidian se distribuye como un unico archivo HTML que incorpora, ya
compiladas, las bibliotecas de software libre y la fuente tipografica que se
listan aqui. Cada una conserva su licencia original y el aviso de copyright
de sus autores, reproducidos integramente mas abajo.

Cuando varios paquetes comparten exactamente el mismo texto de licencia, este
se reproduce una sola vez, precedido por la lista de paquetes a los que cubre.

El codigo propio de Opensidian se publica bajo licencia MIT (archivo LICENSE).

Este archivo se genera con \`npm run notices\`; no editarlo a mano.
`,
  `Resumen\n-------\n${ordenados.map((p) => `  ${p.padEnd(38)} ${idLicencia(p)}`).join('\n')}\n`
];

for (const { texto, pkgs } of [...grupos.values()].sort((a, b) => a.pkgs[0].localeCompare(b.pkgs[0]))) {
  partes.push(`\n${raya}\n${pkgs.map((p) => `${p}  (${idLicencia(p)})`).join('\n')}\n${raya}\n\n${texto}\n`);
}

writeFileSync('THIRD-PARTY-NOTICES.txt', partes.join('\n'));
console.log(`${paquetes.size} paquetes, ${grupos.size} textos de licencia distintos -> THIRD-PARTY-NOTICES.txt`);
