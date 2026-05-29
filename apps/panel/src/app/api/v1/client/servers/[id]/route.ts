import { route, json } from "@/lib/http";
import { authApi } from "@/lib/api-auth";
import { getServerContext } from "@/lib/access";
import { getTemplate, buildAddress } from "@aether/shared";

export const GET = route(async (req, ctx: { params: { id: string } }) => {
  const { user } = await authApi(req);
  const c = await getServerContext(user, ctx.params.id);
  const tpl = getTemplate(c.server.templateId);
  const env = (c.server.environment as Record<string, string>) ?? {};
  const primary = c.allocations.find((a) => a.primary) ?? c.allocations[0];
  const defaultPort = tpl?.ports.find((p) => p.primary)?.default ?? primary?.port ?? 0;

  return json({
    id: c.server.id,
    name: c.server.name,
    game: c.server.game,
    template: c.server.templateId,
    state: c.server.state,
    address: primary ? buildAddress(primary.ip, primary.port, defaultPort) : null,
    allocations: c.allocations.map((a) => ({ ip: a.ip, port: a.port, protocol: a.protocol, role: a.role, primary: a.primary })),
    variables: (tpl?.variables ?? [])
      .filter((v) => v.userViewable)
      .map((v) => ({ key: v.key, value: env[v.key] ?? v.default })),
  });
});
