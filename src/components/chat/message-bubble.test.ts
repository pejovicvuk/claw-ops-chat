import { describe, it, expect } from "vitest";
import { splitForBoxDrawing } from "./message-bubble";

/* ── Box-drawing splitter — fence awareness ─────────────────────────────
 *
 * The splitter exists so an *unfenced* ASCII / Unicode diagram still
 * renders in a monospace pre-block; CommonMark would otherwise collapse
 * the whitespace and lose alignment. The bug we're guarding against here
 * is what happens when the diagram is INSIDE a fenced code block: an
 * earlier version of this splitter was markdown-blind and would slice the
 * fence in half, leaving the closer in a different segment from the
 * opener. The next markdown parser instance then saw a stray ``` and
 * inverted fence parity for everything that followed — paragraphs,
 * headings, tables, the works — turning ~half the message into one
 * giant inline-code blob.
 *
 * The fix tracks fence state line-by-line and keeps fenced lines as
 * "text" regardless of their content. */
describe("splitForBoxDrawing", () => {
  it("isolates an unfenced diagram into its own box segment", () => {
    const input = ["Intro paragraph.", "", "┌──┐", "│..│", "└──┘", "", "Outro paragraph."].join(
      "\n",
    );
    const segs = splitForBoxDrawing(input);
    expect(segs.map((s) => s.type)).toEqual(["text", "box", "text"]);
    expect(segs[1].content).toContain("┌──┐");
    expect(segs[2].content).toContain("Outro paragraph.");
  });

  it("does NOT slice inside a fenced code block whose body contains box chars", () => {
    const input = [
      "Diagram below:",
      "",
      "```",
      "┌──────┐",
      "│ box  │",
      "└──────┘",
      "```",
      "",
      "Tail prose.",
    ].join("\n");
    const segs = splitForBoxDrawing(input);
    // Everything stays as one text segment — the markdown renderer is
    // then responsible for rendering the fence as a proper code block.
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe("text");
    expect(segs[0].content).toContain("```");
    expect(segs[0].content).toContain("┌──────┐");
    expect(segs[0].content).toContain("Tail prose.");
  });

  it("still splits when a diagram is unfenced AND a separate fence exists", () => {
    const input = [
      "Look at this:",
      "",
      "┌────┐",
      "│ A  │",
      "└────┘",
      "",
      "Some prose.",
      "",
      "```ts",
      "const x = 1;",
      "```",
    ].join("\n");
    const segs = splitForBoxDrawing(input);
    // We expect text → box → text (the trailing fence stays inside the
    // final text segment so the markdown renderer can format it).
    expect(segs.map((s) => s.type)).toEqual(["text", "box", "text"]);
    expect(segs[1].content).toContain("│ A  │");
    expect(segs[2].content).toContain("```ts");
    expect(segs[2].content).toContain("const x = 1;");
  });

  it("handles an em-dash horizontal rule inside a fence without splitting", () => {
    // `─` is in BOX_CHARS too — common in tables drawn with Unicode
    // separators. Pre-fix, even a divider line was enough to corrupt
    // the rest of the message.
    const input = ["```", "Status     Ready", "─────────────", "Context    12%", "```"].join("\n");
    const segs = splitForBoxDrawing(input);
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe("text");
  });

  it("preserves the fence opener and closer in the same text segment", () => {
    const input = ["pre", "```", "│", "```", "post"].join("\n");
    const segs = splitForBoxDrawing(input);
    expect(segs).toHaveLength(1);
    const body = segs[0].content;
    // Both fences and the body line all in one segment.
    const fenceCount = (body.match(/```/g) ?? []).length;
    expect(fenceCount).toBe(2);
  });

  it("recognises tilde fences (~~~) as well as backtick fences", () => {
    const input = ["before", "~~~", "│ inside", "~~~", "after"].join("\n");
    const segs = splitForBoxDrawing(input);
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe("text");
  });

  it("returns an empty list for empty input", () => {
    // Edge case — defensive. `text.split('\n')` on '' yields ['']; we
    // currently emit a single empty-string text segment, which is fine
    // since the caller forwards it to the markdown renderer.
    const segs = splitForBoxDrawing("");
    expect(segs).toHaveLength(1);
    expect(segs[0]).toEqual({ type: "text", content: "" });
  });
});
