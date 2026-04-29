import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

import { getAllowedEmails } from "@/lib/runtime/env";

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET || "local-dev-secret",
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID || "missing-google-client-id",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "missing-google-client-secret",
    }),
  ],
  pages: {
    signIn: "/signin",
  },
  callbacks: {
    async signIn({ user }) {
      const email = user.email?.toLowerCase();
      return !!email && getAllowedEmails().includes(email);
    },
    async session({ session }) {
      if (session.user?.email) {
        session.user.email = session.user.email.toLowerCase();
      }
      return session;
    },
  },
});
