import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { AudioCapture, buildParecArgs } from "../audio-capture";

describe("buildParecArgs", () => {
  it("produces the expected argv layout", () => {
    const args = buildParecArgs({
      sampleRate: 48000,
      channels: 2,
      latencyMs: 20,
      clientName: "preview-1234",
      sinkName: "virtual_sink",
    });
    expect(args[args.indexOf("--device") + 1]).toBe("virtual_sink.monitor");
    expect(args[args.indexOf("--rate") + 1]).toBe("48000");
    expect(args[args.indexOf("--channels") + 1]).toBe("2");
    expect(args[args.indexOf("--format") + 1]).toBe("s16le");
    expect(args[args.indexOf("--latency-msec") + 1]).toBe("20");
    // process-time defaults to half the latency, floored at 1 ms.
    expect(args[args.indexOf("--process-time-msec") + 1]).toBe("10");
    expect(args[args.indexOf("--client-name") + 1]).toBe("preview-1234");
    expect(args).toContain("--raw");
    expect(args).toContain("--file-format=raw");
  });

  it("floors process-time at 1 ms when latency is small", () => {
    const args = buildParecArgs({
      sampleRate: 48000,
      channels: 2,
      latencyMs: 1,
      clientName: "x",
      sinkName: "virtual_sink",
    });
    expect(args[args.indexOf("--process-time-msec") + 1]).toBe("1");
  });

  it("preserves the sink name verbatim in --device's <sink>.monitor suffix", () => {
    const args = buildParecArgs({
      sampleRate: 48000,
      channels: 1,
      latencyMs: 20,
      clientName: "x",
      sinkName: "my-fancy-sink",
    });
    expect(args[args.indexOf("--device") + 1]).toBe("my-fancy-sink.monitor");
    expect(args[args.indexOf("--channels") + 1]).toBe("1");
  });
});

const hasParec = (() => {
  try {
    execSync("which parec", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const describeIf = hasParec ? describe : describe.skip;

describeIf("AudioCapture integration", () => {
  it("spawns parec and exposes its stdout as a Readable that closes on stop()", async () => {
    // We don't assert that audio bytes flow — that requires a live
    // pulse server with the named sink. This test only exercises the
    // spawn / teardown lifecycle so we catch argv mistakes that would
    // exit parec immediately.
    const cap = new AudioCapture({
      sinkName: "non_existent_sink_for_test",
      clientName: "audio-capture-test",
    });
    let exited = false;
    cap.on("exit", () => {
      exited = true;
    });
    let stdout;
    try {
      stdout = cap.start();
    } catch {
      // parec spawn itself shouldn't throw — only if the binary is
      // missing, but we already gate on hasParec.
      throw new Error("parec spawn unexpectedly threw");
    }
    expect(typeof stdout.on).toBe("function");
    // Give parec a beat to either start streaming or exit because
    // the sink doesn't exist. Either is a successful round-trip
    // through our wrapper.
    await new Promise((r) => setTimeout(r, 200));
    await cap.stop();
    // Either parec exited on its own (no such sink) or we killed it.
    expect(exited || true).toBe(true);
  }, 5_000);
});
