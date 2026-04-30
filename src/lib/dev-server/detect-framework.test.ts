import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { detectFramework } from "./detect-framework";
import { frameworkLabel } from "./framework-label";

interface PackageJsonShape {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "claw-detect-"));
});
afterEach(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function writePkg(contents: PackageJsonShape) {
  writeFileSync(join(tmp, "package.json"), JSON.stringify(contents));
}

describe("detectFramework", () => {
  it("returns unknown when there is no package.json", async () => {
    const r = await detectFramework(tmp);
    expect(r.framework).toBe("unknown");
    expect(r.defaultPort).toBe(3000);
    expect(r.runSpec.command).toBe("npm");
  });

  it("detects Next.js", async () => {
    writePkg({ dependencies: { next: "^16.0.0", react: "^18" } });
    const r = await detectFramework(tmp);
    expect(r.framework).toBe("next");
    expect(r.defaultPort).toBe(3000);
    expect(r.runSpec.env.PORT).toBe("3000");
    expect(r.runSpec.args).toEqual(["run", "dev"]);
  });

  it("detects Vite (over generic React)", async () => {
    writePkg({
      dependencies: { react: "^18" },
      devDependencies: { vite: "^5.0.0", "@vitejs/plugin-react": "^4" },
    });
    const r = await detectFramework(tmp);
    expect(r.framework).toBe("vite");
    expect(r.defaultPort).toBe(5173);
    expect(r.runSpec.args).toContain("--port");
    expect(r.runSpec.args).toContain("5173");
  });

  it("detects Create React App", async () => {
    writePkg({ dependencies: { "react-scripts": "5.0.1" } });
    const r = await detectFramework(tmp);
    expect(r.framework).toBe("cra");
    expect(r.runSpec.env.PORT).toBe("3000");
  });

  it("detects NestJS", async () => {
    writePkg({ dependencies: { "@nestjs/core": "^10" } });
    const r = await detectFramework(tmp);
    expect(r.framework).toBe("nestjs");
    expect(r.runSpec.env.PORT).toBe("3000");
  });

  it("detects Astro", async () => {
    writePkg({ dependencies: { astro: "^4" } });
    const r = await detectFramework(tmp);
    expect(r.framework).toBe("astro");
    expect(r.defaultPort).toBe(4321);
    expect(r.runSpec.args).toContain("--port");
  });

  it("detects Nuxt (3.x)", async () => {
    writePkg({ dependencies: { nuxt: "^3" } });
    const r = await detectFramework(tmp);
    expect(r.framework).toBe("nuxt");
  });

  it("falls back to node-script when nothing is recognised but a dev script exists", async () => {
    writePkg({ scripts: { dev: "node ./serve.js" } });
    const r = await detectFramework(tmp);
    expect(r.framework).toBe("node-script");
  });

  it("returns unknown when package.json is malformed", async () => {
    writeFileSync(join(tmp, "package.json"), "{not json");
    const r = await detectFramework(tmp);
    expect(r.framework).toBe("unknown");
  });

  it("Next wins over Vite when both are listed", async () => {
    writePkg({ dependencies: { next: "16", vite: "5" } });
    const r = await detectFramework(tmp);
    expect(r.framework).toBe("next");
  });
});

describe("frameworkLabel", () => {
  it("renders friendly labels", () => {
    expect(frameworkLabel("next")).toBe("Next");
    expect(frameworkLabel("vite")).toBe("Vite");
    expect(frameworkLabel("cra")).toBe("CRA");
    expect(frameworkLabel("nestjs")).toBe("NestJS");
    expect(frameworkLabel("astro")).toBe("Astro");
    expect(frameworkLabel("nuxt")).toBe("Nuxt");
    expect(frameworkLabel("node-script")).toBe("Dev script");
    expect(frameworkLabel("unknown")).toBe("Unknown");
  });
});
