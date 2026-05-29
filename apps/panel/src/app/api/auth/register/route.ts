import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, createSession, HttpError } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { audit } from "@/lib/audit";

const schema = z.object({
  email: z.string().email().max(160),
  username: z
    .string()
    .min(3)
    .max(24)
    .regex(/^[a-zA-Z0-9_]+$/, "letters, numbers and underscores only"),
  password: z.string().min(8).max(200),
});

export const POST = route(async (req) => {
  const { email, username, password } = schema.parse(await req.json());

  const exists = await db.user.findFirst({
    where: { OR: [{ email: email.toLowerCase() }, { username }] },
  });
  if (exists) throw new HttpError(409, "Email or username already in use");

  const userCount = await db.user.count();
  const user = await db.user.create({
    data: {
      email: email.toLowerCase(),
      username,
      passwordHash: await hashPassword(password),
      role: userCount === 0 ? "ADMIN" : "USER", // first account bootstraps the admin
    },
  });

  await createSession(user.id, true);
  await audit("user.register", { userId: user.id });
  return json({ id: user.id, username: user.username, email: user.email, role: user.role });
});
