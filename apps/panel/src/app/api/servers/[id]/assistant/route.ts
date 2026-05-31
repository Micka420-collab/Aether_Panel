import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { getServerContext, assertScope } from "@/lib/access";
import { DaemonClient } from "@/lib/daemon";
import { getTemplate } from "@aether/shared";
import { hasScope } from "@aether/shared";
import {
  askAssistant,
  type AssistantContext,
  type AssistantMessage,
  type AssistantVariable,
} from "@/lib/assistant";

/**
 * AI Server Copilot endpoint.
 *
 * POST { messages: [{ role, content }] } -> { reply, suggestedCommands?, source }
 *
 * Read-only with respect to the server: it only gathers context and asks the
 * assistant. Gated on `control.console` (the same view-level scope used by the
 * metrics/stats route), because the chat surfaces live console-adjacent state.
 * Whether the user may *apply* suggested commands is decided separately by
 * `control.command` (we forward that as `canCommand` so the helper only proposes
 * runnable actions the user can actually execute).
 */

const schema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(8000),
      }),
    )
    .min(1)
    .max(40),
});

export const dynamic = "force-dynamic";

export const POST = route(async (req, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  assertScope(c, "control.console");

  const { messages } = schema.parse(await req.json());

  const env = (c.server.environment as Record<string, string>) ?? {};
  const tpl = getTemplate(c.server.templateId);

  // Live state (falls back to the cached row state if the node is unreachable).
  let state = c.server.state as string;
  try {
    const status = await new DaemonClient(c.node).status(c.server.id);
    if (status?.state) state = status.state;
  } catch {
    /* node offline -> use cached state */
  }

  // Build user-viewable startup variables with their effective values, exactly
  // like the server detail route does, so the copilot reasons over real config.
  const variables: AssistantVariable[] = (tpl?.variables ?? [])
    .filter((v) => v.userViewable)
    .map((v) => ({
      key: v.key,
      name: v.name,
      value: env[v.key] ?? v.default,
      options: v.options,
    }));

  const canCommand = hasScope(c.scopes, "control.command");

  const assistantCtx: AssistantContext = {
    serverName: c.server.name,
    game: c.server.game,
    templateId: c.server.templateId,
    templateName: tpl?.name,
    // Common itzg/Minecraft env names; harmless for other games (undefined).
    type: env.TYPE ?? env.SERVER_TYPE,
    version: env.VERSION ?? env.SERVER_VERSION ?? env.MC_VERSION,
    state,
    features: tpl?.features ?? [],
    variables,
    // The daemon exposes console only over WebSocket (no HTTP tail endpoint), so
    // we intentionally omit consoleTail; the helper degrades gracefully without it.
    consoleTail: undefined,
    canCommand,
  };

  const result = await askAssistant(assistantCtx, messages as AssistantMessage[]);
  return json(result);
});
