import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "public", "sample-imports", "campusbrain-demo-timetable.pdf");
const escapePdf = text => text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
const at = (x, y, text) => `BT /F1 9 Tf ${x} ${y} Td (${escapePdf(text)}) Tj ET`;
const commands = [
  at(190, 570, "CAMPUSBRAIN CLASS TIMETABLE"),
  at(230, 550, "PROGRAMME | DEMO Computer Science"),
  at(325, 532, "YEAR | 1"),
  at(55, 500, "Slot/Day"), at(155, 500, "Monday"), at(280, 500, "Tuesday"),
  at(405, 500, "Wednesday"), at(530, 500, "Thursday"), at(655, 500, "Friday"),
];

const schedule = [
  ["08:00 - 09:00", ["DEMO-CS101", "DEMO-CS102", "", "DEMO-CS102", ""]],
  ["09:00 - 10:00", ["DEMO-CS101", "DEMO-CS102", "", "DEMO-CS102", ""]],
  ["10:00 - 11:00", ["", "", "DEMO-CS101", "", ""]],
  ["11:00 - 12:00", ["", "", "DEMO-CS101", "", ""]],
  ["13:00 - 14:00", ["DEMO-CS102", "", "", "", "DEMO-CS101"]],
  ["14:00 - 15:00", ["DEMO-CS102", "", "", "", "DEMO-CS101"]],
];
let y = 478;
for (const [time, cells] of schedule) {
  commands.push(at(48, y, time));
  cells.forEach((code, index) => { if (code) commands.push(at(160 + index * 125, y, code)); });
  y -= 24;
}
commands.push(at(55, 318, "MODULES"));
commands.push(at(55, 298, "DEMO-CS101"), at(55, 282, "- Computing Foundations 01A |"), at(55, 266, "Amani CampusBrain Demo Lecturer 01"));
commands.push(at(55, 242, "DEMO-CS102"), at(55, 226, "- Programming Concepts 01B |"), at(55, 210, "Amani CampusBrain Demo Lecturer 01"));
commands.push(at(55, 160, "FICTIONAL TRAINING SAMPLE - NOT UNIVERSITY DATA"));

const stream = `${commands.join("\n")}\n`;
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}endstream`,
];
let pdf = "%PDF-1.4\n";
const offsets = [0];
for (let index = 0; index < objects.length; index++) {
  offsets.push(Buffer.byteLength(pdf, "ascii"));
  pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
}
const xrefOffset = Buffer.byteLength(pdf, "ascii");
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

await mkdir(dirname(output), { recursive: true });
await writeFile(output, pdf, "ascii");
console.log("Generated fictional CampusBrain grid timetable sample.");
