import type { CDPSession, Page } from "playwright-core";

/**
 * Wraps a Playwright `Page` with Chrome DevTools Protocol's
 * `Page.startScreencast` lifecycle. Each frame arrives as base64
 * JPEG; we decode to a Buffer and hand it to the caller.
 *
 * CDP requires `Page.screencastFrameAck` after every received frame
 * — without it Chromium pauses the stream after the first frame.
 * The handler decides whether to ack (used for backpressure: drop a
 * frame if the WS buffer is too full).
 */

export interface ScreencastFrame {
  data: Buffer;
  metadata: {
    deviceWidth: number;
    deviceHeight: number;
    timestamp: number;
  };
  /** Ack this frame so CDP keeps streaming. Skip the ack to drop the frame and let upstream pause briefly. */
  ack: () => Promise<void>;
}

export interface ScreencastOpts {
  format?: "jpeg" | "png";
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
  /** Send every Nth frame (1 = no skipping). 6 ≈ 10fps from a 60fps DOM. */
  everyNthFrame?: number;
}

export interface Screencast {
  session: CDPSession;
  stop(): Promise<void>;
  onFrame(handler: (frame: ScreencastFrame) => void): void;
}

interface ScreencastFramePayload {
  data: string;
  sessionId: number;
  metadata: {
    deviceWidth: number;
    deviceHeight: number;
    timestamp?: number;
  };
}

export async function startScreencast(page: Page, opts: ScreencastOpts = {}): Promise<Screencast> {
  const session = await page.context().newCDPSession(page);
  const handlers = new Set<(frame: ScreencastFrame) => void>();

  session.on("Page.screencastFrame", (payload: unknown) => {
    const p = payload as ScreencastFramePayload;
    const data = Buffer.from(p.data, "base64");
    const sessionId = p.sessionId;
    const ack = async () => {
      try {
        await session.send("Page.screencastFrameAck", { sessionId });
      } catch {
        /* session already gone */
      }
    };
    const frame: ScreencastFrame = {
      data,
      metadata: {
        deviceWidth: p.metadata.deviceWidth,
        deviceHeight: p.metadata.deviceHeight,
        timestamp: p.metadata.timestamp ?? Date.now() / 1000,
      },
      ack,
    };
    for (const h of handlers) {
      try {
        h(frame);
      } catch {
        /* swallow handler errors so they don't break sibling subscribers */
      }
    }
  });

  await session.send("Page.startScreencast", {
    format: opts.format ?? "jpeg",
    quality: opts.quality ?? 80,
    maxWidth: opts.maxWidth ?? 1280,
    maxHeight: opts.maxHeight ?? 800,
    everyNthFrame: opts.everyNthFrame ?? 6,
  });

  return {
    session,
    onFrame(h) {
      handlers.add(h);
    },
    async stop() {
      handlers.clear();
      try {
        await session.send("Page.stopScreencast");
      } catch {
        /* session might be detached */
      }
      try {
        await session.detach();
      } catch {
        /* same */
      }
    },
  };
}
