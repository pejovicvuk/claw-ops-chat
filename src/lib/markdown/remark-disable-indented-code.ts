import type { Plugin } from "unified";

/**
 * Disables CommonMark indented code blocks (4-space-indent → `<pre><code>`).
 *
 * In LLM chat output, indented code blocks are virtually always unintentional
 * and a source of message-corrupting bugs: when the assistant emits an ASCII
 * diagram with a 4-space indent and continues the prose at the same indent,
 * CommonMark §4.4 coalesces everything (diagram, headings, bullets, bold)
 * into a single `<pre>` block. Fenced code blocks (```` ``` ````) are
 * unaffected — they remain the supported way to mark code in chat output.
 *
 * This plugin attaches a micromark extension to the unified processor that
 * disables the `codeIndented` construct. It only affects the chat variant of
 * `MarkdownRenderer`; the document variant keeps CommonMark-faithful parsing
 * because authored .md files (READMEs, reports) sometimes use indented code
 * blocks legitimately.
 */
export const remarkDisableIndentedCode: Plugin = function remarkDisableIndentedCode() {
  const data = this.data() as Record<string, unknown[] | undefined>;
  const list = (data.micromarkExtensions ??= []) as unknown[];
  list.push({ disable: { null: ["codeIndented"] } });
};
