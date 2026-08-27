<script lang="ts">
  import { onMount } from 'svelte';
  import { Editor } from '@tiptap/core';
  import Document from '@tiptap/extension-document';
  import Paragraph from '@tiptap/extension-paragraph';
  import Text from '@tiptap/extension-text';
  import { TextStyle, Color } from '@tiptap/extension-text-style';
  import { UndoRedo } from '@tiptap/extensions';
  import { sanitizeHtml } from '../data/sanitize.ts';

  /**
   * RichEditor — a deliberately minimal tiptap editor: paragraphs, text and a
   * colour mark, nothing else. Everything that reaches persistence goes
   * through `sanitizeHtml` (paste path here; the read path in
   * `toEditorHtml`), so the schema and the sanitizer allowlist agree:
   * p / br / span[style="color: …"] and nothing more.
   *
   * The component owns NO save logic. It reports every document change up via
   * `onUpdate(html)`; DayView keeps the authoritative mirror and the debounce.
   * That split is what lets DayView survive this component being torn down
   * (date change / lazy-chunk swap) without losing the last keystrokes.
   *
   * Interaction constraint (plan / tiptap#7514): every control that can steal
   * focus from the ProseMirror surface binds `pointerup`, never `click`.
   * That rule lives in the CONSUMERS (DayView's palette); this component has
   * no controls of its own, but `applyPen` is written to be safe to call from
   * a pointerup handler — it re-focuses the editor first.
   */

  interface Props {
    initialHtml: string;
    onUpdate: (html: string) => void;
  }
  let { initialHtml, onUpdate }: Props = $props();

  let host: HTMLDivElement;
  let editor: Editor | null = null;

  onMount(() => {
    editor = new Editor({
      element: host,
      extensions: [Document, Paragraph, Text, TextStyle, Color, UndoRedo],
      content: initialHtml,
      editorProps: {
        attributes: { class: 'rich-editor-content', lang: 'ru', 'aria-label': 'Запись на день' },
        transformPastedHTML: (html: string) => sanitizeHtml(html),
      },
      onUpdate: ({ editor: e }) => {
        onUpdate(e.getHTML());
      },
    });
    return () => {
      editor?.destroy();
      editor = null;
    };
  });

  export function setContentSilently(html: string): void {
    editor?.commands.setContent(html, { emitUpdate: false });
  }
  export function applyPen(css: string): void {
    // Works for both cases: with a selection → colors it; collapsed caret →
    // sets the stored mark so subsequent typing uses the pen.
    editor?.chain().focus().setColor(css).run();
  }
  /**
   * O(1) emptiness check on ProseMirror's own document — `isNodeEmpty` on the
   * doc node, no serialization and no HTML re-parse.
   *
   * This exists specifically for DayView's keystroke path: it runs inside
   * ProseMirror's dispatch on EVERY transaction, where the alternative
   * (`isEmptyHtml`) costs two full DOMPurify passes plus a DOMParser parse of
   * the whole document — pathological right after a multi-megabyte paste,
   * exactly when the user is deleting their way back under the byte limit.
   */
  export function isEmpty(): boolean {
    return editor?.isEmpty ?? true;
  }
  export function isComposing(): boolean {
    return editor?.view.composing ?? false;
  }
  export function isFocused(): boolean {
    return editor?.isFocused ?? false;
  }
  export function blurEditor(): void {
    editor?.commands.blur();
  }
  export function onNextCompositionEnd(cb: () => void): void {
    const dom = editor?.view.dom;
    if (!dom) return;
    dom.addEventListener('compositionend', () => cb(), { once: true });
  }
</script>

<div bind:this={host} class="rich-editor-host"></div>

<style>
  .rich-editor-host {
    flex: 1 1 auto;
    width: 100%;
    overflow-y: auto;
  }
  /* ProseMirror content — must keep the 16px iOS zoom floor and sit on the
   * ruled lines (line-height = --paper-line-height, margins zero). */
  .rich-editor-host :global(.rich-editor-content) {
    outline: 0;
    min-height: 100%;
    padding: var(--editor-pad-top, 2px) 18px 24px 18px;
    font-family: -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif;
    font-size: 16px;
    line-height: var(--paper-line-height);
    color: #2c2412;
    caret-color: #2c2412;
  }
  .rich-editor-host :global(.rich-editor-content p) {
    margin: 0;
    line-height: var(--paper-line-height);
    min-height: var(--paper-line-height);
  }
</style>
