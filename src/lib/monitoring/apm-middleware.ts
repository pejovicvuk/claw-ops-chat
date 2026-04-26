import { extractSession } from "@/lib/auth-server";
import { getMetricsCollector } from "./singleton";
import { recordRequest } from "./collectors/apm";

type RouteHandler<Ctx> = (req: Request, ctx: Ctx) => Promise<Response>;

interface WithApmOpts {
  /** Canonical route, used as the bucket key. e.g. "/api/sessions" */
  route: string;
  /** Override method label if the underlying handler uses GET for a state mutation. */
  method?: string;
}

/**
 * Wraps a Next.js route handler to record per-route timing/error stats
 * into the APM collector. Sibling to `withAudit` — call after withAudit
 * (or compose them) so audit stays the outermost wrapper.
 */
export function withApm<Ctx>(opts: WithApmOpts, handler: RouteHandler<Ctx>): RouteHandler<Ctx> {
  return async (request, ctx) => {
    const startedAt = performance.now();
    const method = (opts.method ?? request.method).toUpperCase();
    let statusCode = 200;
    try {
      const response = await handler(request, ctx);
      statusCode = response.status;
      return response;
    } catch (err) {
      statusCode = 500;
      throw err;
    } finally {
      const collector = getMetricsCollector();
      if (collector) {
        const apm = collector.getApmTracker();
        const session = extractSession(request);
        recordRequest(apm, {
          route: opts.route,
          method,
          durationMs: performance.now() - startedAt,
          statusCode,
          actor: session?.email ?? "anonymous",
        });
      }
    }
  };
}
