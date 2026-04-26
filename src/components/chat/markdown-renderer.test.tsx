// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import MarkdownRenderer from "./markdown-renderer";

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
    expect(link.getAttribute("href")).toBe("https://anthropic.com");
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
    expect(wrapped.getAttribute("href")).toBe("https://example.com");
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
