import { route } from "@/lib/http";
import { authApi, requireApiScope } from "@/lib/api-auth";
import { getServerContext, assertScope } from "@/lib/access";
import { DaemonClient } from "@/lib/daemon";

export const runtime = "nodejs";

// GET — stream a raw file download (any size/type, not just editable text)
export const GET = route(async (req: Request, ctx: { params: { id: string } }) => {
  const principal = await authApi(req);
  const c = await getServerContext(principal.user, ctx.params.id);
  requireApiScope(principal, "file.read");
  assertScope(c, "file.read");
  const path = new URL(req.url).searchParams.get("path") ?? "";
  const upstream = await new DaemonClient(c.node).downloadFile(c.server.id, path);
  if (!upstream.ok || !upstream.body) {
    return new Response(JSON.stringify({ error: "Download failed" }), {
      status: upstream.status || 502,
      headers: { "content-type": "application/json" },
    });
  }
  const name = (path.split("/").pop() || "download").replace(/[\r\n"\\]/g, "_");
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-disposition": `attachment; filename="${name}"`,
      "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
    },
  });
});
