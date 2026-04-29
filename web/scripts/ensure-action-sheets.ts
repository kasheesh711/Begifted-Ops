import { ensureActionSheetsExist } from "@/lib/sheets/actions";

async function main() {
  await ensureActionSheetsExist();
  console.log("Action sheets ensured.");
}

void main();
