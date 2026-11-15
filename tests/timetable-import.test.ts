import test from "node:test";
import assert from "node:assert/strict";
import { parseTimetablePdf, parseTimetablePdfGroups } from "../lib/timetable-import.ts";

function makeGridPdf() {
  const at = (x: number, y: number, text: string) => `BT ${x} ${y} Td (${text}) Tj ET`;
  const lines = [
    at(40, 560, "PROGRAMME | DEMO Computer Science"), at(40, 540, "YEAR | 1"),
    at(50, 500, "Slot/Day"), at(150, 500, "Monday"), at(260, 500, "Tuesday"),
    at(50, 480, "08:00 - 09:00"), at(155, 480, "DEMO-CS101"),
    at(50, 460, "09:00 - 10:00"), at(155, 460, "DEMO-CS101"),
    at(50, 440, "10:00 - 11:00"), at(265, 440, "DEMO-CS102"),
    at(50, 420, "11:00 - 12:00"), at(265, 420, "DEMO-CS102"),
    at(50, 380, "MODULES"), at(50, 360, "DEMO-CS101"),
    at(50, 344, "- Computing Foundations 01A |"), at(50, 328, "Amani CampusBrain Demo Lecturer 01"),
    at(50, 304, "DEMO-CS102"), at(50, 288, "- Programming Concepts 01B |"),
    at(50, 272, "Amani CampusBrain Demo Lecturer 01"),
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(lines, "ascii")} >>\nstream\n${lines}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
}

test("reads positioned weekday timetable grids and resolves module details", () => {
  const result = parseTimetablePdf(makeGridPdf());
  assert.deepEqual(result.errors, []);
  assert.equal(result.programme, "DEMO Computer Science");
  assert.equal(result.year, 1);
  assert.deepEqual(result.rows, [
    { day_of_week: "Monday", start_time: "08:00:00", end_time: "10:00:00", course_code: "DEMO-CS101", course_name: "Computing Foundations 01A", lecturer_name: "Amani CampusBrain Demo Lecturer 01" },
    { day_of_week: "Tuesday", start_time: "10:00:00", end_time: "12:00:00", course_code: "DEMO-CS102", course_name: "Programming Concepts 01B", lecturer_name: "Amani CampusBrain Demo Lecturer 01" },
  ]);
});

test("extracts timetable content for the verified year even when the programme needs server-side validation", () => {
  const result = parseTimetablePdf(makeGridPdf(), { programme: "Different verified programme", year: 1 });
  assert.equal(result.programme, "DEMO Computer Science");
  assert.equal(result.year, 1);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.errors, []);
});

test("department timetable group extraction retains course catalog and sessions", () => {
  const result = parseTimetablePdfGroups(makeGridPdf());
  assert.deepEqual(result.errors, []);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].programme, "DEMO Computer Science");
  assert.equal(result.groups[0].year, 1);
  assert.equal(result.groups[0].courses.length, 2);
  assert.equal(result.groups[0].rows.length, 2);
});
