# Preview streaming

Live screencast of a user's local dev server inside a canvas window.
The chat server spins up a headless Chromium tab, points it at
`http://127.0.0.1:<port>`, and pipes the rendered output to the user's
browser over a WebSocket (or, when supported, peer-to-peer via WebRTC).

This doc is the deep dive. The high-level summary lives in
[`subsystems.md`](./subsystems.md#preview-streaming-dev-server-in-canvas).

**Source:** `src/lib/preview-stream/` and `src/components/canvas/windows/preview-window.tsx`.

## Three-transport stack

| Transport     | Wire      | Latency  | Phase | Fallback trigger                                              |
| ------------- | --------- | -------- | ----- | ------------------------------------------------------------- |
| **WebRTC**    | SRTP P2P  | < 100 ms | 4     | 5 s connect timeout, peer-connection failed, capture_failed   |
| H.264 / MSE   | WebSocket | ~300 ms  | 2     | `MediaSource.isTypeSupported(avc1)` false, `appendBuffer` err |
| JPEG / canvas | WebSocket | ~500 ms  | 1     | terminal — always available                                   |

`use-preview-stream.ts` tries WebRTC first; on any failure it flips a
sticky failure flag and falls through to H.264/MSE, then JPEG/canvas.
Sticky flags survive reconnects so flaky links don't keep retrying the
higher-level transport.

## Connect sequence

```
Client (use-preview-stream.ts)
   │ new WebSocket(/ws/preview-stream/<slug>/<item>/<port>?codec=...)
   │ Cookie: claw-session=<hmac>
   ▼
server.ts WS upgrade handler (~line 2700)
   │ extractSessionFromCookieHeader(req.headers.cookie) → actorEmail
   │ │  null  → 401
   │ ▼
   │ tryRegisterPreview({slug,item,port,actorEmail,codec})
   │ │  null (cap reached) → ws.close(1008, "too_many_active")
   │ ▼
handler.ts handlePreviewStream
   │ acquirePage(port) — chromium-pool (lazy launch, idle-shutdown 5 m)
   │ │  hook: clipboard bridge + file-drop bridge installed
   │ ▼
   │ startHealthMonitor(registration, page, onStuck)
   │ │  pings page.evaluate(() => 1) every 5 s
   │ ▼
   │ codec === "h264" ? bringUpH264 : startScreencast(jpeg)
   │ │  H.264: spawns ffmpeg via `h264-encoder.ts` + audio via `audio-capture.ts`
   │ │  JPEG : CDP Page.startScreencast {format:jpeg,quality:Q,everyNthFrame:N}
   ▼
ws.send({type:"ready", deviceWidth, deviceHeight, codec, audio})
```

## Frame flow

### JPEG path

CDP screencast emits PNG-encoded bitmaps (we ask for `format: "jpeg"`
which yields JPEG payloads); each one is forwarded as a single binary
WebSocket frame (no envelope tag — the client decodes and paints to
`<canvas>`).

### H.264 path

ffmpeg spawned per stream with stdin = PNG-decoded RGB24 frames at
`H264_FPS = 30`. Output is fragmented MP4: an `init` segment (ftyp +
moov), then a stream of `media` segments (moof + mdat) every keyframe
interval. Each segment is sent as a binary WebSocket frame with a
**1-byte tag prefix**:

| Tag    | Meaning            | Payload                                    |
| ------ | ------------------ | ------------------------------------------ |
| `0x00` | fMP4 init segment  | ftyp + moov for `MediaSource.appendBuffer` |
| `0x01` | fMP4 media segment | moof + mdat                                |
| `0x02` | reset marker       | empty — client tears down + rebuilds MSE   |

### Backpressure

Both codecs check `ws.bufferedAmount` before consuming each CDP frame:

| Watermark | Threshold | Action                                                   |
| --------- | --------- | -------------------------------------------------------- |
| Soft      | 4 MB      | Skip CDP frame ack → CDP pauses; drop the frame for JPEG |
| Hard      | 16 MB     | (H.264 only) restart encoder + emit `0x02` reset marker  |

The hard-ceiling restart fires `audit.preview({type:"reconnect", reason:"hard_ceiling"})`.

## Input flow

Client → server text JSON; the dispatcher in
`handler.ts dispatchClientFrame` routes each `type`:

| `type`                 | Handler                                     | Notes                                   |
| ---------------------- | ------------------------------------------- | --------------------------------------- |
| `mouse`                | `forwardMouse(session, evt)`                | CDP `Input.dispatchMouseEvent`          |
| `wheel`                | `forwardWheel(session, evt)`                | CDP `Input.dispatchMouseEvent` (deltaY) |
| `key`                  | `forwardKey(session, evt)`                  | CDP `Input.dispatchKeyEvent`            |
| `touch`                | `forwardTouch(session, evt)`                | CDP `Input.dispatchTouchEvent` (mobile) |
| `resize`               | `forwardResize(page, evt)` debounced 150 ms | H.264 path triggers pipeline restart    |
| `reload`               | `page.goto(http://127.0.0.1:<port>/)`       | Sends `status: navigating` then `ready` |
| `navigate`             | `page.goto(...)` with same-port guard       | Reject external URLs (SSRF defense)     |
| `clipboard_paste`      | `page.keyboard.insertText(text)`            | Phase 3b                                |
| `file_drop_*`          | open / chunk / end / dispatch via binding   | Phase 3c (#128)                         |
| `go_back`/`go_forward` | `page.goBack/page.goForward()`              | Phase 5a (#131); emits `history_state`  |
| `set_zoom`             | CDP `Emulation.setPageScaleFactor`          | Phase 5b (#132); clamped 0.25–5×        |
| `find_*`               | injects `__clawFind` controller             | Phase 5c (#133); emits `find_state`     |

Server → client emits `clipboard_copy`, `download_ready`,
`download_rejected`, `download_failed`, `file_drop_ack`,
`file_drop_done`, `file_drop_error`, `url_changed`, `history_state`,
`find_state`, plus the lifecycle `status` and `error` frames documented
below.

## Heartbeat & auto-restart (Phase 6a — #134)

`startHealthMonitor` ticks every 5 s, calling `page.evaluate(() => 1)`
with a 3 s race timeout. On three consecutive failures (~15 s) the
monitor calls `onStuck("heartbeat_timeout")`, which:

1. Audits `resource_kill` with `severity: "warn"`.
2. Sends `{type:"error", code:"preview_stuck", message:"…"}`.
3. Closes the WS with code `1011`.

The client's existing reconnect machinery in `use-preview-stream.ts`
opens a fresh page through a new WS upgrade. A `pendingReconnectAfterKillRef`
flag set on the `preview_stuck` error fires a `"Reconnected"` toast on
the next successful `ready` frame. No server-side page replacement is
needed — close-and-reconnect keeps the recovery path symmetric with
ordinary disconnects.

## Resource quotas

| Knob                            | Default | Range                                          | Effect                                  |
| ------------------------------- | ------- | ---------------------------------------------- | --------------------------------------- |
| `PREVIEW_MAX_ACTIVE`            | 4       | 1–256                                          | Concurrent preview-stream WS cap        |
| WebRTC concurrent rooms / actor | 8       | 1–256 via `MAX_CONCURRENT_RTC_ROOMS_PER_ACTOR` | WebRTC pairing cap                      |
| Per-WS download cap             | 5       | const                                          | Concurrent downloads per WS             |
| Per-file download cap           | 500 MB  | const                                          | Single download size                    |
| Total downloads dir cap         | 2 GB    | const                                          | `/root/.cache/preview-downloads/` total |
| File-drop per-file cap          | 50 MB   | const                                          | Single upload size                      |

Past `PREVIEW_MAX_ACTIVE`, the server emits
`{type:"error", code:"too_many_active", status:429}` and closes with
`1008` _before_ `acquirePage` is called — so a flood doesn't leak
Chromium contexts.

## Wire protocol — error codes

| `code`                   | When                              | Recovery                                     |
| ------------------------ | --------------------------------- | -------------------------------------------- |
| `chromium_launch_failed` | `acquirePage` threw               | None — server-side, retry after a delay      |
| `upstream_unreachable`   | Page landed on `chrome-error://`  | User starts dev server, then reload          |
| `too_many_active`        | Hit `PREVIEW_MAX_ACTIVE`          | Close another preview window                 |
| `preview_stuck`          | 3 consecutive heartbeat misses    | Auto-reconnects; client toasts `Reconnected` |
| `encoder_failed`         | ffmpeg child died                 | Client falls back to JPEG on next reconnect  |
| `navigate_rejected`      | External URL passed to `navigate` | None — guard, not an error                   |
| `page_crashed`           | `startScreencast` threw           | User refresh                                 |

## Observability

- **Audit log:** `/root/.audit/preview/YYYY-MM-DD.jsonl` — categories
  `open`, `close`, `reconnect`, `codec_fallback`, `resource_kill`. See
  `src/lib/audit/types.ts` for the full event shape.
- **Monitoring snapshot:** `GET /api/monitoring/previews` (auth-gated).
  Returns `{active, maxActive, totalFramesSent, totalBytesSent,
totalRestartCount, chromium:{pid,cpuPct,memBytes}, series:{active},
items[]}`. The `chromium` block aggregates the browser parent and
  every renderer / GPU / utility subprocess via `/proc` walk →
  `pidusage` (Linux). Single-pid fallback on non-Linux.
- **Settings → Monitoring → Previews** UI section — live count,
  Chromium CPU/RAM, per-stream rows with heartbeat health badge,
  frames, bytes, restart count, last-heartbeat ago.
- **Per-stream WebRTC counters:** `GET /api/preview/metrics` —
  `paired`, `pair_timeout`, `capture_failed`,
  `controller_spawn_failed`, `rate_limited`, `slot_taken`,
  `fallback_to_mse`, `ice_restart`.

## Files

```
src/lib/preview-stream/
├── handler.ts              ← WS handler at /ws/preview-stream/<slug>/<item>/<port>
├── chromium-pool.ts        ← singleton headless Chromium with idle shutdown
├── cdp-screencast.ts       ← CDP Page.startScreencast wrapper
├── h264-encoder.ts         ← ffmpeg → fMP4 init/media segments
├── audio-capture.ts        ← Phase 3a: parec → Opus mux
├── png-decoder.ts          ← inline PNG → RGB24 for ffmpeg stdin
├── input-forward.ts        ← mouse / wheel / key / touch / resize → CDP
├── clipboard-bridge.ts     ← Phase 3b: two-way clipboard
├── file-drop.ts            ← Phase 3c: chunked uploads into the page
├── download-relay.ts       ← Phase 3d: <a download> → /api/preview-download/<id>
├── history-state.ts        ← Phase 5a: emits history_state on framenavigated
├── find-in-page.ts         ← Phase 5c: __clawFind controller injection
├── zoom-steps.ts           ← Phase 5b: client-side zoom clamp
├── webrtc-handler.ts       ← Phase 4 (#130): /ws/preview-rtc handler
├── webrtc-signaling.ts     ← pure pairing logic + slot-collision rules
├── webrtc-config.ts        ← STUN/TURN config, env-driven
├── webrtc-metrics.ts       ← in-memory counters for /api/preview/metrics
├── health.ts               ← Phase 6a (#134): registry + heartbeat + audit
├── health.test.ts          ← unit tests for the registry / cap / events
├── use-preview-stream.ts   ← client React hook: WS open, MSE buffer, fallback
└── __tests__/              ← additional integration tests
```

## Related docs

- [`docs/operations/preview-tuning.md`](../operations/preview-tuning.md) — env vars, log locations, common failures, recovery steps.
- [`docs/architecture/api-routes.md`](./api-routes.md#preview) — full HTTP route inventory.
- [`docs/architecture/runtime.md`](./runtime.md) — server.ts boot order, where preview-stream cron jobs (download / upload sweepers) are registered.
