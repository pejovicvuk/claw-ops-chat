#!/bin/sh
#
# Container entrypoint. Starts the pipewire stack (used by Phase 3a
# audio capture), waits for the pulseaudio shim socket to be ready,
# loads a virtual null-sink that Chromium uses as its default audio
# output, then exec's the CMD (typically `node --expose-gc server.js`).
#
# Failure modes:
#   - If pipewire / wireplumber fail to start, the chat server still
#     boots. Audio capture will fail at runtime and the H.264 path
#     will fall back to silent video. Set PREVIEW_AUDIO=disabled to
#     skip audio entirely without log noise.
#   - The `pactl load-module` and `set-default-sink` calls are best
#     effort; if pulse never came up, both fail and the server still
#     starts.
#
# Note: tini (`init: true` in docker-compose.yml) is the parent of
# this script and reaps the pipewire/wireplumber children correctly,
# so we don't need to trap signals ourselves.

set -e

# PipeWire's pulse shim creates its socket under XDG_RUNTIME_DIR.
# Match the path that Dockerfile + chromium-pool.ts both expect.
: "${XDG_RUNTIME_DIR:=/tmp/pulse-runtime}"
export XDG_RUNTIME_DIR
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

# Skip the audio stack entirely when ops disables it. Useful as a
# kill switch in production if pipewire packaging breaks on a base
# image bump.
if [ "${PREVIEW_AUDIO}" = "disabled" ]; then
  echo "[entrypoint] PREVIEW_AUDIO=disabled — skipping pipewire startup"
  exec "$@"
fi

# Background the daemons. Output goes to stderr so it lands in
# `docker logs` interleaved with node's stdout.
pipewire >&2 &
pipewire-pulse >&2 &
wireplumber >&2 &

# Wait up to ~5 s for the pulse socket to appear. If it doesn't,
# proceed anyway — the server-side audio code defends against a
# missing sink and falls back to silent video.
i=0
while [ $i -lt 50 ]; do
  if [ -S "$XDG_RUNTIME_DIR/pulse/native" ]; then
    break
  fi
  sleep 0.1
  i=$((i + 1))
done

if [ ! -S "$XDG_RUNTIME_DIR/pulse/native" ]; then
  echo "[entrypoint] pulse socket not ready after 5 s; continuing without audio" >&2
  exec "$@"
fi

# Register a virtual null-sink. Chromium's audio is routed here via
# PULSE_SINK env. parec reads PCM off `<sink>.monitor`. Both calls
# are idempotent — re-running on container restart is fine.
pactl load-module module-null-sink \
  sink_name=virtual_sink \
  sink_properties=device.description=virtual_sink \
  >/dev/null 2>&1 || true
pactl set-default-sink virtual_sink >/dev/null 2>&1 || true

exec "$@"
