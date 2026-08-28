# Opensidian

Aplicación de notas markdown **sin instalación**: un único archivo HTML que se abre
en Chrome o Edge y guarda las notas como archivos `.md` planos en una carpeta de tu
equipo. Pensada para ordenadores corporativos sin permisos de administrador.

Las notas son archivos markdown corrientes: la misma carpeta se puede abrir mañana
con Obsidian, Logseq o cualquier editor. No hay base de datos ni formato propietario.

## Descarga

Baja `opensidian.html` de la [última release](https://github.com/diegoesqui/opensidian/releases/latest)
y ábrelo con **doble clic** en **Chrome o Edge**. No hay nada que instalar.

1. Pulsa «Abrir carpeta de notas…» y elige (o crea) tu carpeta de notas.
   Si la pones dentro de **OneDrive/Documentos** tendrás copia de seguridad y
   versionado automáticos sin hacer nada más.
2. En visitas siguientes: «Reabrir …» y un clic para re-autorizar el acceso. Es un
   requisito de seguridad del navegador y no se puede evitar.

Firefox y Safari no soportan la API de carpetas locales. En esos navegadores la app
funciona igual pero guarda las notas dentro del propio navegador, con exportación a
`.zip` para sacarlas.

## Qué hace

**Escribir**

- **Live Preview** estilo Obsidian: los marcadores (`#`, `**`…) solo se ven en la
  línea donde está el cursor. Con `Ctrl/Cmd+E` se pasa a **Código fuente** (el
  markdown tal cual, sin renderizar nada) o a **Solo lectura** (se ve igual que
  Live Preview, pero el documento no se puede tocar).
- Títulos, negrita, cursiva, tachado, `==resaltado==`, superíndices `^x^`,
  subíndices `~x~`, listas, citas, tablas, notas al pie `[^1]` y bloques de código.
- Barra de formato flotante al seleccionar texto, con atajos (`Ctrl+B`, `Ctrl+I`).
- Checkboxes clicables (`- [ ]` / `- [x]`); `Ctrl+Enter` los crea y los cicla.
- **Resaltado de sintaxis** en bloques ```` ```lenguaje ````: 26 lenguajes y 52
  etiquetas contando alias — JSON, YAML, TOML, INI/env, XML, HTML, CSS, SQL, Python,
  JavaScript, TypeScript, Java, Kotlin, Scala, C, C++, C#, Go, Rust, shell, diff,
  Dockerfile y más.
- **Botón de copiar** en la esquina de cada bloque de código, que copia solo el
  código, sin las vallas ```` ``` ````.
- Pegar imágenes y capturas directamente en la nota; se guardan en `assets/`.
- Pegar una URL con texto seleccionado la convierte en enlace markdown.

**Organizar y encontrar**

- Carpetas, con crear, renombrar, mover (arrastrando) y eliminar.
- **Wiki-links** `[[Nota]]` con autocompletado; renombrar una nota reescribe los
  enlaces que apuntaban a ella.
- **Backlinks**: qué notas enlazan a la que tienes abierta.
- **Etiquetas** `#etiqueta` con autocompletado y panel de filtrado.
- **Búsqueda** full-text y **quick switcher** para abrir o crear notas por nombre.
- **Índice** de la nota en un panel lateral plegable.
- **Tareas**: todos los `- [ ]` del vault reunidos en una vista.

**Diario y plantillas**

- **Diario estilo Logseq**: la vista inicial muestra «Hoy» (`journal/AAAA-MM-DD.md`
  se crea solo) con scroll infinito hacia los días anteriores.
- Plantillas reutilizables en la carpeta `templates/`, con marcadores `{{fecha}}`,
  `{{fecha_larga}}`, `{{dia_semana}}` y `{{cursor}}`.

**Seguridad de los datos**

- Autoguardado con debounce mientras escribes, y recarga la nota si el archivo
  cambia en disco (por ejemplo, editado con otro programa).
- **Papelera**: el borrado es recuperable.
- **Historial de versiones** local de cada nota (20 versiones o 14 días).
- Exportar todo a `.zip`.

**Otros**

- Imprimir o exportar a PDF una nota con su formato.
- Tema claro/oscuro automático, con conmutador manual.
- Aviso discreto cuando hay una versión nueva publicada (ver abajo).

## Atajos

| Atajo | Qué hace |
| --- | --- |
| `Ctrl/Cmd + K` | Abrir o crear una nota por nombre |
| `Ctrl/Cmd + J` | Volver al diario |
| `Ctrl/Cmd + E` | Cambiar de modo: Live Preview → Código fuente → Solo lectura |
| `Ctrl/Cmd + S` | Guardar ya (el autoguardado va solo) |
| `Ctrl/Cmd + Shift + F` | Buscar en todas las notas |
| `Ctrl/Cmd + Shift + T` | Tareas pendientes |
| `Ctrl/Cmd + Shift + P` | Insertar plantilla |
| `Ctrl/Cmd + B` / `I` | Negrita / cursiva |
| `Ctrl/Cmd + Enter` | Crear o marcar checkbox |

## Aviso de versión nueva

Al arrancar, y como mucho **una vez al día**, la app consulta la API de GitHub para
ver si hay una release más reciente que la copia que estás usando. Si la hay, aparece
un enlace discreto en el pie de la barra lateral. Si no, no aparece nada.

Si no hay red, GitHub está bloqueado o la respuesta tarda más de 5 segundos, la
comprobación se abandona en silencio: nunca muestra un error ni retrasa el arranque.
Es la única petición a internet que hace la app; todo lo demás es local.

**La app no puede actualizarse sola**, y no es por falta de ganas: el servidor que
sirve los archivos de las releases de GitHub no manda cabeceras CORS, así que la
página no puede descargarse la versión nueva; y un navegador nunca le dice a una
página en qué ruta del disco está, así que tampoco podría escribir encima de sí
misma. Actualizar es bajar el archivo y sustituir el viejo a mano.

## Desarrollo

```bash
npm install
npm run dev        # servidor de desarrollo
npm run check      # comprobación de tipos (tsc --noEmit)
npm run build      # genera dist/opensidian.html, el archivo único
npm run notices    # regenera THIRD-PARTY-NOTICES.txt desde node_modules
```

Añade `?demo` a la URL (`http://localhost:5173/?demo`) para trabajar con un vault de
ejemplo guardado en el navegador (OPFS), sin tocar archivos reales.

El servidor de desarrollo también sirve `dist/`, así que se puede comprobar el
resultado real del build en `http://localhost:5173/dist/opensidian.html`.

## Arquitectura (resumen)

- **Vite + TypeScript + Preact** con señales, y **CodeMirror 6** como editor.
- `src/fs/vault.ts` — capa de acceso a archivos sobre `FileSystemDirectoryHandle`.
  Funciona igual con la carpeta local (File System Access API) que con OPFS
  (almacenamiento del navegador, plan B si una política corporativa bloquea la API).
- `src/editor/live-preview.ts` — decoraciones de CodeMirror que ocultan los
  marcadores markdown fuera de la línea del cursor y renderizan checkboxes, enlaces
  e imágenes.
- `src/editor/editor.ts` — configuración del editor y los lenguajes del resaltado.
- `src/editor/markdown-extras.ts` — la sintaxis que el parser no trae de serie
  (`==resaltado==` y notas al pie), como extensiones de `@lezer/markdown`.
- `src/editor/mode.ts` — el modo (Live Preview / Código fuente / Solo lectura) como
  campo del estado de CodeMirror: quien decora algo lo consulta, y `readOnly` y
  `editable` se calculan a partir de él.
- `src/editor/print-render.ts` — recorre el árbol de sintaxis y construye el HTML de
  impresión, porque CodeMirror solo tiene en el DOM las líneas visibles.
- `src/search/index.ts` — índice MiniSearch en memoria, construido al abrir el vault
  y actualizado en cada guardado. Los índices de enlaces, tareas y etiquetas se
  cuelgan de él y reutilizan su mapa de contenidos.
- `src/history.ts` — versiones de cada nota en IndexedDB, comprimidas con `fflate`.
- `vite-plugin-singlefile` empaqueta todo (JS, CSS, fuente) en un solo HTML.

## Limitaciones conocidas

- El navegador pide re-autorizar el acceso a la carpeta una vez por sesión (un clic).
- Si se edita la misma nota a la vez desde dos sitios, gana el último guardado.
- El autoguardado tiene ~0,5 s de debounce; al cerrar la pestaña justo después de
  teclear, la app hace un guardado de emergencia, pero lo más seguro es `Ctrl+S`.
- El historial de versiones solo registra los cambios hechos desde la app, no los que
  haga otro programa sobre los mismos archivos.
- La app no puede instalar sus propias actualizaciones (explicado más arriba).

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
