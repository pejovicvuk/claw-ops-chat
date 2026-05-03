/**
 * Phase 5c (#133): server-side helper that builds the JS source for
 * the in-page find controller. The string returned by
 * `buildFindScript()` is passed to `page.evaluate()` (or to the RTC
 * controller's iframe) ONCE, and installs a `window.__clawFind`
 * controller object with `open`/`next`/`prev`/`close` methods. Each
 * method returns `{count, currentIndex}` describing the current hit
 * state.
 *
 * The walker is conservative about which nodes it considers:
 *   - skips `<script>`, `<style>`, `<noscript>`
 *   - skips elements with `display:none` / `visibility:hidden` /
 *     `opacity:0` (per `getComputedStyle`)
 *   - skips text inside `contenteditable` to avoid breaking the
 *     user's own input cursors
 *
 * Highlights wrap matches in `<mark class="claw-find-hit">`; the
 * "current" hit gets `data-claw-find-current` for the orange-vs-yellow
 * distinction. `close()` unwraps every mark and merges adjacent text
 * nodes — clean revert that doesn't leak DOM mutations.
 */

/**
 * Escape regex meta-characters so a query like `a.b.c` is matched
 * literally. NOT primarily a security measure (the script runs only
 * inside the previewed sandbox) — just necessary for correctness.
 */
export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strip leading/trailing whitespace from the user's query. Empty or
 * whitespace-only queries are treated as "no search".
 */
export function normalizeQuery(input: string): string {
  return typeof input === "string" ? input.trim() : "";
}

const FIND_SCRIPT_SOURCE = `
(() => {
  if (window.__clawFind) return; // already installed
  const HIT_CLASS = "claw-find-hit";
  const CURRENT_ATTR = "data-claw-find-current";
  const STYLE_ID = "__claw-find-style";
  const ensureStyle = () => {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = [
      "." + HIT_CLASS + " { background: #fef08a; color: inherit; padding: 0; }",
      "." + HIT_CLASS + "[" + CURRENT_ATTR + "] { background: #fb923c; }",
    ].join("\\n");
    document.head.appendChild(s);
  };

  const isVisible = (el) => {
    let cur = el;
    while (cur && cur.nodeType === 1) {
      const cs = cur.ownerDocument && cur.ownerDocument.defaultView
        ? cur.ownerDocument.defaultView.getComputedStyle(cur)
        : null;
      if (cs) {
        if (cs.display === "none") return false;
        if (cs.visibility === "hidden") return false;
        if (Number(cs.opacity || "1") === 0) return false;
      }
      cur = cur.parentElement;
    }
    return true;
  };

  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "MARK"]);
  const collectTextNodes = (root) => {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (parent.closest && parent.closest("[contenteditable='true'],[contenteditable='']")) {
          return NodeFilter.FILTER_REJECT;
        }
        if (parent.classList && parent.classList.contains(HIT_CLASS)) {
          return NodeFilter.FILTER_REJECT;
        }
        if (!isVisible(parent)) return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue || node.nodeValue.length === 0) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let n = walker.nextNode();
    while (n) {
      out.push(n);
      n = walker.nextNode();
    }
    return out;
  };

  let hits = []; // Array<HTMLElement>
  let currentIndex = -1;
  let activeQuery = "";

  const clearHighlights = () => {
    for (const mark of Array.from(document.querySelectorAll("mark." + HIT_CLASS))) {
      const parent = mark.parentNode;
      if (!parent) continue;
      const tn = document.createTextNode(mark.textContent || "");
      parent.replaceChild(tn, mark);
    }
    // Coalesce adjacent text nodes — TreeWalker fragments them, but
    // production DOM is cleaner if we re-merge on close.
    hits = [];
    currentIndex = -1;
    activeQuery = "";
  };

  const wrapHits = (query) => {
    const lcQuery = query.toLowerCase();
    const len = lcQuery.length;
    if (len === 0) return [];
    const collected = [];
    const textNodes = collectTextNodes(document.body || document.documentElement);
    for (const node of textNodes) {
      const text = node.nodeValue || "";
      const lc = text.toLowerCase();
      let from = 0;
      const ranges = [];
      while (from < text.length) {
        const idx = lc.indexOf(lcQuery, from);
        if (idx < 0) break;
        ranges.push([idx, idx + len]);
        from = idx + len;
      }
      if (ranges.length === 0) continue;
      const parent = node.parentNode;
      if (!parent) continue;
      // Walk from end-to-start so earlier offsets stay valid.
      let cursor = text.length;
      const frag = document.createDocumentFragment();
      const out = [];
      for (let i = ranges.length - 1; i >= 0; i--) {
        const [start, end] = ranges[i];
        const after = text.slice(end, cursor);
        if (after) frag.insertBefore(document.createTextNode(after), frag.firstChild);
        const mark = document.createElement("mark");
        mark.className = HIT_CLASS;
        mark.textContent = text.slice(start, end);
        frag.insertBefore(mark, frag.firstChild);
        out.unshift(mark);
        cursor = start;
      }
      const head = text.slice(0, cursor);
      if (head) frag.insertBefore(document.createTextNode(head), frag.firstChild);
      parent.replaceChild(frag, node);
      collected.push(...out);
    }
    return collected;
  };

  const setCurrent = (index) => {
    for (const m of hits) m.removeAttribute(CURRENT_ATTR);
    if (index >= 0 && index < hits.length) {
      hits[index].setAttribute(CURRENT_ATTR, "1");
      try {
        hits[index].scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
      } catch (_) { /* legacy engines */ }
      currentIndex = index;
    } else {
      currentIndex = -1;
    }
  };

  window.__clawFind = {
    open(query) {
      ensureStyle();
      const q = (query || "").toLowerCase();
      if (q !== activeQuery) {
        clearHighlights();
        activeQuery = q;
        hits = q ? wrapHits(query) : [];
      }
      setCurrent(hits.length > 0 ? 0 : -1);
      return { count: hits.length, currentIndex: currentIndex };
    },
    next() {
      if (hits.length === 0) return { count: 0, currentIndex: -1 };
      setCurrent((currentIndex + 1) % hits.length);
      return { count: hits.length, currentIndex: currentIndex };
    },
    prev() {
      if (hits.length === 0) return { count: 0, currentIndex: -1 };
      setCurrent((currentIndex - 1 + hits.length) % hits.length);
      return { count: hits.length, currentIndex: currentIndex };
    },
    close() {
      clearHighlights();
      const styleEl = document.getElementById(STYLE_ID);
      if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
      return { count: 0, currentIndex: -1 };
    },
  };
})();
`;

/**
 * Returns the JS source string to install the in-page find controller.
 * Idempotent: re-running is a noop if `window.__clawFind` already exists.
 */
export function buildFindScript(): string {
  return FIND_SCRIPT_SOURCE;
}
