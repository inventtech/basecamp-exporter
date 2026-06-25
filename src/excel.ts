import ExcelJS from "exceljs";
import type { BasecampTodo } from "./types.ts";

interface Column {
  header: string;
  width: number;
  value: (t: BasecampTodo) => string;
}

/** Column order/labels for the exported sheet. Edit here to change output. */
const COLUMNS: Column[] = [
  { header: "Project", width: 28, value: (t) => t.bucket?.name ?? "" },
  { header: "To-do List", width: 28, value: (t) => t.parent?.title ?? "" },
  { header: "Title", width: 50, value: (t) => t.title || t.content || "" },
  { header: "Completed", width: 12, value: (t) => (t.completed ? "yes" : "no") },
  { header: "Assignees", width: 30, value: (t) => (t.assignees ?? []).map((a) => a.name).join("; ") },
  { header: "Due On", width: 14, value: (t) => t.due_on ?? "" },
  { header: "Created At", width: 22, value: (t) => t.created_at ?? "" },
  { header: "Updated At", width: 22, value: (t) => t.updated_at ?? "" },
  { header: "URL", width: 50, value: (t) => t.app_url || t.url || "" },
];

/** Yellow fill applied to Created At / Updated At cells dated in the current month. */
const CURRENT_MONTH_FILL: ExcelJS.FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFFF00" },
};

/** True if an ISO timestamp falls in the given year/month (month is 0-based). */
export function isInMonth(iso: string | null | undefined, year: number, month: number): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && d.getFullYear() === year && d.getMonth() === month;
}

/**
 * Write the to-dos to a single sheet, sorted by Updated At (newest first). The
 * Created At / Updated At cells are highlighted yellow when they fall in the
 * current calendar month.
 */
export async function writeXlsx(todos: BasecampTodo[], outPath: string): Promise<void> {
  const sorted = [...todos].sort(
    (a, b) => (Date.parse(b.updated_at ?? "") || 0) - (Date.parse(a.updated_at ?? "") || 0),
  );

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "basecamp-exporter";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("To-dos");
  sheet.columns = COLUMNS.map((c) => ({ header: c.header, width: c.width }));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const createdCol = COLUMNS.findIndex((c) => c.header === "Created At") + 1;
  const updatedCol = COLUMNS.findIndex((c) => c.header === "Updated At") + 1;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  for (const todo of sorted) {
    const row = sheet.addRow(COLUMNS.map((c) => c.value(todo)));
    if (isInMonth(todo.created_at, year, month)) row.getCell(createdCol).fill = CURRENT_MONTH_FILL;
    if (isInMonth(todo.updated_at, year, month)) row.getCell(updatedCol).fill = CURRENT_MONTH_FILL;
  }

  sheet.autoFilter = { from: "A1", to: { row: 1, column: COLUMNS.length } };

  await workbook.xlsx.writeFile(outPath);
}
