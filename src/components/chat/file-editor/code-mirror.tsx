"use client";

import { useEffect, useRef } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  rectangularSelection,
  crosshairCursor,
} from "@codemirror/view";
import { indentOnInput, bracketMatching, foldGutter, foldKeymap } from "@codemirror/language";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { autocompletion, completionKeymap, closeBrackets } from "@codemirror/autocomplete";
import { oneDark } from "@codemirror/theme-one-dark";
import { resolveLanguageExtension } from "./language-for-path";

interface CodeMirrorProps {
  value: string;
  onChange: (value: string) => void;
  path: string;
  readOnly?: boolean;
  onSave?: () => void;
  fontSize?: number;
  /** Called once on editor mount with the underlying view, for focus control. */
  onReady?: (view: EditorView) => void;
}

/**
 * Controlled CodeMirror 6 editor. Lazy-loads the right language extension
 * for `path`'s extension. Ctrl/Cmd+S triggers `onSave` without letting
 * the browser's Save Page dialog open.
 */
export function CodeMirror({
  value,
  onChange,
  path,
  readOnly,
  onSave,
  fontSize,
  onReady,
}: CodeMirrorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const readOnlyRef = useRef(!!readOnly);

  // Keep callbacks current without recreating the editor.
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  readOnlyRef.current = !!readOnly;

  // Mount editor once per path. Reinstantiating on path change is the
  // simplest way to swap language support cleanly.
  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;

    (async () => {
      const language = await resolveLanguageExtension(path);
      if (cancelled || !hostRef.current) return;

      const extensions: Extension[] = [
        lineNumbers(),
        foldGutter(),
        drawSelection(),
        history(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        highlightSelectionMatches(),
        EditorView.lineWrapping,
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              onSaveRef.current?.();
              return true;
            },
          },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...foldKeymap,
          ...completionKeymap,
        ]),
        oneDark,
        EditorView.editable.of(!readOnlyRef.current),
        EditorState.readOnly.of(readOnlyRef.current),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
        EditorView.theme({
          "&": fontSize ? { fontSize: `${fontSize}px` } : {},
          ".cm-scroller": {
            fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
          },
        }),
        language,
      ];

      const state = EditorState.create({ doc: value, extensions });
      const view = new EditorView({ state, parent: hostRef.current });
      viewRef.current = view;
      onReady?.(view);
    })();

    return () => {
      cancelled = true;
      viewRef.current?.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- value is synced via the effect below
  }, [path, fontSize]);

  // Sync external value changes without wiping the user's cursor.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  return (
    <div
      ref={hostRef}
      // No `overflow-hidden` here — CodeMirror's own `.cm-scroller` handles
      // scrolling internally. Trapping it with `overflow-hidden` was the
      // root of the "preview can't scroll on mobile" bug.
      className="h-full w-full min-h-0 text-[12px]"
      role="textbox"
      aria-multiline="true"
    />
  );
}
