import { describe, expect, it } from "vitest";
import { classifySendStatus } from "./send";

describe("classifySendStatus", () => {
  it("treats 2xx as sent without dropping", () => {
    expect(classifySendStatus(200)).toMatchObject({ outcome: "sent", drop: false });
    expect(classifySendStatus(201)).toMatchObject({ outcome: "sent", drop: false });
    expect(classifySendStatus(204)).toMatchObject({ outcome: "sent", drop: false });
  });

  it("classifies 404 and 410 as dropped (dead subscription)", () => {
    const four04 = classifySendStatus(404);
    expect(four04.outcome).toBe("dropped");
    expect(four04.drop).toBe(true);
    expect(four04.detail).toMatch(/dead subscription/);
    const four10 = classifySendStatus(410);
    expect(four10.outcome).toBe("dropped");
    expect(four10.drop).toBe(true);
    expect(four10.detail).toMatch(/dead subscription/);
  });

  it("classifies 401 and 403 as dropped (credential mismatch)", () => {
    // The whole point of the VAPID-persistence fix: when the server's
    // private key no longer matches the public key the browser handed
    // to the push service, the upstream returns 401/403. We treat that
    // as a dead subscription so the user re-enables and re-binds.
    const four01 = classifySendStatus(401);
    expect(four01.outcome).toBe("dropped");
    expect(four01.drop).toBe(true);
    expect(four01.detail).toMatch(/credential mismatch/);
    const four03 = classifySendStatus(403);
    expect(four03.outcome).toBe("dropped");
    expect(four03.drop).toBe(true);
    expect(four03.detail).toMatch(/credential mismatch/);
  });

  it("treats unknown 4xx/5xx as error without dropping", () => {
    const five00 = classifySendStatus(500);
    expect(five00.outcome).toBe("error");
    expect(five00.drop).toBe(false);
    expect(five00.detail).toMatch(/HTTP 500/);
    const four29 = classifySendStatus(429);
    expect(four29.outcome).toBe("error");
    expect(four29.drop).toBe(false);
  });

  it("treats undefined status as error (unknown)", () => {
    expect(classifySendStatus(undefined)).toMatchObject({ outcome: "error", drop: false });
  });
});
