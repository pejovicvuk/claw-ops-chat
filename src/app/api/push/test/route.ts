import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import { sendToUser } from "@/lib/push/send";

async function postHandler(request: Request): Promise<Response> {
  const session = extractSession(request);
  if (!session) return unauthorized();
  // Test fires on every event channel so the user can verify each toggle
  // produces a notification (whichever channels they have enabled).
  await sendToUser(
    session.email,
    {
      title: "Claw Chat — test notification",
      body: "If you can see this, push is wired correctly.",
      kind: "turnComplete",
      url: "/chat",
    },
    "turnComplete",
  );
  return Response.json({ ok: true });
}

export const POST = withAudit({ route: "/api/push/test", subjectFrom: () => null }, postHandler);
