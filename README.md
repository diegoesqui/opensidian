# Opensidian

Aplicación de notas markdown **sin instalación**: un único archivo HTML que se abre
en Chrome o Edge y guarda las notas como archivos `.md` planos en una carpeta de tu
equipo. Pensada para ordenadores corporativos sin permisos de administrador.

## Qué hace

- **Notas markdown** con live preview estilo Obsidian: títulos, negrita/cursiva,
  ~~tachado~~, listas, `código`, bloques de código y citas. Los marcadores (`#`, `**`…)
  solo se muestran en la línea donde está el cursor.
- **Checkboxes clicables** (`- [ ]` / `- [x]`) para listas de tareas.
- **Diario estilo Logseq**: la vista inicial muestra «Hoy» (el archivo
  `journal/AAAA-MM-DD.md` se crea solo) y un scroll infinito con los días anteriores.
- **Carpetas** para organizar, con crear/renombrar/eliminar desde la barra lateral.
- **Búsqueda** full-text (`Ctrl+Shift+F`) y quick switcher para abrir/crear notas por
  nombre (`Ctrl+K`). `Ctrl+J` vuelve al diario.
- **Autoguardado** con debounce mientras escribes; recarga la nota si el archivo
  cambia en disco (p. ej. editado con otro programa).
- Tema claro/oscuro automático (con conmutador manual).

Las notas son archivos markdown corrientes: la misma carpeta se puede abrir mañana
con Obsidian, Logseq o cualquier editor. No hay base de datos ni formato propietario.

## Uso (sin instalación)

1. Genera el build (ver abajo) y copia `dist/opensidian.html` al equipo donde lo
   quieras usar (por OneDrive, correo, USB…).
2. Ábrelo con **doble clic** en **Edge o Chrome** (Firefox/Safari no soportan la API
   de carpetas locales; en ese caso la app ofrece guardar dentro del navegador con
   exportación a .zip).
3. Pulsa «Abrir carpeta de notas…» y elige (o crea) tu carpeta de notas.
   💡 Elige una carpeta dentro de **OneDrive/Documentos** para tener copia de
   seguridad y versionado automáticos.
4. En visitas siguientes: «Reabrir …» + un clic para re-autorizar el acceso
   (requisito de seguridad del navegador, no se puede evitar).

## Desarrollo

```bash
npm install
npm run dev        # servidor de desarrollo (añade ?demo a la URL para un vault de prueba en OPFS)
npm run build      # genera dist/opensidian.html (archivo único autocontenido)
```

`?demo` usa un vault en el almacenamiento del navegador (OPFS) con contenido de
ejemplo — útil para probar sin tocar archivos reales.

## Arquitectura (resumen)

- **Vite + TypeScript + Preact** y **CodeMirror 6** como editor.
- `src/fs/vault.ts` — capa de acceso a archivos sobre `FileSystemDirectoryHandle`.
  Funciona igual con la carpeta local (File System Access API) que con OPFS
  (almacenamiento del navegador, plan B si una política corporativa bloquea la API).
- `src/editor/live-preview.ts` — decoraciones de CodeMirror que ocultan los
  marcadores markdown fuera de la línea del cursor y renderizan los checkboxes.
- `src/search/index.ts` — índice MiniSearch en memoria, construido al abrir el vault
  y actualizado en cada guardado. Sin base de datos: los `.md` son la única fuente
  de verdad.
- `vite-plugin-singlefile` empaqueta todo (JS, CSS) en un solo HTML.

## Limitaciones conocidas

- El navegador pide re-autorizar el acceso a la carpeta una vez por sesión (un clic).
- Si se edita la misma nota a la vez desde dos sitios, gana el último guardado.
- El autoguardado tiene ~0,5 s de debounce; al cerrar la pestaña justo después de
  teclear, la app hace un guardado de emergencia, pero lo más seguro es `Ctrl+S`.

## Licencia

El código de Opensidian se publica bajo licencia **MIT** (ver [LICENSE](LICENSE)):
puedes usarlo, modificarlo y redistribuirlo libremente, conservando el aviso de
copyright.

El archivo `opensidian.html` que se descarga de las releases lleva incrustadas,
ya compiladas, las bibliotecas de las que depende la app y la fuente tipográfica
**Inter**, cada una con su propia licencia (MIT, Apache-2.0 y SIL Open Font
License 1.1 en el caso de Inter). Todos esos avisos se reproducen en
[THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt) y **viajan también dentro del
propio HTML**, como comentario al principio del documento, porque esas licencias
exigen que acompañen a cada copia que se distribuye.

Si cambian las dependencias, el archivo de avisos se regenera con:

```bash
npm run notices
```
