// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import MarkdownRenderer from "./markdown-renderer";

// React Testing Library doesn't auto-cleanup with our Vitest config (we don't
// load `@testing-library/react/vitest`), so each `render()` would otherwise
// accumulate DOM between tests and break `screen.getByTestId` queries.
afterEach(cleanup);

// Stub the heavy / network-aware preview components so the renderer's
// own behavior is what we test. SyntaxCode lazily loads shiki; the
// preview pills/cards use contexts and fetches that aren't relevant to
// markdown structure.
vi.mock("./previews/syntax-code", () => ({
  SyntaxCode: ({ language, code }: { language: string; code: string }) => (
    <pre data-testid="code-block" data-lang={language}>
      {code}
    </pre>
  ),
}));

vi.mock("./previews/link-preview", () => ({
  LinkPreview: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a data-testid="chat-link" href={href}>
      {children}
    </a>
  ),
}));

vi.mock("./previews/image-preview", () => ({
  ImagePreview: ({ src, alt }: { src: string; alt?: string }) => (
    <span data-testid="image-preview" data-src={src} data-alt={alt ?? ""} />
  ),
}));

vi.mock("./previews/file-path-pill", () => ({
  FilePathPill: ({ path }: { path: string }) => (
    <span data-testid="file-path-pill" data-path={path}>
      {path}
    </span>
  ),
  ResolvedPathPill: ({ candidate }: { candidate: string }) => (
    <span data-testid="resolved-path-pill" data-candidate={candidate}>
      {candidate}
    </span>
  ),
}));

vi.mock("./previews/file-card", () => ({
  FileCard: ({ path }: { path: string }) => (
    <div data-testid="file-card" data-path={path}>
      {path}
    </div>
  ),
  ResolvedFileCard: ({ candidate }: { candidate: string }) => (
    <div data-testid="resolved-file-card" data-candidate={candidate}>
      {candidate}
    </div>
  ),
}));

describe("MarkdownRenderer document variant", () => {
  it("renders h1 with a slug id from rehype-slug", () => {
    const { container } = render(<MarkdownRenderer text="# Hello World" variant="document" />);
    const h1 = container.querySelector("h1");
    expect(h1).not.toBeNull();
    expect(h1?.getAttribute("id")).toBe("hello-world");
    expect(h1?.textContent).toBe("Hello World");
  });

  it("gives h2 a bottom border for visual hierarchy", () => {
    const { container } = render(<MarkdownRenderer text="## Section" variant="document" />);
    const h2 = container.querySelector("h2");
    expect(h2).not.toBeNull();
    expect(h2?.className).toContain("border-b");
    expect(h2?.getAttribute("id")).toBe("section");
  });

  it("renders a GFM pipe table inside an overflow wrapper", () => {
    const md = `| h1 | h2 |\n|---|---|\n| a | b |`;
    const { container } = render(<MarkdownRenderer text={md} variant="document" />);
    const wrapper = container.querySelector(".overflow-x-auto");
    expect(wrapper).not.toBeNull();
    const table = wrapper?.querySelector("table");
    expect(table).not.toBeNull();
    expect(table?.querySelector("th")?.textContent).toBe("h1");
    expect(table?.querySelector("tbody td")?.textContent).toBe("a");
  });

  it("routes a fenced code block to SyntaxCode with the correct language", () => {
    const md = "```ts\nconst x = 1;\n```";
    render(<MarkdownRenderer text={md} variant="document" />);
    const code = screen.getByTestId("code-block");
    expect(code.getAttribute("data-lang")).toBe("ts");
    expect(code.textContent).toBe("const x = 1;");
  });

  it("renders inline code with the canvas-surface chip styling", () => {
    const { container } = render(
      <MarkdownRenderer text="use `npm test` daily" variant="document" />,
    );
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.textContent).toBe("npm test");
    expect(code?.className).toContain("bg-canvas-surface-hover");
  });

  it("renders blockquotes with an accent left border", () => {
    const { container } = render(<MarkdownRenderer text="> remember this" variant="document" />);
    const bq = container.querySelector("blockquote");
    expect(bq).not.toBeNull();
    expect(bq?.className).toContain("border-accent");
  });

  it("renders GFM task list items with a checkbox and no list marker", () => {
    const md = `- [x] done\n- [ ] todo`;
    const { container } = render(<MarkdownRenderer text={md} variant="document" />);
    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(2);
    items.forEach((li) => {
      expect(li.className).toContain("list-none");
    });
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes).toHaveLength(2);
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true);
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(false);
  });

  it("renders a plain external anchor (no LinkPreview unfurl) in document mode", () => {
    render(
      <MarkdownRenderer text="see [Anthropic](https://anthropic.com) docs" variant="document" />,
    );
    expect(screen.queryByTestId("chat-link")).toBeNull();
    const link = screen.getByText("Anthropic") as HTMLAnchorElement;
    expect(link.tagName).toBe("A");
    // rehype-harden normalises absolute URLs through `new URL()`, which
    // appends a trailing slash to bare-host URLs. Assert host+path only.
    expect(link.getAttribute("href")).toMatch(/^https:\/\/anthropic\.com\/?$/);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("renders a thematic break as <hr>", () => {
    const { container } = render(
      <MarkdownRenderer text={"before\n\n---\n\nafter"} variant="document" />,
    );
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("routes images through ImagePreview", () => {
    render(<MarkdownRenderer text="![diagram](https://example.com/d.png)" variant="document" />);
    const img = screen.getByTestId("image-preview");
    expect(img.getAttribute("data-src")).toBe("https://example.com/d.png");
    expect(img.getAttribute("data-alt")).toBe("diagram");
  });
});

describe("MarkdownRenderer chat variant (default)", () => {
  it("wraps inline links in LinkPreview", () => {
    render(<MarkdownRenderer text="see [docs](https://example.com)" />);
    const wrapped = screen.getByTestId("chat-link");
    // rehype-harden normalises bare-host URLs to include a trailing slash.
    expect(wrapped.getAttribute("href")).toMatch(/^https:\/\/example\.com\/?$/);
  });

  it("turns a lone file path on its own line into a FileCard", () => {
    render(<MarkdownRenderer text="/root/notes/plan.md" />);
    const card = screen.getByTestId("file-card");
    expect(card.getAttribute("data-path")).toBe("/root/notes/plan.md");
  });

  it("does not add slug ids to chat headings (no rehype-slug in chat variant)", () => {
    const { container } = render(<MarkdownRenderer text="# Chat heading" />);
    const h1 = container.querySelector("h1");
    expect(h1).not.toBeNull();
    expect(h1?.getAttribute("id")).toBeNull();
  });
});

/* ── Indented-code-block bug regression (CommonMark §4.4) ────────────────
 *
 * When the assistant emits an ASCII diagram with a 4-space indent and
 * continues the prose at the same indent, default CommonMark coalesces
 * everything (diagram + headings + bullets + bold) into a single <pre>
 * block. `remarkDisableIndentedCode` (chat variant only) prevents this. */
describe("MarkdownRenderer chat variant — indented-code-block fix", () => {
  it("recovers headings, bullets, and bold from diagram-followed-by-indented-prose", () => {
    const md = [
      "Architecture:",
      "",
      "    ┌─────────┐",
      "    │  thing  │",
      "    └─────────┘",
      "",
      "    ### Option C",
      "",
      "    - **bold item**",
      "    - second item",
      "",
      "    Trailing prose paragraph.",
    ].join("\n");

    const { container } = render(<MarkdownRenderer text={md} />);

    // The bug rendered the entire post-diagram content as one <pre>; the
    // fix recovers the heading, list, and bold inline element.
    const h3 = container.querySelector("h3");
    expect(h3).not.toBeNull();
    expect(h3?.textContent).toContain("Option C");

    const items = container.querySelectorAll("li");
    expect(items.length).toBeGreaterThanOrEqual(2);

    const strong = container.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe("bold item");
  });

  it("still keeps fenced code blocks working (only indented blocks are disabled)", () => {
    const md = "```ts\nconst x = 1;\n```";
    render(<MarkdownRenderer text={md} />);
    const code = screen.getByTestId("code-block");
    expect(code.getAttribute("data-lang")).toBe("ts");
    expect(code.textContent).toBe("const x = 1;");
  });

  it("preserves indented code blocks in the document variant (CommonMark-faithful)", () => {
    // Document variant intentionally keeps CommonMark §4.4 because authored
    // .md files (READMEs, reports) sometimes use indented code blocks.
    // The renderer's `pre` override unwraps the <pre> tag, but the inner
    // <code> survives and contains both indented lines joined together.
    const md = "Prose:\n\n    code-line-1\n    code-line-2\n";
    const { container } = render(<MarkdownRenderer text={md} variant="document" />);
    const codes = container.querySelectorAll("code");
    const block = Array.from(codes).find((c) => c.textContent?.includes("code-line-1"));
    expect(block).toBeTruthy();
    expect(block?.textContent).toContain("code-line-2");
  });
});

/* ── GitHub-style alerts (`> [!NOTE]` / [!TIP] / etc.) ────────────────── */
describe("MarkdownRenderer — GitHub alerts", () => {
  it.each([
    ["NOTE", "markdown-alert-note"],
    ["TIP", "markdown-alert-tip"],
    ["IMPORTANT", "markdown-alert-important"],
    ["WARNING", "markdown-alert-warning"],
    ["CAUTION", "markdown-alert-caution"],
  ])("renders [!%s] as a .%s callout", (kind, expectedClass) => {
    const md = `> [!${kind}]\n> Heads up about something`;
    const { container } = render(<MarkdownRenderer text={md} />);
    const alert = container.querySelector(`.${expectedClass}`);
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("Heads up");
  });

  it("renders alerts in document variant too", () => {
    const md = "> [!WARNING]\n> Production deploy.";
    const { container } = render(<MarkdownRenderer text={md} variant="document" />);
    expect(container.querySelector(".markdown-alert-warning")).not.toBeNull();
  });
});

/* ── HTML sanitisation (rehype-sanitize) ──────────────────────────────── */
describe("MarkdownRenderer — sanitisation", () => {
  it("strips <script> elements from inline HTML", () => {
    const md = "before <script>window.x = 1;</script> after";
    const { container } = render(<MarkdownRenderer text={md} />);
    expect(container.querySelector("script")).toBeNull();
  });

  it("drops on* event-handler attributes from raw HTML", () => {
    const md = `<a href="https://example.com" onclick="alert(1)">click</a>`;
    const { container } = render(<MarkdownRenderer text={md} />);
    // react-markdown escapes raw inline HTML into text by default; even if
    // a future change enabled rehype-raw, sanitize would strip onclick.
    const allText = container.textContent ?? "";
    expect(allText).not.toContain("onclick=");
  });
});

/* ── Fenced code without a language tag ─────────────────────────────────
 *
 * Long-standing bug: `inlineOrBlockCode` only recognised fences that had
 * a `language-x` className (the SyntaxCode branch). Language-less fences
 * fell through to the inline-pill branch and rendered their multi-line
 * body inside a tiny `<code>` chip with no monospace block layout. The
 * follow-on damage (inverted fence parity for the rest of the message)
 * is covered by the `splitForBoxDrawing` tests in message-bubble's tests. */
describe("MarkdownRenderer — fenced code without a language tag", () => {
  it("renders a multi-line ``` block as a proper code block, not the inline pill", () => {
    const md = "before\n\n```\nline1\nline2\nline3\n```\n\nafter";
    const { container } = render(<MarkdownRenderer text={md} />);

    // The fence should produce a <pre> with the bordered scroll container.
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre?.className).toContain("font-mono");
    expect(pre?.textContent).toContain("line1");
    expect(pre?.textContent).toContain("line2");
    expect(pre?.textContent).toContain("line3");

    // The bordered wrapper makes it visually distinct from inline code.
    const wrapper = pre?.parentElement;
    expect(wrapper?.className).toContain("border-canvas-border");
    expect(wrapper?.className).toContain("overflow-x-auto");

    // Surrounding prose still renders as paragraphs.
    const ps = Array.from(container.querySelectorAll("p")).map((p) => p.textContent);
    expect(ps).toContain("before");
    expect(ps).toContain("after");
  });

  it("keeps the rounded chip styling for genuine inline code spans", () => {
    const { container } = render(<MarkdownRenderer text="run `npm test` daily" />);
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.textContent).toBe("npm test");
    expect(code?.className).toContain("rounded");
    expect(code?.className).toContain("bg-canvas-surface-hover");
  });

  it("does not invert fence parity when a fence contains box-drawing characters", () => {
    // Reproduces the original symptom: a language-less fence surrounding a
    // Unicode box, followed by prose with bold + a heading. Pre-fix, the
    // closing ``` got swallowed and the trailing prose was rendered as one
    // giant inline-code blob. Post-fix, the box renders inside a <pre> and
    // the trailing prose recovers normal markdown formatting.
    const md = [
      "Diagram below:",
      "",
      "```",
      "┌──────┐",
      "│ box  │",
      "└──────┘",
      "```",
      "",
      "## After the diagram",
      "",
      "Here is **bold prose** and an inline `flag`.",
    ].join("\n");
    const { container } = render(<MarkdownRenderer text={md} />);

    const h2 = container.querySelector("h2");
    expect(h2?.textContent).toContain("After the diagram");

    const strong = container.querySelector("strong");
    expect(strong?.textContent).toBe("bold prose");

    // The inline `flag` chip should still be the rounded inline pill.
    const inlineFlag = Array.from(container.querySelectorAll("code")).find(
      (c) => c.textContent === "flag",
    );
    expect(inlineFlag).toBeTruthy();
    expect(inlineFlag?.className).toContain("rounded");
  });
});

/* ── remend self-healing for streaming markdown ────────────────────────── */
describe("MarkdownRenderer — remend self-healing", () => {
  it("closes unterminated bold so it renders as <strong> mid-stream", () => {
    // Default react-markdown would render this as literal "**hello".
    // remend completes the trailing `**` so the parser sees real bold.
    const { container } = render(<MarkdownRenderer text="prefix **hello" />);
    const strong = container.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe("hello");
  });

  it("closes unterminated inline code so it renders as <code>", () => {
    const { container } = render(<MarkdownRenderer text="run `npm test" />);
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.textContent).toBe("npm test");
  });
});
