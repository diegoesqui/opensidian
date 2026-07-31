import type { ComponentChildren } from 'preact';

/**
 * Iconos de la interfaz. Son SVG de trazo (nunca emojis) por tres razones:
 *
 * 1. Los emojis los dibuja el sistema operativo, así que la app se ve
 *    distinta en Mac y en Windows -el mismo problema que ya obligó a
 *    incrustar la fuente Inter (src/font.ts)-.
 * 2. Vienen con su propio color a todo trapo y compiten con el texto; estos
 *    heredan `currentColor`, así que un elemento activo o en hover tiñe su
 *    icono igual que su etiqueta, y en tema oscuro se aclaran solos.
 * 3. Su tamaño real depende de la fuente de emoji y nunca cuadra con la
 *    altura de la línea de texto de al lado.
 *
 * Todos comparten rejilla de 24 y grosor de trazo, así que se pueden mezclar
 * en una misma fila sin que uno pese más que otro. Están dibujados a mano
 * aquí -sin dependencias ni descargas- porque son media docena de trazos y
 * así el HTML de un solo archivo no engorda con una librería entera.
 */

function Svg({ size = 16, children }: { size?: number; children: ComponentChildren }) {
  return (
    <svg
      class="icon-svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

type IconProps = { size?: number };

/** Diario. */
export function IconCalendar(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </Svg>
  );
}

/** Buscar. */
export function IconSearch(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.4 15.4 20.5 20.5" />
    </Svg>
  );
}

/** Tareas. */
export function IconCheckSquare(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="m7.8 12.2 2.8 2.8 5.6-5.9" />
    </Svg>
  );
}

/** Etiquetas. */
export function IconTag(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M11.6 3H4.5A1.5 1.5 0 0 0 3 4.5v7.1c0 .4.2.8.4 1.1l7.9 7.9a1.5 1.5 0 0 0 2.1 0l6.1-6.1a1.5 1.5 0 0 0 0-2.1l-7.9-7.9A1.5 1.5 0 0 0 11.6 3Z" />
      <path d="M7.5 7.5h.01" />
    </Svg>
  );
}

/** Nota / abrir nota. */
export function IconFile(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5Z" />
      <path d="M13.5 3v5.5H19" />
      <path d="M8.5 13.5h7M8.5 17h4.5" />
    </Svg>
  );
}

/** Insertar plantilla (una hoja con su estructura ya puesta). */
export function IconTemplate(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <path d="M3 8.5h18M9 8.5V21" />
    </Svg>
  );
}

/** Papelera. */
export function IconTrash(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 6.5h16" />
      <path d="M9 6.5V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v1.5" />
      <path d="M6.5 6.5 7.4 19a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12.5" />
    </Svg>
  );
}

/** Carpeta. */
export function IconFolder(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 7a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.6.8l1.2 1.7H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </Svg>
  );
}

/** Nueva carpeta. */
export function IconFolderPlus(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 7a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.6.8l1.2 1.7H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <path d="M12 11.5v5M9.5 14h5" />
    </Svg>
  );
}

/** Cambiar de carpeta de notas. */
export function IconFolderOpen(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 8.5V7a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.6.8l1.2 1.7H19a2 2 0 0 1 2 2v1" />
      <path d="M3.2 10.5h17.6l-1.7 8.1a2 2 0 0 1-2 1.4H6.9a2 2 0 0 1-2-1.4Z" />
    </Svg>
  );
}

/** Nueva nota. */
export function IconPlus(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

/** Historial de versiones. */
export function IconClock(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5.3l3.3 2" />
    </Svg>
  );
}

/** Renombrar. */
export function IconPencil(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M16.2 3.9a2.1 2.1 0 0 1 3 3L8.4 17.7 4 19l1.3-4.4Z" />
      <path d="m14.6 5.5 2.9 2.9" />
    </Svg>
  );
}

/** Cerrar / eliminar. */
export function IconX(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" />
    </Svg>
  );
}

/** Imprimir. */
export function IconPrinter(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M7 9V4h10v5" />
      <path d="M7 18H5.5A2.5 2.5 0 0 1 3 15.5v-3A2.5 2.5 0 0 1 5.5 10h13a2.5 2.5 0 0 1 2.5 2.5v3a2.5 2.5 0 0 1-2.5 2.5H17" />
      <rect x="7" y="14.5" width="10" height="6" rx="1.2" />
    </Svg>
  );
}

/** Menú de acciones de la nota (los tres puntos). */
export function IconMore(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Exportar / descargar. */
export function IconDownload(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.5v11M7.5 10.5 12 15l4.5-4.5" />
      <path d="M4 16.5v2A2 2 0 0 0 6 20.5h12a2 2 0 0 0 2-2v-2" />
    </Svg>
  );
}

/** Volver (índice de etiquetas). */
export function IconArrowLeft(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M19 12H5M10.5 6.5 5 12l5.5 5.5" />
    </Svg>
  );
}

/** Tema automático (medio sol, medio luna). */
export function IconThemeAuto(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 4.5a7.5 7.5 0 0 1 0 15Z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Tema claro. */
export function IconSun(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" />
    </Svg>
  );
}

/** Tema oscuro. */
export function IconMoon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20 14.3A8.5 8.5 0 0 1 9.7 4a8.5 8.5 0 1 0 10.3 10.3Z" />
    </Svg>
  );
}

/** Logotipo de la pantalla de inicio. */
export function IconLogo(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5.5 4.5A1.5 1.5 0 0 1 7 3h10a1.5 1.5 0 0 1 1.5 1.5v15a1.5 1.5 0 0 1-1.5 1.5H7a1.5 1.5 0 0 1-1.5-1.5Z" />
      <path d="M3 7.5h3M3 12h3M3 16.5h3" />
      <path d="M9.5 8.5h5M9.5 12h5M9.5 15.5h3" />
    </Svg>
  );
}
