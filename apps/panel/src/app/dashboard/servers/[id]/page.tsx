import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getServerContext } from "@/lib/access";
import { ServerDetail } from "@/components/dashboard/server-detail";

export const dynamic = "force-dynamic";

export default async function ServerPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  try {
    await getServerContext(user, params.id); // 404/403 -> notFound
  } catch {
    notFound();
  }
  return <ServerDetail id={params.id} />;
}
