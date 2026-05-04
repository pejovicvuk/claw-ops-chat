import { describe, expect, it } from "vitest";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { unified } from "unified";
import type { Root } from "mdast";

import { remarkDisableIndentedCode } from "./remark-disable-indented-code";

function parse(input: string, withDisable: boolean): Root {
  const processor = unified().use(remarkParse).use(remarkGfm);
  if (withDisable) processor.use(remarkDisableIndentedCode);
  return processor.parse(input) as Root;
}

describe("remarkDisableIndentedCode", () => {
  it("turns the diagram-eats-the-rest-of-the-message bug into normal blocks", () => {
    // Reproduces the screenshot: a 4-space-indented ASCII diagram followed
    // by indented prose containing a heading and bold. Without the plugin,
    // remark coalesces all of this into one indented code block.
    const input = [
      "Architecture:",
      "",
      "    ┌──────────────────┐",
      "    │ oauth.company.com │",
      "    └──────────────────┘",
      "",
      "    Concretely: each container kicks off the OAuth flow.",
      "",
      "    ### Option C — Multi-tenant single deployment",
      "",
      "    **Effort**: 2-3 days.",
    ].join("\n");

    const before = parse(input, false);
    const after = parse(input, true);

    // Before: the indented chunks coalesce into a single code node, so the
    // tree degenerates into [paragraph("Architecture:"), code(<everything>)].
    expect(before.children.some((node) => node.type === "code")).toBe(true);
    expect(before.children.some((node) => node.type === "heading")).toBe(false);

    // After: no code node, and the heading is recovered as an h3.
    expect(after.children.some((node) => node.type === "code")).toBe(false);
    const headings = after.children.filter((node) => node.type === "heading");
    expect(headings).toHaveLength(1);
    expect(headings[0]).toMatchObject({ type: "heading", depth: 3 });
  });

  it("leaves fenced code blocks intact", () => {
    const input = "```ts\nconst x = 1;\n```\n";
    const tree = parse(input, true);
    const codeNodes = tree.children.filter((node) => node.type === "code");
    expect(codeNodes).toHaveLength(1);
    expect(codeNodes[0]).toMatchObject({ type: "code", lang: "ts" });
  });

  it("preserves inline code spans", () => {
    const input = "Use `npm install` to install.";
    const tree = parse(input, true);
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].type).toBe("paragraph");
  });

  it("preserves headings, lists, bold, and italics that previously got eaten", () => {
    // Same shape as the bug, scoped down to just the constructs we want to
    // recover when content is under-indented.
    const input = "    ### heading\n\n    - item one\n    - item two\n\n    **bold** and _italic_.";
    const tree = parse(input, true);

    const types = tree.children.map((node) => node.type);
    expect(types).toContain("heading");
    expect(types).toContain("list");
    expect(types).toContain("paragraph");
  });
});
