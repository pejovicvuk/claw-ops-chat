import { describe, expect, it } from "vitest";
import { actionColorClass } from "./action-color";

describe("actionColorClass", () => {
  it("colors failures red", () => {
    expect(actionColorClass("USER_LOGIN_FAILED")).toContain("critical");
    expect(actionColorClass("permission denied")).toContain("critical");
    expect(actionColorClass("403 Unauthorized")).toContain("critical");
  });

  it("colors destructive actions amber", () => {
    expect(actionColorClass("DELETE /api/sessions")).toContain("warning");
    expect(actionColorClass("monitoring.kill_process")).toContain("warning");
    expect(actionColorClass("disable rule")).toContain("warning");
  });

  it("colors creations / completions green", () => {
    expect(actionColorClass("USER_LOGIN")).toContain("healthy");
    expect(actionColorClass("CREATE rule")).toContain("healthy");
    expect(actionColorClass("turn_complete")).toContain("healthy");
  });

  it("falls back to canvas-fg", () => {
    expect(actionColorClass("UPDATE rule")).toBe("text-canvas-fg");
    expect(actionColorClass("")).toBe("text-canvas-fg");
  });
});
