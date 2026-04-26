import { extractSession, unauthorized } from "@/lib/auth-server";
import { getVapidPublicKey } from "@/lib/push/vapid";

export async function GET(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  return Response.json({ publicKey: getVapidPublicKey() });
}
