import { auth } from "@/auth";
import { getDashboardPayload } from "@/lib/dashboard/service";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await getDashboardPayload();
  return NextResponse.json(payload);
}
