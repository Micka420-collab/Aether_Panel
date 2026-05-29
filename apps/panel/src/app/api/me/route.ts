import { getCurrentUser } from "@/lib/auth";
import { json, route } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const user = await getCurrentUser();
  if (!user) return json({ user: null }, 401);
  return json({
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      totpEnabled: user.totpEnabled,
      credits: user.credits,
      avatarUrl: user.avatarUrl,
    },
  });
});
