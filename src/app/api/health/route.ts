const startTime = Date.now();

export async function GET() {
  return Response.json({
    status: "ok",
    uptime: Math.floor((Date.now() - startTime) / 1000),
  });
}
