"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";

/**
 * Phase 4 (#130): controller page that runs INSIDE the headless
 * Chromium tab spun up by `acquirePage(port, { targetUrl: ... })`.
 *
 *   ┌───────────────────────────────────────────────────────────┐
 *   │ Headless Chromium tab @ /chat/preview-controller?port=<n> │
 *   │                                                           │
 *   │  ┌────────────────────────────────────────────────────┐   │
 *   │  │ <iframe src="/chat/preview/<n>/" />                │   │
 *   │  │   (same-origin reverse proxy to localhost:<n>)     │   │
 *   │  └────────────────────────────────────────────────────┘   │
 *   │                                                           │
 *   │  • getDisplayMedia({preferCurrentTab: true}) → tracks     │
 *   │  • RTCPeerConnection (STUN-only, no TURN)                 │
 *   │  • DataChannel "ctrl" — input + control from viewer       │
 *   │  • DataChannel "file" — file-drop bytes from viewer       │
 *   │  • WebSocket /chat/ws/preview-rtc/.../?role=controller —  │
 *   │    SDP/ICE relay to the user's browser via the chat       │
 *   │    server (signaling-only, never carries media)           │
 *   └───────────────────────────────────────────────────────────┘
 *
 * Cross-origin iframes block synthetic event dispatch — that's why
 * the iframe loads via `/chat/preview/<port>/*` (the existing same-
 * origin reverse proxy) rather than `http://localhost:<port>` direct.
 *
 * On any fatal step (getDisplayMedia denied, peer connection fails)
 * the controller emits `{type: "capture_failed", reason}` over the
 * signaling WS so the viewer falls back to the MSE pipeline within
 * the 5 s sticky-RTC-failure window.
 */

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/chat";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

interface InputFrame {
  type:
    | "mouse"
    | "wheel"
    | "key"
    | "touch"
    | "navigate"
    | "reload"
    | "resize"
    | "clipboard_paste";
  [key: string]: unknown;
}

// `getDisplayMedia` chrome-only options aren't in lib.dom.d.ts.
interface ChromeDisplayMediaConstraints extends DisplayMediaStreamOptions {
  preferCurrentTab?: boolean;
  selfBrowserSurface?: "include" | "exclude";
  systemAudio?: "include" | "exclude";
}

export default function PreviewControllerPage(): ReactElement {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [status, setStatus] = useState<
    "booting" | "capturing" | "signaling" | "connected" | "failed"
  >("booting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const port = params.get("port");
    const room = params.get("room");
    const project = params.get("project") ?? "";
    const item = params.get("item") ?? "";
    if (!port || !room) {
      setError("missing port/room");
      setStatus("failed");
      return;
    }

    let pc: RTCPeerConnection | null = null;
    let ws: WebSocket | null = null;
    let mediaStream: MediaStream | null = null;
    let cancelled = false;

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl =
      `${proto}//${window.location.host}${BASE_PATH}/ws/preview-rtc/` +
      `${encodeURIComponent(project)}/${encodeURIComponent(item)}/${port}` +
      `?role=controller&room=${encodeURIComponent(room)}`;

    const sendSignal = (frame: Record<string, unknown>) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(JSON.stringify(frame));
      } catch {
        /* socket closing */
      }
    };

    const fail = (reason: string) => {
      if (cancelled) return;
      setError(reason);
      setStatus("failed");
      sendSignal({ type: "capture_failed", reason });
      try {
        pc?.close();
      } catch {
        /* ignore */
      }
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      mediaStream?.getTracks().forEach((t) => t.stop());
    };

    void (async () => {
      // Step 1: capture this tab via getDisplayMedia.
      setStatus("capturing");
      try {
        const constraints: ChromeDisplayMediaConstraints = {
          video: { frameRate: 60 },
          audio: true,
          preferCurrentTab: true,
          selfBrowserSurface: "include",
          systemAudio: "include",
        };
        mediaStream = await navigator.mediaDevices.getDisplayMedia(
          constraints as DisplayMediaStreamOptions,
        );
      } catch (err) {
        fail(`getDisplayMedia: ${err instanceof Error ? err.message : "denied"}`);
        return;
      }
      if (cancelled) {
        mediaStream.getTracks().forEach((t) => t.stop());
        return;
      }
      if (mediaStream.getVideoTracks().length === 0) {
        fail("getDisplayMedia: no video tracks");
        return;
      }

      // Step 2: RTCPeerConnection + tracks + data channels.
      pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      for (const track of mediaStream.getTracks()) {
        pc.addTrack(track, mediaStream);
      }
      const ctrl = pc.createDataChannel("ctrl", { ordered: true });
      const file = pc.createDataChannel("file", { ordered: true });
      ctrl.onmessage = (evt) => {
        try {
          const frame = JSON.parse(evt.data as string) as InputFrame;
          dispatchInputToIframe(iframeRef.current, frame);
        } catch {
          /* drop malformed frames */
        }
      };
      // File chunks arrive as binary frames. The viewer's chunk envelope
      // is `[tag(1)][dropIdLen(1)][dropId(N)][bytes]`. The controller
      // reassembles them and dispatches a synthetic DragEvent into the
      // iframed page.
      file.binaryType = "arraybuffer";
      file.onmessage = (evt) => {
        if (typeof evt.data === "string") {
          try {
            const frame = JSON.parse(evt.data) as Record<string, unknown>;
            handleFileMetaFromViewer(iframeRef.current, frame);
          } catch {
            /* ignore */
          }
        } else if (evt.data instanceof ArrayBuffer) {
          handleFileBinaryFromViewer(evt.data);
        }
      };

      pc.onicecandidate = (evt) => {
        if (evt.candidate) {
          sendSignal({ type: "ice", candidate: evt.candidate.toJSON() });
        }
      };
      pc.onconnectionstatechange = () => {
        if (!pc) return;
        if (pc.connectionState === "connected") setStatus("connected");
        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "disconnected" ||
          pc.connectionState === "closed"
        ) {
          fail(`peer connection ${pc.connectionState}`);
        }
      };

      // Step 3: open signaling WS.
      setStatus("signaling");
      try {
        ws = new WebSocket(wsUrl);
      } catch (err) {
        fail(`signaling ws open: ${err instanceof Error ? err.message : "failed"}`);
        return;
      }
      ws.onopen = async () => {
        sendSignal({ type: "role", role: "controller" });
        if (!pc) return;
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sendSignal({ type: "sdp", sdp: pc.localDescription });
        } catch (err) {
          fail(`createOffer: ${err instanceof Error ? err.message : "failed"}`);
        }
      };
      ws.onmessage = async (evt) => {
        if (typeof evt.data !== "string") return;
        let frame: { type: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
        try {
          frame = JSON.parse(evt.data);
        } catch {
          return;
        }
        if (!pc) return;
        if (frame.type === "sdp" && frame.sdp) {
          try {
            await pc.setRemoteDescription(frame.sdp);
          } catch (err) {
            fail(`setRemoteDescription: ${err instanceof Error ? err.message : "failed"}`);
          }
        } else if (frame.type === "ice" && frame.candidate) {
          try {
            await pc.addIceCandidate(frame.candidate);
          } catch {
            /* late candidates may fail benignly */
          }
        } else if (frame.type === "bye") {
          fail("viewer disconnected");
        }
      };
      ws.onclose = () => {
        if (status !== "connected") fail("signaling ws closed before pairing");
      };
      ws.onerror = () => {
        fail("signaling ws error");
      };
    })();

    return () => {
      cancelled = true;
      try {
        pc?.close();
      } catch {
        /* ignore */
      }
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      mediaStream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot bootstrap on mount
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        margin: 0,
        padding: 0,
        background: "#000",
      }}
    >
      <iframe
        ref={iframeRef}
        title="preview-target"
        src={`${BASE_PATH}/preview/${new URLSearchParams(
          typeof window === "undefined" ? "" : window.location.search,
        ).get("port") ?? ""}/`}
        allow="clipboard-read; clipboard-write; autoplay; display-capture"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          border: "0",
        }}
      />
      {status === "failed" && (
        <div
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            padding: "6px 10px",
            background: "rgba(220,38,38,0.9)",
            color: "#fff",
            fontFamily: "monospace",
            fontSize: 12,
            borderRadius: 4,
            pointerEvents: "none",
          }}
        >
          rtc: {error}
        </div>
      )}
    </div>
  );
}

/**
 * Synthesize a DOM event on the iframed page from a viewer-side
 * `InputFrame`. Only same-origin iframes accept synthetic dispatch;
 * the controller relies on the chat server's `/chat/preview/<port>/*`
 * reverse proxy to make `localhost:<port>` reachable from the same
 * origin as the controller page.
 */
function dispatchInputToIframe(
  iframe: HTMLIFrameElement | null,
  frame: InputFrame,
): void {
  if (!iframe) return;
  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;
  if (!win || !doc) return;
  switch (frame.type) {
    case "mouse":
      dispatchMouse(doc, win, frame);
      break;
    case "wheel":
      dispatchWheel(doc, win, frame);
      break;
    case "key":
      dispatchKey(doc, win, frame);
      break;
    case "touch":
      dispatchTouch(doc, win, frame);
      break;
    case "navigate": {
      const url = String(frame.url ?? "");
      if (url.startsWith(`http://127.0.0.1:`)) {
        // Translate the legacy localhost URL to the same-origin proxy
        // path so the iframe reload stays inside the controller origin.
        const m = url.match(/^http:\/\/127\.0\.0\.1:(\d+)(\/.*)?$/);
        if (m) {
          iframe.src = `${BASE_PATH}/preview/${m[1]}${m[2] ?? "/"}`;
          return;
        }
      }
      iframe.src = url;
      break;
    }
    case "reload":
      try {
        win.location.reload();
      } catch {
        iframe.src = iframe.src;
      }
      break;
    case "clipboard_paste":
      // Paste synthesizes a clipboardData InputEvent; we just blur+focus
      // and synthesize a 'paste' event with the text in clipboardData.
      void dispatchPaste(doc, win, String(frame.text ?? ""));
      break;
    case "resize":
      // Resize is only meaningful for the headless tab itself, not the
      // iframe. CDP-side resize still happens server-side via the
      // existing handler — we just ignore it on this path.
      break;
  }
}

function buildModifiers(frame: InputFrame): {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
} {
  const m = Number(frame.modifiers ?? 0);
  return {
    altKey: (m & 1) !== 0,
    ctrlKey: (m & 2) !== 0,
    metaKey: (m & 4) !== 0,
    shiftKey: (m & 8) !== 0,
  };
}

function dispatchMouse(doc: Document, win: Window, frame: InputFrame): void {
  const action = String(frame.action ?? "move");
  const x = Number(frame.x ?? 0);
  const y = Number(frame.y ?? 0);
  const buttonName = String(frame.button ?? "left");
  const button = buttonName === "right" ? 2 : buttonName === "middle" ? 1 : 0;
  const buttons = Number(frame.buttons ?? 0);
  const detail = Number(frame.clickCount ?? 1);
  const target = doc.elementFromPoint(x, y) ?? doc.body;
  const type =
    action === "down" ? "mousedown" : action === "up" ? "mouseup" : "mousemove";
  const evt = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    view: win,
    detail,
    clientX: x,
    clientY: y,
    button,
    buttons,
    ...buildModifiers(frame),
  });
  target.dispatchEvent(evt);
  // Mouse-up at the same coordinates should also synthesize a `click`
  // event for normal page semantics (button targets, label-for, etc.).
  if (action === "up" && button === 0) {
    const click = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: win,
      detail,
      clientX: x,
      clientY: y,
      button: 0,
      buttons,
      ...buildModifiers(frame),
    });
    target.dispatchEvent(click);
  }
}

function dispatchWheel(doc: Document, win: Window, frame: InputFrame): void {
  const x = Number(frame.x ?? 0);
  const y = Number(frame.y ?? 0);
  const target = doc.elementFromPoint(x, y) ?? doc.body;
  const evt = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    view: win,
    clientX: x,
    clientY: y,
    deltaX: Number(frame.deltaX ?? 0),
    deltaY: Number(frame.deltaY ?? 0),
  });
  target.dispatchEvent(evt);
}

function dispatchKey(doc: Document, _win: Window, frame: InputFrame): void {
  const action = String(frame.action ?? "down");
  const key = String(frame.key ?? "");
  const code = String(frame.code ?? "");
  const text = frame.text == null ? undefined : String(frame.text);
  const type = action === "up" ? "keyup" : "keydown";
  const target = doc.activeElement ?? doc.body;
  const evt = new KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    view: _win,
    key,
    code,
    ...buildModifiers(frame),
  });
  target.dispatchEvent(evt);
  // For printable single-char keydowns, also synthesize an `input`
  // event on the active element so contenteditable / inputs see the
  // typed character. This is a best-effort shim — CDP handles this
  // automatically server-side via Phase 1's input-forward path; we
  // only do it client-side when the controller is in WebRTC mode.
  if (
    action === "down" &&
    text &&
    text.length === 1 &&
    target instanceof HTMLElement &&
    (target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target.isContentEditable)
  ) {
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    ) {
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? start;
      target.value = target.value.slice(0, start) + text + target.value.slice(end);
      target.selectionStart = target.selectionEnd = start + text.length;
    }
    target.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
  }
}

function dispatchTouch(doc: Document, win: Window, frame: InputFrame): void {
  // Touch dispatch via synthetic Touch + TouchEvent constructors only
  // works on Chromium and is finicky to map from CDP-shape input. The
  // safe path on this transport is to translate touch into mouse for
  // single-finger gestures on the iframe; multi-touch falls through to
  // the existing CDP handler when the user reconnects via MSE.
  const points = Array.isArray(frame.touchPoints)
    ? (frame.touchPoints as Array<{ x: number; y: number }>)
    : [];
  if (points.length === 0) return;
  const action = String(frame.action ?? "start");
  const type =
    action === "start" ? "mousedown" : action === "end" ? "mouseup" : "mousemove";
  const p = points[0];
  const target = doc.elementFromPoint(p.x, p.y) ?? doc.body;
  const evt = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    view: win,
    clientX: p.x,
    clientY: p.y,
    button: 0,
    buttons: action === "end" ? 0 : 1,
  });
  target.dispatchEvent(evt);
}

async function dispatchPaste(
  doc: Document,
  _win: Window,
  text: string,
): Promise<void> {
  if (!text) return;
  const target = doc.activeElement ?? doc.body;
  // Simulate insertion. ClipboardEvent is non-trivial to construct with
  // synthetic clipboardData across browsers; a direct value mutation +
  // 'input' event covers form fields and contenteditable.
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  ) {
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? start;
    target.value = target.value.slice(0, start) + text + target.value.slice(end);
    target.selectionStart = target.selectionEnd = start + text.length;
    target.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
  } else if (target instanceof HTMLElement && target.isContentEditable) {
    target.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        data: text,
        inputType: "insertFromPaste",
      }),
    );
    doc.execCommand("insertText", false, text);
  }
}

// File-drop reassembly state — keyed by the `dropId` that the viewer
// announces in its `file_drop_start` JSON message before sending chunks.
const FILE_DROP_TAG_CHUNK = 0x10;
interface DropState {
  filename: string;
  mimeType: string;
  size: number;
  x: number;
  y: number;
  chunks: Uint8Array[];
}
const drops = new Map<string, DropState>();

function handleFileMetaFromViewer(
  iframe: HTMLIFrameElement | null,
  frame: Record<string, unknown>,
): void {
  if (!iframe) return;
  const t = String(frame.type ?? "");
  const dropId = String(frame.dropId ?? "");
  if (t === "file_drop_start") {
    drops.set(dropId, {
      filename: String(frame.filename ?? "untitled"),
      mimeType: String(frame.mimeType ?? "application/octet-stream"),
      size: Number(frame.size ?? 0),
      x: Number(frame.x ?? 0),
      y: Number(frame.y ?? 0),
      chunks: [],
    });
  } else if (t === "file_drop_end") {
    const state = drops.get(dropId);
    if (!state) return;
    drops.delete(dropId);
    void dispatchFileDrop(iframe, state);
  } else if (t === "file_drop_cancel") {
    drops.delete(dropId);
  }
}

function handleFileBinaryFromViewer(buf: ArrayBuffer): void {
  if (buf.byteLength < 2) return;
  const view = new Uint8Array(buf);
  if (view[0] !== FILE_DROP_TAG_CHUNK) return;
  const idLen = view[1];
  if (buf.byteLength < 2 + idLen) return;
  const id = new TextDecoder().decode(view.subarray(2, 2 + idLen));
  const state = drops.get(id);
  if (!state) return;
  state.chunks.push(view.subarray(2 + idLen));
}

async function dispatchFileDrop(
  iframe: HTMLIFrameElement,
  state: DropState,
): Promise<void> {
  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;
  if (!win || !doc) return;
  // Reassemble bytes into a single Blob, build a File, then dispatch a
  // DragEvent with files at the recorded coordinates.
  const total = state.chunks.reduce((n, c) => n + c.length, 0);
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of state.chunks) {
    merged.set(c, off);
    off += c.length;
  }
  const file = new File([merged.slice().buffer], state.filename, {
    type: state.mimeType,
  });
  const target = doc.elementFromPoint(state.x, state.y) ?? doc.body;
  const dataTransfer = new DataTransfer();
  try {
    dataTransfer.items.add(file);
  } catch {
    /* some browsers don't expose items.add on synthetic DataTransfer */
  }
  for (const type of ["dragenter", "dragover", "drop"] as const) {
    const evt = new DragEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: state.x,
      clientY: state.y,
      view: win,
      dataTransfer,
    });
    target.dispatchEvent(evt);
  }
}
