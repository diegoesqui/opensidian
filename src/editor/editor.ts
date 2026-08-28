import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, drawSelection, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  HighlightStyle,
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
  type StreamParser,
  syntaxHighlighting
} from '@codemirror/language';
import { python } from '@codemirror/lang-python';
import { sql } from '@codemirror/lang-sql';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { xml, html } from '@codemirror/legacy-modes/mode/xml';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { css, sCSS, less } from '@codemirror/legacy-modes/mode/css';
import { c, cpp, java, csharp, scala, kotlin } from '@codemirror/legacy-modes/mode/clike';
import { go } from '@codemirror/legacy-modes/mode/go';
import { rust } from '@codemirror/legacy-modes/mode/rust';
import { tags, type Tag } from '@lezer/highlight';
import { editorModeExtension, type EditorMode } from './mode';
import { livePreview } from './live-preview';
import { copyCodeButton } from './copy-code';
import { tablePreview } from './table-preview';
import { formatKeymap, formatToolbar } from './format-toolbar';
import { blockFormatKeymap } from './block-format';
import { linkPasteHandling } from './paste-link';

/**
 * Envuelve un modo legacy (parser por líneas de @codemirror/legacy-modes) como
 * LanguageDescription. Los modos legacy resaltan algo peor que los parsers
 * Lezer de los paquetes lang-*, pero pesan una fracción y ya vienen todos en
 * una dependencia que el bundle incluye de todas formas por culpa de `shell`,
 * así que para un bloque de código de una nota salen muy a cuenta.
 */
const legacy = (
  name: string,
  mode: StreamParser<unknown>,
  alias: string[] = [],
  tokenTable?: Record<string, Tag>
) =>
  LanguageDescription.of({
    name,
    alias,
    support: new LanguageSupport(
      StreamLanguage.define(tokenTable ? { ...mode, tokenTable } : mode)
    )
  });

// Lenguajes resaltados dentro de los bloques ```lang: el parser de markdown
// enchufa cada uno según la etiqueta del bloque. La etiqueta se busca primero
// por coincidencia exacta contra el nombre y los alias -sin distinguir
// mayúsculas-, así que ```C# y ```c++ funcionan aunque no sean identificadores.
// PySpark = Python y Bash = shell porque son la misma sintaxis a estos efectos.
const codeLanguages = [
  // Lo que más se pega en una nota: datos y configuración.
  LanguageDescription.of({ name: 'json', support: json() }),
  // El modo legacy de YAML etiqueta las claves como `atom` -y solo las claves,
  // según su propio código-, que por defecto se pinta del color de los números.
  // `atom` no está en la tabla por defecto, así que aquí sí se puede remapear
  // para que la clave de un YAML tenga el color de la de un JSON y no la de un 7.
  legacy('yaml', yaml, ['yml'], { atom: tags.propertyName }),
  legacy('toml', toml),
  // En .env / .ini el valor se etiqueta `quote`, un nombre propio de ese modo
  // que la tabla por defecto no conoce, así que hay que darle un tag a mano.
  // La clave (`def`) se queda con su color por defecto: tokenTable solo puede
  // añadir nombres nuevos, no redefinir los que ya trae CodeMirror.
  legacy('ini', properties, ['env', 'dotenv', 'properties', 'conf'], {
    quote: tags.string
  }),
  legacy('xml', xml, ['svg']),
  legacy('html', html, ['htm']),
  legacy('diff', diff, ['patch']),
  legacy('dockerfile', dockerFile, ['docker']),

  // Lenguajes.
  LanguageDescription.of({ name: 'python', alias: ['py', 'pyspark'], support: python() }),
  LanguageDescription.of({ name: 'sql', support: sql() }),
  LanguageDescription.of({ name: 'javascript', alias: ['js', 'mjs', 'cjs'], support: javascript() }),
  LanguageDescription.of({ name: 'jsx', support: javascript({ jsx: true }) }),
  // TypeScript sale gratis: es el mismo paquete lang-javascript ya incluido,
  // solo cambia la configuración del parser.
  LanguageDescription.of({ name: 'typescript', alias: ['ts'], support: javascript({ typescript: true }) }),
  LanguageDescription.of({ name: 'tsx', support: javascript({ typescript: true, jsx: true }) }),
  legacy('shell', shell, ['bash', 'sh', 'zsh']),
  legacy('java', java),
  legacy('kotlin', kotlin, ['kt']),
  legacy('scala', scala),
  legacy('c', c),
  legacy('cpp', cpp, ['c++', 'cc', 'hpp']),
  legacy('csharp', csharp, ['cs', 'c#']),
  legacy('go', go, ['golang']),
  legacy('rust', rust, ['rs']),
  legacy('css', css),
  legacy('scss', sCSS),
  legacy('less', less)
];

const mdHighlight = HighlightStyle.define([
  { tag: tags.heading1, class: 'cm-h1' },
  { tag: tags.heading2, class: 'cm-h2' },
  { tag: tags.heading3, class: 'cm-h3' },
  { tag: tags.heading4, class: 'cm-h4' },
  { tag: tags.heading5, class: 'cm-h5' },
  { tag: tags.heading6, class: 'cm-h6' },
  { tag: tags.strong, fontWeight: '650' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, class: 'cm-strike' },
  { tag: tags.monospace, class: 'cm-inline-code' },
  { tag: tags.quote, class: 'cm-quote' },
  { tag: tags.link, class: 'cm-link' },
  { tag: tags.url, class: 'cm-url' },
  { tag: tags.processingInstruction, class: 'cm-marker' },
  { tag: tags.meta, class: 'cm-marker' },
  { tag: tags.contentSeparator, class: 'cm-marker' },
  // Tokens de los lenguajes dentro de bloques de código.
  { tag: [tags.keyword, tags.moduleKeyword, tags.definitionKeyword, tags.operatorKeyword, tags.modifier], class: 'cm-tok-keyword' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], class: 'cm-tok-string' },
  { tag: [tags.number, tags.bool, tags.atom, tags.null], class: 'cm-tok-number' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], class: 'cm-tok-comment' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], class: 'cm-tok-function' },
  { tag: [tags.typeName, tags.className, tags.namespace], class: 'cm-tok-type' },
  { tag: [tags.operator, tags.derefOperator, tags.punctuation, tags.separator, tags.bracket], class: 'cm-tok-punct' },
  // Claves de JSON, propiedades de CSS y etiquetas de HTML/XML. Sin esta regla
  // las claves de un JSON se quedaban sin color mientras sus valores sí lo
  // tenían, que era justo lo que hacía que un JSON pegado se viese a medias.
  { tag: [tags.propertyName, tags.tagName], class: 'cm-tok-property' },
  { tag: [tags.attributeName, tags.attributeValue], class: 'cm-tok-attribute' },
  // Los tokens `def`, `builtin` y `variable-2` de los modos legacy.
  {
    tag: [
      tags.definition(tags.variableName),
      tags.standard(tags.variableName),
      tags.special(tags.variableName)
    ],
    class: 'cm-tok-variable'
  },
  // Modo diff: líneas añadidas y quitadas.
  { tag: tags.inserted, class: 'cm-tok-inserted' },
  { tag: tags.deleted, class: 'cm-tok-deleted' }
]);

export interface EditorOptions {
  parent: HTMLElement;
  content: string;
  onDocChanged: () => void;
  placeholder?: string;
  /** Modo inicial (issue #32). Los cambios posteriores llegan por setModeEffect. */
  mode?: EditorMode;
  extraExtensions?: Extension[];
}

export function createEditor(opts: EditorOptions): EditorView {
  return new EditorView({
    parent: opts.parent,
    state: EditorState.create({
      doc: opts.content,
      extensions: [
        history(),
        drawSelection(),
        editorModeExtension(opts.mode ?? 'live'),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage, codeLanguages }),
        syntaxHighlighting(mdHighlight),
        livePreview(),
        copyCodeButton(),
        tablePreview(),
        formatToolbar(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        formatKeymap(),
        blockFormatKeymap(),
        linkPasteHandling(),
        opts.placeholder ? placeholder(opts.placeholder) : [],
        EditorView.updateListener.of((update) => {
          if (update.docChanged) opts.onDocChanged();
        }),
        opts.extraExtensions ?? []
      ]
    })
  });
}
