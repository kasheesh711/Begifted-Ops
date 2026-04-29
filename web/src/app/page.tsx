import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

async function HomeRedirect() {
  const session = await auth();
  redirect(session?.user?.email ? "/dashboard" : "/signin");
  return null;
}

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <HomeRedirect />
    </Suspense>
  );
}
