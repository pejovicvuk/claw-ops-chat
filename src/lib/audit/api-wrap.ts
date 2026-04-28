import { extractSession } from "../auth-server";
import { scrubErrorMessage } from "./scrub";
import { getAuditWriter } from "./writer";
import type { ApiAuditEventType, AuditSeverity } from "./types";

/**
 * Route-handler helpers. Two forms:
 *
 * 1. `withAudit({ route }, handler)` — wraps a Next.js route handler.
 *    Logs `request_complete` at the end, `request_error` if the handler
 *    throws. For GET handlers, only 4xx/5xx are logged (success is
 *    dropped so we don't spam the audit log with routine reads).
 *
 * 2. `logApi(request, outcome, startedAt)` — direct call, used from
 *    handlers that need to log even when they short-circuit (e.g. auth
 *    routes that return 401 before the handler body runs).
 *
 * Both resolve the `actor` from `extractSession(request)` (or
 * "anonymous" pre-auth) and never read the request body.
 */

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

interface WithAuditOpts {
  route: string;
  /**
   * Derive a target string from the incoming request (e.g. extract a
   * slug from the URL or clone the body for a path). May be async —
   * callers cloning a body should use `req.clone().json()` so the
   * handler below still sees a fresh body.
   */
  subjectFrom?: (req: Request) => string | null | Promise<string | null>;
  /** Override the route category label in the subject line. */
  label?: string;
  /**
   * When true, successful GET responses are also written to the audit
   * log (normally skipped to reduce noise). Use this for routes that
   * serve sensitive data — file reads, message history, audit exports.
   */
  auditSuccessGets?: boolean;
}

type RouteHandler<Ctx> = (req: Request, ctx: Ctx) => Promise<Response>;

export function withAudit<Ctx>(opts: WithAuditOpts, handler: RouteHandler<Ctx>): RouteHandler<Ctx> {
  return async (request, ctx) => {
    const startedAt = Date.now();
    const method = request.method.toUpperCase();
    const target = opts.subjectFrom
      ? ((await safeSubjectFrom(opts.subjectFrom, request)) ?? undefined)
      : undefined;
    let response: Response;
    try {
      response = await handler(request, ctx);
    } catch (err) {
      await fireAudit({
        request,
        method,
        route: opts.route,
        label: opts.label,
        statusCode: 500,
        target,
        errorMessage: err instanceof Error ? err.message : String(err),
        startedAt,
        type: "request_error",
        severity: "error",
      });
      throw err;
    }
    // Log all state-changing methods and errors unconditionally.
    // Skip success GETs unless the route opts in via auditSuccessGets (used
    // for sensitive-data endpoints: file reads, message history, exports).
    const status = response.status;
    const isStateChanging = STATE_CHANGING_METHODS.has(method);
    const isError = status >= 400;
    const isAuditedGet = method === "GET" && status < 400 && opts.auditSuccessGets;
    if (isStateChanging || isError || isAuditedGet) {
      await fireAudit({
        request,
        method,
        route: opts.route,
        label: opts.label,
        statusCode: status,
        target,
        startedAt,
        type: isError ? "request_error" : "request_complete",
        severity: isError ? (status >= 500 ? "error" : "warn") : "info",
      });
    }
    return response;
  };
}

/** Direct helper for handlers that return before `withAudit` would observe them. */
export async function logApi(
  request: Request,
  outcome: {
    statusCode: number;
    target?: string;
    errorMessage?: string;
    route?: string;
    label?: string;
  },
  startedAt: number,
): Promise<void> {
  const method = request.method.toUpperCase();
  const route = outcome.route ?? new URL(request.url).pathname;
  const isError = outcome.statusCode >= 400;
  await fireAudit({
    request,
    method,
    route,
    label: outcome.label,
    statusCode: outcome.statusCode,
    target: outcome.target,
    errorMessage: outcome.errorMessage,
    startedAt,
    type: isError ? "request_error" : "request_complete",
    severity: isError ? (outcome.statusCode >= 500 ? "error" : "warn") : "info",
  });
}

/**
 * Server.ts uses this for WebSocket upgrade events. It's separate from
 * `logApi` because WS upgrades return status 101 and don't carry the
 * Next.js Request type — accepts the bare primitives instead.
 */
export async function logWsUpgrade(args: {
  route: string;
  statusCode: number;
  actor: string;
  target?: string;
  durationMs?: number;
  errorMessage?: string;
}): Promise<void> {
  const isError = args.statusCode >= 400;
  await getAuditWriter()
    .api({
      type: "ws_upgrade",
      severity: isError ? "warn" : "info",
      actor: args.actor,
      subject: `UPGRADE ${args.route} → ${args.statusCode}`,
      durationMs: args.durationMs ?? null,
      route: args.route,
      method: "UPGRADE",
      statusCode: args.statusCode,
      target: args.target,
      details: args.errorMessage ? { error: scrubErrorMessage(args.errorMessage) } : {},
    })
    .catch(() => {});
}

interface FireAuditArgs {
  request: Request;
  method: string;
  route: string;
  label?: string;
  statusCode: number;
  target?: string;
  errorMessage?: string;
  startedAt: number;
  type: ApiAuditEventType;
  severity: AuditSeverity;
}

async function fireAudit(args: FireAuditArgs): Promise<void> {
  const session = extractSession(args.request);
  const actor = session?.email ?? "anonymous";
  const durationMs = Date.now() - args.startedAt;
  const subject = args.label
    ? `${args.method} ${args.label} → ${args.statusCode}`
    : `${args.method} ${args.route} → ${args.statusCode}`;
  await getAuditWriter()
    .api({
      type: args.type,
      severity: args.severity,
      actor,
      subject,
      durationMs,
      route: args.route,
      method: args.method,
      statusCode: args.statusCode,
      target: args.target,
      details: args.errorMessage ? { error: scrubErrorMessage(args.errorMessage) } : {},
    })
    .catch(() => {});
}

async function safeSubjectFrom(
  fn: (req: Request) => string | null | Promise<string | null>,
  req: Request,
): Promise<string | null> {
  try {
    return await fn(req);
  } catch {
    return null;
  }
}
