import { Suspense } from "react";
import { auth } from "@/auth";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { redirect } from "next/navigation";

async function DashboardBody() {
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

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <DashboardBody />
    </Suspense>
  );
}
