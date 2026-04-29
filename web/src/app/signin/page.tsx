import { auth, signIn } from "@/auth";
import { redirect } from "next/navigation";

export default async function SignInPage() {
  const session = await auth();
  if (session?.user?.email) {
    redirect("/dashboard");
  }

  return (
    <main className="signin-page">
      <div className="signin-card">
        <p className="eyebrow">BeGifted Ops</p>
        <h1>Credit Control Dashboard</h1>
        <p className="muted">
          Sign in with an allowlisted Google account to access the migrated Next.js dashboard.
        </p>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/dashboard" });
          }}
        >
          <button className="primary-button" type="submit">
            Sign in with Google
          </button>
        </form>
      </div>
    </main>
  );
}
