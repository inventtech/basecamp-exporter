import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlink } from "node:fs/promises";
import ExcelJS from "exceljs";
import { writeXlsx, isInMonth } from "./excel.ts";
import type { BasecampTodo } from "./types.ts";

function mk(o: { id: number; created_at: string; updated_at: string }): BasecampTodo {
  return {
    id: o.id,
    status: "active",
    type: "Todo",
    title: `todo ${o.id}`,
    created_at: o.created_at,
    updated_at: o.updated_at,
    completed: false,
    due_on: null,
    bucket: { id: 1, name: "Project", type: "Project" },
    url: "u",
    app_url: "a",
  };
}

describe("isInMonth", () => {
  test("matches same year and (0-based) month", () => {
    expect(isInMonth("2026-06-15T00:00:00Z", 2026, 5)).toBe(true);
    expect(isInMonth("2026-05-31T00:00:00Z", 2026, 5)).toBe(false);
    expect(isInMonth(null, 2026, 5)).toBe(false);
    expect(isInMonth("not a date", 2026, 5)).toBe(false);
  });
});

describe("writeXlsx", () => {
  test("sorts by updated_at desc and highlights current-month date cells", async () => {
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15).toISOString();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15).toISOString();
    const ancient = "2020-01-01T00:00:00.000Z";

    const todos = [
      mk({ id: 1, created_at: ancient, updated_at: lastMonth }),
      mk({ id: 2, created_at: thisMonth, updated_at: thisMonth }),
    ];

    const out = join(tmpdir(), `bc-excel-test-${Date.now()}.xlsx`);
    await writeXlsx(todos, out);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(out);
    const ws = wb.getWorksheet("To-dos")!;

    // Newest (this month) sorts to the top data row.
    expect(String(ws.getRow(2).getCell(3).value)).toBe("todo 2");
    expect(String(ws.getRow(2).getCell(8).value)).toBe(thisMonth);

    // This-month Created At (col 7) + Updated At (col 8) are highlighted yellow.
    expect((ws.getRow(2).getCell(7).fill as ExcelJS.FillPattern)?.fgColor?.argb).toBe("FFFFFF00");
    expect((ws.getRow(2).getCell(8).fill as ExcelJS.FillPattern)?.fgColor?.argb).toBe("FFFFFF00");

    // Older row: last-month Updated At is not highlighted; ancient Created At is not.
    expect((ws.getRow(3).getCell(8).fill as ExcelJS.FillPattern)?.fgColor?.argb).toBeUndefined();
    expect((ws.getRow(3).getCell(7).fill as ExcelJS.FillPattern)?.fgColor?.argb).toBeUndefined();

    await unlink(out);
  });
});
