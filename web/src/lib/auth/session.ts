import { auth } from "@/auth";
import type { AppSessionUser } from "@/types/dashboard";

export async function requireSessionUser(): Promise<AppSessionUser> {
  const session = await auth();
  const email = session?.user?.email?.trim().toLowerCase();
  const name = session?.user?.name?.trim();

  if (!email || !name) {
    throw new Error("Unauthorized");
  }

  return { email, name };
}
