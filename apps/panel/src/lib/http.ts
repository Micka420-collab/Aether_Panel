import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { HttpError } from "./auth";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function noContent() {
  return new NextResponse(null, { status: 204 });
}

export function errorResponse(e: unknown) {
  if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof ZodError) {
    return NextResponse.json({ error: "Validation failed", issues: e.flatten() }, { status: 422 });
  }
  // Log the real error server-side, but never leak internal/Prisma/decryption
  // details to the client.
  console.error("[api]", e);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}

/** Wrap a route handler so thrown HttpError/ZodError become clean responses. */
export function route<Args extends unknown[]>(
  fn: (req: Request, ...args: Args) => Promise<Response>,
) {
  return async (req: Request, ...args: Args): Promise<Response> => {
    try {
      return await fn(req, ...args);
    } catch (e) {
      return errorResponse(e);
    }
  };
}
