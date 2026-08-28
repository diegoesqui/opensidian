import { syntaxTree } from '@codemirror/language';
import type { EditorState, Text } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import type { Vault } from '../fs/vault';
import { mimeForPath } from './images';
import { WIKILINK_RE } from '../wikilink';
import { tagsInLine } from '../tags';

/**
 * Issue #14: renderiza el markdown de una nota a un árbol DOM real, aparte
 * del editor, para poder imprimirlo completo. CodeMirror solo mantiene en el
 * DOM las líneas visibles (virtualización del viewport, ver live-preview.ts
 * y table-preview.ts), así que imprimir el editor tal cual dejaría cortada
 * cualquier nota que no cupiera entera en pantalla.
 *
 * No se añade ninguna librería de markdown nueva (ver el issue): se recorre
 * a mano el árbol de sintaxis de @lezer/markdown que ya trae el editor (con
 * GFM -tablas, tachado, checkboxes, autolinks- y además Subscript/
 * Superscript/Emoji, que @codemirror/lang-markdown activa por defecto en su
 * `markdownLanguage`, ver editor.ts). El árbol se construye SIEMPRE con DOM
 * real (createElement/createTextNode), nunca con innerHTML: así el texto de
 * la nota queda escapado automáticamente y no hay forma de inyectar HTML/JS
 * a través de una nota, ni siquiera con HTML embebido a mano (ver el caso
 * 'HTMLBlock'/'HTMLTag' más abajo, que se muestra como texto literal en vez
 * de interpretarse).
 *
 * Cualquier nodo de bloque o en línea que este recorrido no contemple
 * explícitamente (el árbol de Lezer puede ampliarse) cae en un `default` que
 * conserva el texto fuente en vez de perderlo en silencio -ver el comentario
 * de cada `default` más abajo-.
 */

interface RenderContext {
  vault: Vault | null;
  /** Cargas de imagen en curso: window.print() espera a que resuelvan (ver ui/print.ts). */
  pending: Promise<void>[];
  /** Object URLs creadas para imágenes del vault, a revocar tras imprimir. */
  objectUrls: string[];
}

export interface PrintRender {
  root: HTMLElement;
  /** Resuelve cuando todas las imágenes han cargado (o fallado). */
  ready: Promise<void>;
  /** Revoca los object URLs creados para las imágenes del vault. */
  revoke: () => void;
}

export function renderNoteToHtml(state: EditorState, vault: Vault | null): PrintRender {
  const ctx: RenderContext = { vault, pending: [], objectUrls: [] };
  const root = document.createElement('div');
  root.className = 'print-note-body';
  renderBlockChildren(state.doc, syntaxTree(state).topNode, root, ctx);
  return {
    root,
    ready: Promise.all(ctx.pending).then(() => undefined),
    revoke: () => {
      for (const url of ctx.objectUrls) URL.revokeObjectURL(url);
    }
  };
}

// -------- bloque --------

function renderBlockChildren(doc: Text, parent: SyntaxNode, container: HTMLElement, ctx: RenderContext) {
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    renderBlockNode(doc, node, container, ctx);
  }
}

function renderListItems(doc: Text, listNode: SyntaxNode, listEl: HTMLElement, ctx: RenderContext) {
  for (let item = listNode.firstChild; item; item = item.nextSibling) {
    if (item.name !== 'ListItem') continue; // el ListMark de cada item vive dentro del ListItem, no aquí
    const li = document.createElement('li');
    renderBlockChildren(doc, item, li, ctx);
    listEl.appendChild(li);
  }
}

function renderBlockNode(doc: Text, node: SyntaxNode, container: HTMLElement, ctx: RenderContext) {
  switch (node.name) {
    case 'Paragraph': {
      const p = document.createElement('p');
      renderInlineChildren(doc, node, p, ctx, false);
      container.appendChild(p);
      break;
    }

    case 'ATXHeading1':
    case 'ATXHeading2':
    case 'ATXHeading3':
    case 'ATXHeading4':
    case 'ATXHeading5':
    case 'ATXHeading6': {
      const h = document.createElement(`h${node.name.slice(-1)}`);
      renderInlineChildren(doc, node, h, ctx, false);
      container.appendChild(h);
      break;
    }

    case 'SetextHeading1':
    case 'SetextHeading2': {
      const h = document.createElement(node.name === 'SetextHeading1' ? 'h1' : 'h2');
      renderInlineChildren(doc, node, h, ctx, false);
      container.appendChild(h);
      break;
    }

    case 'Blockquote': {
      const bq = document.createElement('blockquote');
      renderBlockChildren(doc, node, bq, ctx);
      container.appendChild(bq);
      break;
    }

    case 'BulletList': {
      const ul = document.createElement('ul');
      renderListItems(doc, node, ul, ctx);
      container.appendChild(ul);
      break;
    }

    case 'OrderedList': {
      const ol = document.createElement('ol');
      // Respeta el número inicial si la lista no empieza en 1 (p. ej. "5.");
      // <ol> ya numera solo, así que no hace falta más que fijar `start`.
      const firstMark = node.getChild('ListItem')?.getChild('ListMark');
      if (firstMark) {
        const n = parseInt(doc.sliceString(firstMark.from, firstMark.to), 10);
        if (Number.isFinite(n) && n !== 1) ol.start = n;
      }
      renderListItems(doc, node, ol, ctx);
      container.appendChild(ol);
      break;
    }

    case 'Task':
      // Solo aparece como hijo directo de un ListItem (ver TaskParser en
      // @lezer/markdown): el checkbox (TaskMarker, más abajo) y el resto del
      // contenido se insertan directamente en el <li> del llamador, sin
      // envolver en <p>, para que la lista salga compacta.
      renderInlineChildren(doc, node, container, ctx, false);
      break;

    case 'FencedCode': {
      const { lang, code } = fencedCodeBody(doc, node);
      const pre = document.createElement('pre');
      pre.className = 'print-code';
      const codeEl = document.createElement('code');
      if (lang) codeEl.className = `language-${lang}`;
      codeEl.textContent = code;
      pre.appendChild(codeEl);
      container.appendChild(pre);
      break;
    }

    case 'CodeBlock': {
      const pre = document.createElement('pre');
      pre.className = 'print-code';
      const codeEl = document.createElement('code');
      codeEl.textContent = indentedCodeBody(doc, node);
      pre.appendChild(codeEl);
      container.appendChild(pre);
      break;
    }

    case 'Table':
      renderTable(doc, node, container, ctx);
      break;

    case 'HorizontalRule':
      container.appendChild(document.createElement('hr'));
      break;

    case 'HeaderMark':
    case 'QuoteMark':
    case 'ListMark':
    case 'TaskMarker':
      // Marcadores sueltos que puedan colarse como hijo directo de un bloque
      // (p. ej. una cita vacía "> "): se omiten, igual que en línea.
      break;

    case 'LinkReference':
    case 'CommentBlock':
    case 'ProcessingInstructionBlock':
      // Definiciones de enlace y comentarios HTML no tienen representación
      // visual en CommonMark: se omiten a propósito, no es un descuido.
      break;

    case 'HTMLBlock': {
      // HTML embebido en la nota: se muestra como texto literal (nunca se
      // interpreta como marcado real) para no poder inyectar nada al usar el
      // DOM real de la página para imprimir.
      const pre = document.createElement('pre');
      pre.className = 'print-code';
      pre.textContent = doc.sliceString(node.from, node.to);
      container.appendChild(pre);
      break;
    }

    default: {
      // Nodo de bloque no contemplado explícitamente: en vez de perder el
      // contenido en silencio, se muestra como párrafo con el texto fuente
      // tal cual (sin interpretar), para no arriesgar un renderizado
      // incorrecto de algo que no se ha comprobado.
      if (node.from < node.to) {
        const p = document.createElement('p');
        p.textContent = doc.sliceString(node.from, node.to);
        container.appendChild(p);
      }
    }
  }
}

// -------- tablas --------

type Align = 'left' | 'right' | 'center' | null;

function tableAlignment(doc: Text, tableNode: SyntaxNode): Align[] {
  const delim = tableNode.getChild('TableDelimiter');
  if (!delim) return [];
  return doc
    .sliceString(delim.from, delim.to)
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const left = s.startsWith(':');
      const right = s.endsWith(':');
      if (left && right) return 'center';
      if (right) return 'right';
      if (left) return 'left';
      return null;
    });
}

function renderTable(doc: Text, tableNode: SyntaxNode, container: HTMLElement, ctx: RenderContext) {
  const align = tableAlignment(doc, tableNode);
  const table = document.createElement('table');
  table.className = 'print-table';

  const header = tableNode.getChild('TableHeader');
  if (header) {
    const thead = document.createElement('thead');
    thead.appendChild(renderTableRow(doc, header, align, 'th', ctx));
    table.appendChild(thead);
  }

  const tbody = document.createElement('tbody');
  for (const row of tableNode.getChildren('TableRow')) {
    tbody.appendChild(renderTableRow(doc, row, align, 'td', ctx));
  }
  table.appendChild(tbody);
  container.appendChild(table);
}

function renderTableRow(
  doc: Text,
  rowNode: SyntaxNode,
  align: Align[],
  cellTag: 'th' | 'td',
  ctx: RenderContext
): HTMLTableRowElement {
  const tr = document.createElement('tr');
  rowNode.getChildren('TableCell').forEach((cell, i) => {
    const el = document.createElement(cellTag);
    const a = align[i];
    if (a) el.style.textAlign = a;
    renderInlineChildren(doc, cell, el, ctx, false);
    tr.appendChild(el);
  });
  return tr;
}

// -------- código --------

function fencedCodeBody(doc: Text, node: SyntaxNode): { lang: string; code: string } {
  const full = doc.sliceString(node.from, node.to);
  const lines = full.split('\n');
  const openMatch = /^\s*(`{3,}|~{3,})\s*(\S*)/.exec(lines[0]);
  const lang = openMatch ? openMatch[2] : '';
  let end = lines.length;
  if (end > 1 && /^\s*(`{3,}|~{3,})\s*$/.test(lines[end - 1])) end--;
  return { lang, code: lines.slice(1, end).join('\n') };
}

function indentedCodeBody(doc: Text, node: SyntaxNode): string {
  return doc
    .sliceString(node.from, node.to)
    .split('\n')
    .map((l) => l.replace(/^(?: {1,4}|\t)/, ''))
    .join('\n');
}

// -------- en línea --------

function markEnd(doc: Text, node: SyntaxNode): number {
  // Igual que live-preview.ts: el marcador "traga" el único espacio que lo
  // sigue, para que no quede suelto como texto plano en el resultado.
  return doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
}

/**
 * Punto de entrada público: renderiza el contenido en línea de un nodo de
 * bloque (párrafo, encabezado, celda de tabla, Task...) dentro de `into`.
 *
 * Calcula los wikilinks/etiquetas del tramo UNA sola vez (computeAutoSpans)
 * y los "consume" con un cursor propio de esta llamada mientras recorre los
 * hijos del árbol. Esto importa por un caso real: "[[Nota]]" hace que
 * @lezer/markdown intente casar la pareja de corchetes interior como un
 * `Link` (sin URL, ver comentario de renderInlineSpan) -pasa SIEMPRE, no es
 * un caso raro-, y si no se tuviera en cuenta el wikilink saldría duplicado:
 * una vez por ese Link espurio y otra por la detección de wikilink en el
 * texto plano de alrededor.
 */
function renderInlineChildren(
  doc: Text,
  node: SyntaxNode,
  into: HTMLElement,
  ctx: RenderContext,
  linkContext: boolean
) {
  const autoSpans = linkContext ? [] : computeAutoSpans(doc, node.from, node.to);
  const cursor = { i: 0 };
  renderInlineSpan(doc, node, node.from, node.to, into, ctx, linkContext, autoSpans, cursor);
}

/** Recorre los hijos de `parent` que caen dentro de [from, to) -no necesariamente todos-. */
function renderInlineSpan(
  doc: Text,
  parent: SyntaxNode,
  from: number,
  to: number,
  into: HTMLElement,
  ctx: RenderContext,
  linkContext: boolean,
  autoSpans: AutoSpan[],
  cursor: { i: number }
) {
  let pos = from;
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (child.to <= from || child.from >= to) continue;
    if (!linkContext && spanFullyContains(autoSpans, child.from, child.to)) {
      // Hijo que cae ENTERO dentro de un wikilink/etiqueta ya detectado -el
      // caso real es el Link espurio de "[[Nota]]" citado arriba-: se
      // ignora aquí, su texto lo cubre el span que rellena el hueco más
      // abajo (fillGap). Si se procesara también aquí, saldría duplicado.
      continue;
    }
    if (child.from > pos) fillGap(doc, pos, child.from, into, linkContext, autoSpans, cursor);
    pos = renderInlineNode(doc, child, into, ctx, linkContext);
  }
  if (to > pos) fillGap(doc, pos, to, into, linkContext, autoSpans, cursor);
}

function renderInlineNode(
  doc: Text,
  node: SyntaxNode,
  into: HTMLElement,
  ctx: RenderContext,
  linkContext: boolean
): number {
  switch (node.name) {
    case 'HeaderMark':
    case 'QuoteMark':
    case 'ListMark':
      return markEnd(doc, node);

    case 'TaskMarker': {
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.disabled = true;
      box.checked = /x/i.test(doc.sliceString(node.from, node.to));
      box.className = 'print-checkbox';
      into.appendChild(box);
      return markEnd(doc, node);
    }

    case 'EmphasisMark':
    case 'StrikethroughMark':
    case 'CodeMark':
    case 'SuperscriptMark':
    case 'SubscriptMark':
    case 'HighlightMark':
    case 'FootnoteMark':
    case 'LinkMark':
      // Marcadores puramente en línea (**, `, ~~, ^, ==, [^, [/]...): no
      // llevan el espacio de cortesía de los de bloque, se descartan tal cual.
      return node.to;

    case 'Escape':
      // "\" + el carácter escapado: solo interesa el carácter. Un solo
      // carácter no puede casar como wikilink/etiqueta, así que un texto
      // plano simple (sin pasar por el cursor de autoSpans) es correcto.
      appendPlainRun(doc, node.from + 1, node.to, into);
      return node.to;

    case 'Entity':
      into.appendChild(document.createTextNode(decodeEntity(doc.sliceString(node.from, node.to))));
      return node.to;

    case 'HardBreak':
      into.appendChild(document.createElement('br'));
      return node.to;

    case 'Emphasis': {
      const em = document.createElement('em');
      renderInlineChildren(doc, node, em, ctx, linkContext);
      into.appendChild(em);
      return node.to;
    }

    case 'StrongEmphasis': {
      const strong = document.createElement('strong');
      renderInlineChildren(doc, node, strong, ctx, linkContext);
      into.appendChild(strong);
      return node.to;
    }

    case 'Strikethrough': {
      const s = document.createElement('s');
      renderInlineChildren(doc, node, s, ctx, linkContext);
      into.appendChild(s);
      return node.to;
    }

    // Formatos del issue #31 que no vienen en el parser de serie, definidos
    // en markdown-extras.ts. Como cualquier otro nodo en línea: el marcador
    // desaparece (arriba) y el contenido va dentro de su etiqueta HTML.
    case 'Highlight': {
      const mark = document.createElement('mark');
      mark.className = 'print-highlight';
      renderInlineChildren(doc, node, mark, ctx, linkContext);
      into.appendChild(mark);
      return node.to;
    }

    case 'FootnoteRef': {
      // La llamada dentro del texto va en volandas; la etiqueta de la línea
      // de definición ("[^1]: …") se queda a ras, igual que en el editor
      // (ver el caso FootnoteRef de live-preview.ts).
      const isDef = doc.lineAt(node.from).from === node.from && doc.sliceString(node.to, node.to + 1) === ':';
      const el = document.createElement(isDef ? 'span' : 'sup');
      el.className = isDef ? 'print-footnote-label' : 'print-footnote-ref';
      renderInlineChildren(doc, node, el, ctx, linkContext);
      into.appendChild(el);
      return node.to;
    }

    case 'Superscript': {
      const sup = document.createElement('sup');
      renderInlineChildren(doc, node, sup, ctx, linkContext);
      into.appendChild(sup);
      return node.to;
    }

    case 'Subscript': {
      const sub = document.createElement('sub');
      renderInlineChildren(doc, node, sub, ctx, linkContext);
      into.appendChild(sub);
      return node.to;
    }

    case 'InlineCode': {
      // OJO: a diferencia de FencedCode (que si trae un CodeText, ver
      // fencedCodeBody más arriba), InlineCode NO tiene ningún hijo con el
      // texto del código -sus únicos hijos son los dos CodeMark de apertura
      // y cierre, comprobado contra el parser real-. El texto del code span
      // es sencillamente el hueco entre ambos marcadores.
      const marks = node.getChildren('CodeMark');
      const code = document.createElement('code');
      code.className = 'print-inline-code';
      if (marks.length >= 2) {
        const first = marks[0];
        const last = marks[marks.length - 1];
        let text = doc.sliceString(first.to, last.from);
        // CommonMark: un espacio pegado a cada extremo se recorta si el
        // contenido no son solo espacios (permite que un code span empiece
        // por una tilde: "\` \`código\`\` \`").
        if (text.length > 1 && text.startsWith(' ') && text.endsWith(' ') && text.trim() !== '') {
          text = text.slice(1, -1);
        }
        code.textContent = text;
      } else {
        code.textContent = doc.sliceString(node.from, node.to);
      }
      into.appendChild(code);
      return node.to;
    }

    case 'Emoji':
      into.appendChild(document.createTextNode(doc.sliceString(node.from, node.to)));
      return node.to;

    case 'Link':
      renderLink(doc, node, into, ctx);
      return node.to;

    case 'Image':
      renderImage(doc, node, into, ctx);
      return node.to;

    case 'Autolink':
      renderAutolink(doc, node, into);
      return node.to;

    case 'URL':
      // Autolink "pelado" de GFM: un URL/email suelto como hijo directo
      // (no colgado de Link/Image/Autolink, que ya resuelven el suyo por su
      // cuenta más arriba -esos nunca llegan aquí, ver renderLink/
      // renderImage/renderAutolink-) es justo esto: "www.foo.com" o
      // "alguien@dominio.com" sin corchetes ni ángulos alrededor.
      renderBareUrl(doc, node, into);
      return node.to;

    case 'HTMLTag':
    case 'Comment':
    case 'ProcessingInstruction':
      // Igual que HTMLBlock: se conserva como texto literal, nunca se
      // interpreta como marcado real. Se usa appendPlainRun (no fillGap):
      // no tiene sentido detectar wikilinks/etiquetas dentro de HTML
      // embebido en la nota.
      appendPlainRun(doc, node.from, node.to, into);
      return node.to;

    default:
      // Nodo en línea no contemplado explícitamente: se desciende en sus
      // hijos si los tiene (probablemente los sepa renderizar el resto de
      // casos de este switch); si no tiene ninguno, se cae al texto plano de
      // más abajo. Así nunca se pierde contenido en silencio.
      if (node.firstChild) {
        renderInlineChildren(doc, node, into, ctx, linkContext);
      } else {
        appendPlainRun(doc, node.from, node.to, into);
      }
      return node.to;
  }
}

// -------- texto plano: saltos de línea, wikilinks y etiquetas --------

interface AutoSpan {
  start: number;
  end: number;
  kind: 'wikilink' | 'tag';
  label: string;
}

/**
 * Wikilinks `[[Nota]]` y etiquetas `#etiqueta` no son sintaxis markdown
 * estándar (no aparecen en el árbol de Lezer): se detectan aquí con las
 * mismas regex que live-preview.ts/tags.ts, para no divergir. No hace falta
 * comprobar si el texto está dentro de código -esta función solo se llama
 * sobre el rango de un nodo "contenedor" en línea (párrafo, encabezado,
 * celda...), y el código en línea/bloques siempre se resuelve por su propio
 * nodo (InlineCode/FencedCode/CodeBlock) sin pasar por aquí-.
 */
function lineSpansOf(lineText: string): Array<{ start: number; end: number; kind: 'wikilink' | 'tag'; label: string }> {
  const spans: Array<{ start: number; end: number; kind: 'wikilink' | 'tag'; label: string }> = [];
  WIKILINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(lineText))) {
    const inner = m[1];
    const pipe = inner.indexOf('|');
    const label = (pipe >= 0 ? inner.slice(pipe + 1) : inner).trim();
    spans.push({ start: m.index, end: m.index + m[0].length, kind: 'wikilink', label: label || inner.trim() });
  }
  for (const t of tagsInLine(lineText)) {
    spans.push({ start: t.start, end: t.end, kind: 'tag', label: '' });
  }
  return spans.sort((a, b) => a.start - b.start);
}

/**
 * Calcula los wikilinks/etiquetas de TODO el rango [from, to) de una sola
 * vez (una por línea, como live-preview.ts). Se hace de una sola vez y no
 * hueco a hueco: "[[Nota]]" hace que @lezer/markdown intente casar la pareja
 * de corchetes interior como un Link (ver spanFullyContains), lo que trocea
 * el párrafo en varios huecos alrededor del wikilink; si cada hueco
 * reescaneara la línea entera por su cuenta, el mismo wikilink se detectaría
 * -y se pintaría- una vez por hueco.
 */
function computeAutoSpans(doc: Text, from: number, to: number): AutoSpan[] {
  const spans: AutoSpan[] = [];
  if (to <= from) return spans;
  const startLine = doc.lineAt(from);
  const endLine = doc.lineAt(to);
  for (let ln = startLine.number; ln <= endLine.number; ln++) {
    const line = doc.line(ln);
    if (line.to <= from || line.from >= to) continue;
    const lineText = doc.sliceString(line.from, line.to);
    for (const s of lineSpansOf(lineText)) {
      const absStart = line.from + s.start;
      const absEnd = line.from + s.end;
      // Si el rango pedido corta el match por la mitad (p. ej. una celda de
      // tabla que terminara a mitad de un wikilink, algo que no debería
      // pasar con markdown bien formado) se descarta entero antes que
      // recortarlo mal.
      if (absStart < from || absEnd > to) continue;
      spans.push({ start: absStart, end: absEnd, kind: s.kind, label: s.label });
    }
  }
  return spans;
}

function spanFullyContains(spans: AutoSpan[], from: number, to: number): boolean {
  return spans.some((s) => s.start <= from && s.end >= to);
}

/**
 * Rellena el hueco [from, to) con texto plano, intercalando los wikilinks y
 * etiquetas de `autoSpans` que caigan ahí. `cursor` es un contador
 * compartido por TODA la llamada a renderInlineChildren que originó este
 * árbol de huecos: como los huecos se procesan de izquierda a derecha y los
 * spans ya vienen ordenados, basta con avanzarlo, nunca hace falta volver
 * atrás ni re-filtrar toda la lista en cada hueco.
 */
function fillGap(
  doc: Text,
  from: number,
  to: number,
  into: HTMLElement,
  linkContext: boolean,
  autoSpans: AutoSpan[],
  cursor: { i: number }
) {
  if (to <= from) return;
  if (linkContext) {
    // Dentro del texto visible de un enlace no se detectan wikilinks ni
    // etiquetas propias: "[Ver #14](url)" no debe convertirse en una
    // etiqueta dentro del enlace.
    appendPlainRun(doc, from, to, into);
    return;
  }
  let pos = from;
  while (cursor.i < autoSpans.length) {
    const span = autoSpans[cursor.i];
    if (span.end <= pos) {
      cursor.i++; // ya cubierto (typ. por un hijo que se saltó antes, ver renderInlineSpan)
      continue;
    }
    if (span.start >= to) break; // el siguiente span queda fuera de este hueco, se deja para el próximo
    if (span.start > pos) appendPlainRun(doc, pos, span.start, into);
    const el = document.createElement('span');
    if (span.kind === 'wikilink') {
      el.className = 'print-wikilink';
      el.textContent = span.label;
    } else {
      el.className = 'print-tag';
      el.textContent = doc.sliceString(span.start, span.end);
    }
    into.appendChild(el);
    pos = span.end;
    cursor.i++;
  }
  if (to > pos) appendPlainRun(doc, pos, to, into);
}

/** Texto plano sin detección de wikilinks/etiquetas, solo colapsando saltos de línea blandos. */
function appendPlainRun(doc: Text, from: number, to: number, into: HTMLElement) {
  if (to <= from) return;
  // El salto de línea "blando" entre líneas de un mismo párrafo/celda se
  // colapsa a un espacio, como exige CommonMark (un salto real ya llega como
  // nodo HardBreak explícito, no como texto plano suelto).
  const text = doc.sliceString(from, to).replace(/[ \t]*\n[ \t]*/g, ' ');
  if (text) into.appendChild(document.createTextNode(text));
}

let entityDecoder: HTMLTextAreaElement | null = null;

/** Decodifica una entidad HTML (&amp;, &#39;, &#x27;...) usando el propio parser del navegador. */
function decodeEntity(raw: string): string {
  // El nodo Entity de @lezer/markdown solo casa con el patrón de una
  // entidad (&nombre; o &#123; o &#xAB;), nunca con HTML arbitrario, así que
  // asignar a innerHTML aquí es seguro -no es texto de la nota sin acotar-.
  if (!entityDecoder) entityDecoder = document.createElement('textarea');
  entityDecoder.innerHTML = raw;
  return entityDecoder.value;
}

// -------- enlaces e imágenes --------

/** Mismo criterio que openSafeUrl en live-preview.ts: nunca deja pasar javascript:/data:. */
function safeHref(raw: string): string | null {
  const url = raw.trim();
  if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) return url;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return `https://${url}`;
  return null;
}

function renderLink(doc: Text, node: SyntaxNode, into: HTMLElement, ctx: RenderContext) {
  const marks = node.getChildren('LinkMark');
  const urlNode = node.getChild('URL');
  const openMark = marks.find((m) => doc.sliceString(m.from, m.to) === '[');
  const closeMark = marks.find((m) => doc.sliceString(m.from, m.to) === ']');
  if (!openMark || !closeMark) {
    // Forma no reconocida (p. ej. un enlace de referencia sin resolver):
    // se deja el texto fuente tal cual, sin arriesgar un enlace mal formado.
    appendPlainRun(doc, node.from, node.to, into);
    return;
  }
  const href = urlNode ? safeHref(doc.sliceString(urlNode.from, urlNode.to)) : null;
  const wrap = document.createElement(href ? 'a' : 'span');
  if (href) (wrap as HTMLAnchorElement).href = href;
  // linkContext=true: dentro del texto visible de un enlace no se detectan
  // wikilinks/etiquetas propias (ver fillGap), así que no hace falta
  // calcular autoSpans aquí -se le pasa una lista vacía-.
  renderInlineSpan(doc, node, openMark.to, closeMark.from, wrap, ctx, true, [], { i: 0 });
  into.appendChild(wrap);
}

function renderImage(doc: Text, node: SyntaxNode, into: HTMLElement, ctx: RenderContext) {
  const urlNode = node.getChild('URL');
  if (!urlNode) {
    appendPlainRun(doc, node.from, node.to, into);
    return;
  }
  const path = doc.sliceString(urlNode.from, urlNode.to);
  const img = document.createElement('img');
  img.className = 'print-image';
  // Igual que image-preview.ts: se usa la ruta como alt (el widget del
  // editor tampoco extrae el texto alternativo real entre corchetes).
  img.alt = path;
  into.appendChild(img);

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(path);
  if (hasScheme) {
    // URL externa (http, https...): se usa tal cual si el esquema es seguro.
    const href = safeHref(path);
    if (href) img.src = href;
    return;
  }
  if (!ctx.vault) return; // no debería pasar en la práctica: toda nota abierta tiene vault
  const v = ctx.vault;
  const p = v
    .readBinary(path)
    .then((buf) => {
      const url = URL.createObjectURL(new Blob([buf], { type: mimeForPath(path) }));
      ctx.objectUrls.push(url);
      img.src = url;
    })
    .catch(() => {
      img.alt = `Imagen no encontrada: ${path}`;
    });
  ctx.pending.push(p);
}

function autolinkHref(clean: string): string | null {
  if (/^https?:\/\//i.test(clean) || /^mailto:/i.test(clean)) return clean;
  if (/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(clean)) return `mailto:${clean}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(clean)) return null; // otro esquema: no se sabe si es seguro, se deja como texto
  return `https://${clean}`; // dominio pelado (www.foo.com), mismo criterio que safeHref
}

function renderAutolink(doc: Text, node: SyntaxNode, into: HTMLElement) {
  const raw = doc.sliceString(node.from, node.to);
  const clean = raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw;
  const href = autolinkHref(clean);
  // Se imprime `clean` y no `raw`: los ángulos son el marcador de la sintaxis
  // y el editor tambien los oculta desde el issue #31, así que dejarlos aquí
  // haría que el papel no coincidiera con la pantalla.
  if (href) {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = clean;
    into.appendChild(a);
  } else {
    into.appendChild(document.createTextNode(clean));
  }
}

/** Autolink "pelado" de GFM (www.foo.com, correo@dominio.com): un nodo URL suelto, sin ángulos ni corchetes. */
function renderBareUrl(doc: Text, node: SyntaxNode, into: HTMLElement) {
  const raw = doc.sliceString(node.from, node.to);
  const href = autolinkHref(raw);
  if (href) {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = raw;
    into.appendChild(a);
  } else {
    into.appendChild(document.createTextNode(raw));
  }
}
