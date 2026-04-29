import { google } from "googleapis";
import { getSheetsEnv } from "@/lib/runtime/env";

let cachedClient: ReturnType<typeof google.sheets> | null = null;

export function getSheetsClient() {
  if (cachedClient) {
    return cachedClient;
  }

  const env = getSheetsEnv();
  const auth = new google.auth.JWT({
    email: env.SHEETS_SERVICE_ACCOUNT_EMAIL,
    key: env.SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  cachedClient = google.sheets({
    version: "v4",
    auth,
  });

  return cachedClient;
}
