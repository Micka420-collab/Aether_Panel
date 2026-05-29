import { redirect } from "next/navigation";
import { getCurrentUser, getAuth } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard/shell";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    // distinguish "needs 2FA" from "not logged in" for a nicer redirect
    const auth = await getAuth();
    redirect(auth ? "/login" : "/login");
  }
  return (
    <DashboardShell
      user={{ username: user!.username, email: user!.email, role: user!.role, avatarUrl: user!.avatarUrl }}
    >
      {children}
    </DashboardShell>
  );
}
