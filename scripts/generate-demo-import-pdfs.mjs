import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "public", "sample-imports");

function escapePdf(text) {
  return text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function makePdf(lines) {
  const commands = ["BT", "/F1 7 Tf", "48 754 Td", "9 TL"];
  for (const line of lines) commands.push(`(${escapePdf(line)}) Tj`, "T*");
  commands.push("ET");
  const stream = `${commands.join("\n")}\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
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
  return Buffer.from(pdf, "ascii");
}

const studentLines = [
  "# CAMPUSBRAIN TRAINING SAMPLE - ALL PEOPLE AND RECORDS BELOW ARE FICTIONAL",
  "# Student rows: registration | last name | full name | year | programme | gender | phone | UQF level | CR/NO",
  "# Academic details below match the user-provided first-year Diploma in Computer Science timetable.",
  "# Two CR rows are approved only when an administrator confirms this import in CampusBrain.",
];
const givenNames = ["Amani", "Neema", "Baraka", "Zawadi", "Jabari", "Rehema", "Kito", "Imani", "Nuru", "Taji", "Faraji", "Upendo", "Tumaini", "Juma", "Asha", "Bahati", "Pendo", "Kassim", "Subira", "Rafiki"];
const genders = ["Female", "Male", "Male", "Female", "Male", "Female", "Male", "Female", "Female", "Male", "Male", "Female", "Female", "Male", "Female", "Male", "Female", "Male", "Female", "Male"];
for (let index = 0; index < 20; index++) {
  const n = String(index + 1).padStart(4, "0");
  const phone = `+000 000 00 ${String(index + 1).padStart(2, "0")}`;
  const cr = index < 2 ? "CR" : "NO";
  studentLines.push(`DEMO-STU-${n} | Demo${n} | ${givenNames[index]} CampusBrain Demo${n} | 1 | Diploma In Computer Science | ${genders[index]} | ${phone} | UQF 6 | ${cr}`);
}

const lecturerLines = [
  "# CAMPUSBRAIN TRAINING SAMPLE - PHONE NUMBERS ARE INVALID +000 PLACEHOLDERS",
  "# Lecturer display names and course details are copied from the user-provided timetable and are abbreviated there.",
  "# Do not use these sample rows as authentic lecturer registration records.",
  "# Lecturer rows: last name | full name | phone | courseCode~courseName~programme;...",
];
const programme = "Diploma In Computer Science";
const modules = [
  ["HS 6101", "Communication Skills", "Yassin A"],
  ["MS 6101", "Algebra", "Saria V"],
  ["IT 6101", "Computer Application", "Mzava N"],
  ["CS 6101", "Computer Maintainance And Repair", "Pangahela R"],
  ["IT 6102", "Computer Networks", "Bynite D"],
  ["IF 6102", "Fundamental Of Business Intelligence", "Ruvugo D"],
  ["CS 6258", "Computer Architecture", "Sanga N"],
  ["MS 6221", "Calculus", "Juma M"],
  ["ET 6201", "Digital Electronics", "Sikoro A"],
  ["CS 6202", "Object Oriented Programming 1", "Dastan D"],
  ["IT 6217", "Database Systems Design And Management", "Mtowe R"],
  ["IT 6216", "Systems Analysis And Design", "Mwakifuna D"],
  ["CS 6371", "Analysis And Design Algorithms", "Malissa E"],
  ["CS 6372", "Research Methodology", "Lupenza E"],
  ["CS 6373", "Information System Management", "Nchia E"],
  ["CS 6374", "Entrepreneurship And Development", "Mwakalapuka K"],
  ["CS 6375", "It Security", "Andrew R"],
  ["CS 6376", "Project I", "Sikoro A"],
];
const lecturerCourses = new Map();
for (const [code, name, lecturer] of modules) {
  const courses = lecturerCourses.get(lecturer) ?? [];
  courses.push(`${code}~${name}~${programme}`);
  lecturerCourses.set(lecturer, courses);
}
const lecturers = [...lecturerCourses.entries()];
for (let index = 0; index < lecturers.length; index++) {
  const n = String(index + 1).padStart(2, "0");
  const phone = `+000 100 00 ${n}`;
  const [fullName, courses] = lecturers[index];
  const lastName = fullName.split(/\s+/)[0];
  lecturerLines.push(`${lastName} | ${fullName} | ${phone} | ${courses.join(";")}`);
}

await mkdir(output, { recursive: true });
await writeFile(resolve(output, "campusbrain-demo-students.pdf"), makePdf(studentLines));
await writeFile(resolve(output, "campusbrain-demo-lecturers.pdf"), makePdf(lecturerLines));
console.log("Generated a fictional student sample and a clearly labeled timetable-matching lecturer sample.");
