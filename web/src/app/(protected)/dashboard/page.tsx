import { auth } from "@/auth";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.email || !session.user.name) {
    redirect("/signin");
  }

  return (
    <DashboardShell
      sessionUser={{
        email: session.user.email,
        name: session.user.name,
      }}
    />
  );
}
