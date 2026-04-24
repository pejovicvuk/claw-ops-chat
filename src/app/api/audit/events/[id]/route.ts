import { extractSession, unauthorized } from "@/lib/auth-server";
import { readEventById } from "@/lib/audit/reader";

const EVENT_ID_RE = /^\d{4}-\d{2}-\d{2}:\d+$/;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!extractSession(request)) return unauthorized();
  const { id } = await context.params;
  if (!EVENT_ID_RE.test(id)) {
    return Response.json({ error: "Invalid event id" }, { status: 400 });
  }
  const event = await readEventById(id);
  if (!event) {
    return Response.json({ error: "Event not found" }, { status: 404 });
  }
  return Response.json(event);
}
