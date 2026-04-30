import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

/**
 * Singleton pool around a single headless Chromium instance shared by
 * every preview stream connection. Lifecycle:
 *
 *   - Lazy launch: the browser is started on the first `acquirePage`.
 *     Launch is ~1.5–3 s; subsequent context+page creations are
 *     ~50–200 ms.
 *   - Idle shutdown: when `pageCount` drops to zero, an idle timer
 *     starts. After IDLE_SHUTDOWN_MS with zero pages still active,
 *     the browser is closed and the singleton is cleared. Reopening
 *     a preview within the window pays only the page-creation cost;
 *     after the window expires, the next preview pays the full
 *     launch cost again.
 *   - Each preview gets its own BrowserContext (incognito-style),
 *     not just its own page, so cookies + session state for
 *     different ports don't cross-contaminate.
 *
 * The browser binary is whatever the host provides at
 * `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. On the production image that
 * is Alpine's `apk add chromium`. Locally, developers can override
 * the env var to point at any Chromium-compatible binary.
 *
 * `--no-sandbox` is required because Alpine doesn't ship the setuid
 * sandbox helper. Safe here: the container already drops every Linux
 * capability except NET_BIND_SERVICE (see docker-compose.yml), so the
 * security boundary is the container itself, not Chromium's sandbox.
 */

const IDLE_SHUTDOWN_MS = 5 * 60 * 1000;

let browserPromise: Promise<Browser> | null = null;
let pageCount = 0;
let idleTimer: NodeJS.Timeout | null = null;

async function launch(): Promise<Browser> {
  return chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    headless: true,
    args: [
      // Container is the security boundary — no setuid sandbox in
      // Alpine, so disable Chromium's namespacing too.
      "--no-sandbox",
      "--disable-setuid-sandbox",
      // /dev/shm in Docker is tiny (64 MB by default); without this
      // Chromium will OOM on shared-memory allocations.
      "--disable-dev-shm-usage",
      // We previously tried `--use-gl=swiftshader` to enable composited
      // animations, but that flag is unreliable on Alpine's current
      // Chromium and ate CPU without rendering correctly in some cases.
      // Back to `--disable-gpu` — software rasterization is plenty for
      // the typical web app preview, animations work fine via the
      // 2D paint path, and Chromium is more stable in this mode in
      // headless containers.
      "--disable-gpu",
      // Hide scrollbars from screencast frames so they don't double-up
      // with the user's chat-app scrollbar / mobile system bars.
      "--hide-scrollbars",
      // Force JPEG color reproduction to use full-range YUV so text and
      // colored UI elements don't clip on saturated colors (defaults to
      // limited range in some Chromium builds).
      "--force-color-profile=srgb",
      // Phase 3a: let the previewed app autoplay audio without a user
      // gesture inside the headless tab. The user-facing autoplay block
      // still applies on the chat client's `<video>` (browser-level),
      // so this only affects what plays *into* the virtual_sink — not
      // what plays out to the user without their consent.
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
}

async function getBrowser(): Promise<Browser> {
  // If an idle shutdown was scheduled, cancel it now that someone wants the browser back.
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (!browserPromise) {
    browserPromise = launch().catch((err) => {
      // Reset so the next call can retry.
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

export interface AcquiredPage {
  page: Page;
  context: BrowserContext;
  /** Release the page + context. The pool decides when to GC the browser. */
  release: () => Promise<void>;
}

export interface AcquireOpts {
  /**
   * Hook invoked AFTER context+page creation but BEFORE the first
   * `page.goto`. Use it to register CDP bindings or `addInitScript`
   * calls that need to land before any page script runs on the
   * initial navigation — Playwright's init scripts are guaranteed
   * to run before page scripts only when registered ahead of goto.
   *
   * Phase 3b (#127) uses this for the clipboard bridge: the
   * `__clawClipboardCopy` binding + the copy/cut hook injection.
   *
   * If the hook throws, acquirePage propagates the error to the
   * caller. The hook should be idempotent w.r.t. its own state
   * since acquirePage retries are cheap.
   */
  beforeNavigate?: (page: Page, context: BrowserContext) => Promise<void>;
}

/**
 * Acquire a fresh Page in its own isolated BrowserContext, navigated
 * to `http://127.0.0.1:<port>`. Throws if the upstream is unreachable
 * — caller should map that to a `502`-ish WS error frame.
 */
export async function acquirePage(
  port: number,
  opts: AcquireOpts = {},
): Promise<AcquiredPage> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    // DSF=2 renders the page at 2× device pixels — text and UI become
    // crisp on HiDPI / Retina displays. The bitmap is 2× larger than
    // before (so ~2× bandwidth at the same JPEG quality) but the
    // user's browser displays it 1:1 on a 2× display rather than
    // upscaling a 1× capture. The quality preset (handler.ts) lets the
    // user dial frame rate / quality back down if bandwidth is tight.
    deviceScaleFactor: 2,
    // Wide enough that the previewed page can render its desktop
    // breakpoints; the actual canvas size is set by setViewportSize
    // when the canvas mounts.
  });
  const page = await context.newPage();
  pageCount++;

  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    pageCount = Math.max(0, pageCount - 1);
    try {
      await context.close();
    } catch {
      /* page might already be gone */
    }
    if (pageCount === 0) {
      scheduleIdleShutdown();
    }
  };

  if (opts.beforeNavigate) {
    try {
      await opts.beforeNavigate(page, context);
    } catch (err) {
      // Hook failed — release the page and propagate. We treat hook
      // setup as critical: a half-wired clipboard bridge is worse
      // than no bridge at all.
      await release();
      throw err;
    }
  }

  try {
    await page.goto(`http://127.0.0.1:${port}/`, {
      waitUntil: "domcontentloaded",
      timeout: 10_000,
    });
  } catch (err) {
    // Even on failure, return the page so the caller can decide what
    // to do (e.g. surface the error to the user, retry on user
    // command). The page will sit on a chrome-error:// URL until
    // someone navigates it elsewhere.
    return {
      page,
      context,
      release: async () => {
        await release();
        throw err; // re-throw on release for caller to log
      },
    };
  }

  return { page, context, release };
}

function scheduleIdleShutdown(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    void shutdownIdle();
  }, IDLE_SHUTDOWN_MS);
}

async function shutdownIdle(): Promise<void> {
  if (pageCount > 0) return; // someone reopened — abort
  if (!browserPromise) return;
  const b = await browserPromise.catch(() => null);
  browserPromise = null;
  if (!b) return;
  try {
    await b.close();
  } catch {
    /* already gone */
  }
}

/**
 * Force-close the browser. Called from the chat server's
 * graceful-shutdown handler so a `docker stop` cleans up Chromium
 * instead of orphaning it.
 */
export async function close(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (!browserPromise) return;
  const b = await browserPromise.catch(() => null);
  browserPromise = null;
  if (!b) return;
  try {
    await b.close();
  } catch {
    /* already gone */
  }
}

/** Test-only: snapshot of internal state. */
export function _stats(): { pageCount: number; browserOpen: boolean } {
  return { pageCount, browserOpen: browserPromise !== null };
}
