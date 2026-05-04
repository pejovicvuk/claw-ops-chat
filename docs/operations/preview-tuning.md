# Preview-stream operations playbook

Operator-facing reference for tuning, monitoring, and recovering the
preview-stream subsystem in production. For the protocol-level / code
walkthrough see
[`docs/architecture/preview-stream.md`](../architecture/preview-stream.md).

## Tuning knobs (env vars)

All knobs live on the chat-server container. Set them in
`docker-compose.yml`'s `environment:` block (or `.env.local` in dev).
None require a code change.

| Env                                             | Default                   | Range / format                           | When to change                                                                                              |
| ----------------------------------------------- | ------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `PREVIEW_MAX_ACTIVE`                            | `4`                       | integer 1–256                            | Reference 4 vCPU / 8 GB host comfortably runs 4. Raise on bigger hosts; lower on the 1 vCPU dev tier.       |
| `PREVIEW_QUALITY`                               | `balanced`                | `performance` \| `balanced` \| `quality` | Per-tab fallback when client doesn't pass `?quality=`. `performance` cuts JPEG to q=70 / every 6th frame.   |
| `PREVIEW_AUDIO`                                 | (unset = enabled)         | `disabled` to opt out                    | Set `disabled` if `parec` / pulse isn't available in the container, or you don't want page audio captured.  |
| `WEBRTC_TURN_URL`                               | (unset)                   | `turn:host:port` / `turns:host:port`     | Required only when users behind asymmetric NAT can't pair via STUN. Falls back to MSE silently when absent. |
| `WEBRTC_TURN_USERNAME` / `WEBRTC_TURN_PASSWORD` | (unset)                   | string                                   | Pair with `WEBRTC_TURN_URL`. Static creds — rotate via env, never commit.                                   |
| `WEBRTC_CONNECT_TIMEOUT_MS`                     | `5000`                    | integer 1000–30000                       | Lower if your operators want faster MSE fallback on flaky networks.                                         |
| `MAX_CONCURRENT_RTC_ROOMS_PER_ACTOR`            | `8`                       | integer 1–256                            | Distinct from `PREVIEW_MAX_ACTIVE` — this caps WebRTC pairings per signed-in user.                          |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`           | (`apk add chromium` path) | absolute path                            | Override only when running outside the Alpine container (local dev with Homebrew Chromium, etc.).           |

## Logs + telemetry

| Where                                                        | What                                                                                                                              |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `/root/.audit/preview/YYYY-MM-DD.jsonl`                      | One line per `open` / `close` / `reconnect` / `codec_fallback` / `resource_kill`. 30-day retention via the existing audit purger. |
| Settings → **Monitoring** → **Previews**                     | Live count vs cap, Chromium CPU/RAM, per-stream heartbeat / frames / bytes / restart count.                                       |
| Settings → **Activity** → **Audit log** (`category=preview`) | Same JSONL, browsable + searchable. Useful to correlate `resource_kill` with later `open` (the auto-reconnect).                   |
| `GET /chat/api/monitoring/previews`                          | Raw JSON snapshot — what the load-test harness reads.                                                                             |
| `GET /chat/api/preview/metrics`                              | WebRTC pairing counters (`paired`, `pair_timeout`, `capture_failed`, `controller_spawn_failed`, `rate_limited`, etc.).            |
| Container stderr                                             | Chromium launch failures, ffmpeg spawn errors, audit write errors. Tail with `docker logs -f claw-chat`.                          |

## Common failures + recovery

| Symptom (client toast / error code)                      | Where to look                                                                            | Recovery                                                                                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Too many active previews** / `too_many_active`         | Settings → Monitoring → Previews shows `N/N`                                             | Close another preview, or temporarily raise `PREVIEW_MAX_ACTIVE` and restart the container.                                 |
| **Preview stuck → Reconnected** / `preview_stuck`        | `/root/.audit/preview/...jsonl` has a `resource_kill` entry                              | Auto-recovered. Repeat occurrences on the same `(slug, port)` → the previewed page has a hang loop; check the dev server.   |
| **Failed to launch Chromium** / `chromium_launch_failed` | Container stderr — `Browser closed unexpectedly` or `ENOSPC` on `/dev/shm`               | Increase docker-compose `shm_size` (default 64 MB → 1 GB), or check `apk add chromium` succeeded in the image build.        |
| **Dev server not reachable** / `upstream_unreachable`    | The previewed dev server isn't listening on the requested port                           | Start the dev server, then click the preview's reload button.                                                               |
| **Encoder failed** / `encoder_failed`                    | Container stderr — `ffmpeg` not found, or the encoder ran out of stdin                   | `apk add ffmpeg` in the image. Client auto-retries with JPEG on the next connection.                                        |
| **Rate limited (RTC)** / `rate_limited`                  | `GET /api/preview/metrics` shows `rate_limited > 0`                                      | User has too many WebRTC tabs open across devices — close some, or raise `MAX_CONCURRENT_RTC_ROOMS_PER_ACTOR`.              |
| Chromium RAM creeping up                                 | Settings → Monitoring → Previews shows steadily-growing `Chromium RSS` even after closes | Idle-shutdown is 5 min; if the value never drops, restart the container. Track via Audit `close` count vs current `active`. |

## Service level objective

Reference deploy: 4 vCPU / 8 GB host, Alpine + node:24, default
`PREVIEW_QUALITY=balanced`, `PREVIEW_MAX_ACTIVE=4`.

| Concurrency | FPS p50 (steady state) | Chromium CPU | Chromium RSS  | Restarts (10 min) |
| ----------- | ---------------------- | ------------ | ------------- | ----------------- |
| 1           | 25–30                  | 30–60 %      | 250–400 MB    | 0                 |
| 2           | 22–28                  | 60–110 %     | 450–700 MB    | 0                 |
| 4           | 15–22                  | 130–220 %    | 800 MB–1.3 GB | 0                 |
| 5+          | 429 rejected           | n/a          | n/a           | n/a               |

> Ranges from `node scripts/load-test-previews.mjs --concurrency=N
--hold=60`. Re-run after any change to `chromium-pool.ts` or codec
> defaults.

Beyond `PREVIEW_MAX_ACTIVE`, new connects get HTTP-429 / WebSocket
close 1008. Client surfaces a toast; existing previews are unaffected.

## Running the load test

The harness lives at [`scripts/load-test-previews.mjs`](../../scripts/load-test-previews.mjs).
It mints a session cookie inline using `SESSION_SECRET` (must match
the running server), spawns a tiny "busy page" upstream, and ramps
concurrency from 1 to N.

```sh
# Reference run, 60 s steady-state per concurrency level
SESSION_SECRET=... ALLOWED_EMAIL=you@example.com \
  npm run loadtest:previews -- --concurrency=4 --hold=60

# JSON output for scripted ingestion
npm run loadtest:previews -- --concurrency=4 --hold=60 --json
```

Output columns:

| Column         | Source                                              |
| -------------- | --------------------------------------------------- |
| `N`            | Concurrency level being held                        |
| `TTFF p50 ms`  | Time from WS `open` → first binary frame            |
| `FPS p50`      | Per-stream median frame rate during the hold        |
| `KB/s p50`     | Per-stream median bandwidth during the hold         |
| `Chr CPU %`    | Aggregate Chromium CPU% (browser + all renderers)   |
| `Chr RSS MB`   | Aggregate Chromium RSS (browser + all renderers)    |
| `Rstrt`        | `totalRestartCount` from `/api/monitoring/previews` |
| `Input p50 ms` | Synthetic mouse-event → next-frame round trip       |

If you see `failedOpens > 0` for a concurrency level the cap was either
already at limit (close other preview windows first) or
`SESSION_SECRET` doesn't match the running server's value.

## When in doubt

1. Open Settings → Monitoring → Previews — does the dashboard match
   what you see client-side?
2. Tail the audit category: `tail -f /root/.audit/preview/$(date -u +%F).jsonl`.
3. Read the architecture doc: [`docs/architecture/preview-stream.md`](../architecture/preview-stream.md).
4. Check the server-side stderr for ffmpeg / Chromium errors:
   `docker logs --tail=200 claw-chat`.
