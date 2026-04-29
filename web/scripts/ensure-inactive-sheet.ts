import { ensureInactiveStudentsSheetExists } from "@/lib/sheets/inactive-students";

async function main() {
  await ensureInactiveStudentsSheetExists();
  console.log("InactiveStudents sheet ensured.");
}

void main();
