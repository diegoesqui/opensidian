import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, drawSelection, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  HighlightStyle,
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
  syntaxHighlighting
} from '@codemirror/language';
import { python } from '@codemirror/lang-python';
import { sql } from '@codemirror/lang-sql';
import { javascript } from '@codemirror/lang-javascript';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { tags } from '@lezer/highlight';
import { livePreview } from './live-preview';
import { tablePreview } from './table-preview';
import { formatKeymap, formatToolbar } from './format-toolbar';
import { blockFormatKeymap } from './block-format';
import { linkPasteHandling } from './paste-link';

// Lenguajes resaltados dentro de los bloques ```lang. PySpark = Python; Bash
// usa el modo legacy "shell". El parser de markdown enchufa cada uno según la
// etiqueta del bloque.
const codeLanguages = [
  LanguageDescription.of({ name: 'python', alias: ['py', 'pyspark'], support: python() }),
  LanguageDescription.of({ name: 'sql', support: sql() }),
  LanguageDescription.of({ name: 'javascript', alias: ['js', 'jsx'], support: javascript() }),
  LanguageDescription.of({
    name: 'shell',
    alias: ['bash', 'sh', 'zsh'],
    support: new LanguageSupport(StreamLanguage.define(shell))
  })
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
  { tag: [tags.keyword, tags.moduleKeyword, tags.definitionKeyword, tags.operatorKeyword], class: 'cm-tok-keyword' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], class: 'cm-tok-string' },
  { tag: [tags.number, tags.bool, tags.atom, tags.null], class: 'cm-tok-number' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], class: 'cm-tok-comment' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], class: 'cm-tok-function' },
  { tag: [tags.typeName, tags.className, tags.namespace], class: 'cm-tok-type' },
  { tag: [tags.operator, tags.derefOperator, tags.punctuation, tags.separator], class: 'cm-tok-punct' }
]);

export interface EditorOptions {
  parent: HTMLElement;
  content: string;
  onDocChanged: () => void;
  placeholder?: string;
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
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage, codeLanguages }),
        syntaxHighlighting(mdHighlight),
        livePreview(),
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
