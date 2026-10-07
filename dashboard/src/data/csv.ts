import type { Row } from "./connection";

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: Row[], columns: string[]): string {
  const lines = [columns.join(","), ...rows.map((row) => columns.map((c) => cell(row[c])).join(","))];
  return `${lines.join("\n")}\n`;
}
