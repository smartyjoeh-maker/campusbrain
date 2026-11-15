import test from "node:test";
import assert from "node:assert/strict";
import { extractPdfText, parseRows } from "../lib/pdf-import.ts";

test("extracts text from a basic text based PDF content stream", () => {
  const pdf = Buffer.from("%PDF-1.4\n<< >>\nstream\nBT (TEST-ID | LAST | FULL_NAME | 2 | PROGRAMME) Tj ET\nendstream\n%%EOF", "latin1");
  assert.equal(extractPdfText(pdf), "TEST-ID | LAST | FULL_NAME | 2 | PROGRAMME");
});
test("reports malformed records instead of accepting them", () => {
  const result = parseRows("CB-01 | Nuru", "student");
  assert.equal(result.rows.length, 0);
  assert.match(result.errors[0], /expected registration number/);
});
test("parses valid lecturer rows", () => {
  const result = parseRows("LAST | FULL_NAME | 0000000000", "lecturer");
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.rows[0], { last_name: "LAST", full_name: "FULL_NAME", phone_number: "0000000000" });
});
