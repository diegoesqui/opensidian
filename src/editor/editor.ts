import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, drawSelection, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { livePreview } from './live-preview';
import { formatKeymap, formatToolbar } from './format-toolbar';
import { blockFormatKeymap } from './block-format';

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
  { tag: tags.contentSeparator, class: 'cm-marker' }
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
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(mdHighlight),
        livePreview(),
        formatToolbar(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        formatKeymap(),
        blockFormatKeymap(),
        opts.placeholder ? placeholder(opts.placeholder) : [],
        EditorView.updateListener.of((update) => {
          if (update.docChanged) opts.onDocChanged();
        }),
        opts.extraExtensions ?? []
      ]
    })
  });
}
