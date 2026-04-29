function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export interface AuthEnv {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  AUTH_SECRET: string;
  STAFF_ALLOWLIST: string;
}

export interface SheetsEnv {
  SHEETS_SERVICE_ACCOUNT_EMAIL: string;
  SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY: string;
  SHEETS_SPREADSHEET_ID_CREDITS: string;
  SHEETS_SPREADSHEET_ID_ANALYTICS: string;
}

export function getAuthEnv(): AuthEnv {
  return {
    GOOGLE_CLIENT_ID: required("GOOGLE_CLIENT_ID"),
    GOOGLE_CLIENT_SECRET: required("GOOGLE_CLIENT_SECRET"),
    AUTH_SECRET: required("AUTH_SECRET"),
    STAFF_ALLOWLIST: required("STAFF_ALLOWLIST"),
  };
}

export function getSheetsEnv(): SheetsEnv {
  return {
    SHEETS_SERVICE_ACCOUNT_EMAIL: required("SHEETS_SERVICE_ACCOUNT_EMAIL"),
    SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY: required("SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY"),
    SHEETS_SPREADSHEET_ID_CREDITS: required("SHEETS_SPREADSHEET_ID_CREDITS"),
    SHEETS_SPREADSHEET_ID_ANALYTICS: required("SHEETS_SPREADSHEET_ID_ANALYTICS"),
  };
}

export function getAllowedEmails(): string[] {
  return getAuthEnv().STAFF_ALLOWLIST.split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export interface WisenetEnv {
  WISENET_BASE_URL: string;
  WISENET_USER_ID: string;
  WISENET_API_KEY: string;
  WISENET_CENTER_ID: string;
  WISENET_NAMESPACE: string;
}

export interface DbEnv {
  DATABASE_URL: string;
  DATABASE_URL_UNPOOLED: string;
}

export function getWisenetEnv(): WisenetEnv {
  return {
    WISENET_BASE_URL: required("WISENET_BASE_URL"),
    WISENET_USER_ID: required("WISENET_USER_ID"),
    WISENET_API_KEY: required("WISENET_API_KEY"),
    WISENET_CENTER_ID: required("WISENET_CENTER_ID"),
    WISENET_NAMESPACE: required("WISENET_NAMESPACE"),
  };
}

export function getDbEnv(): DbEnv {
  return {
    DATABASE_URL: required("DATABASE_URL"),
    DATABASE_URL_UNPOOLED: required("DATABASE_URL_UNPOOLED"),
  };
}
