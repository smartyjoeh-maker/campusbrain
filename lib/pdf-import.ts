import { inflateSync } from "node:zlib";

export type StudentRow = { registration_number: string; last_name: string; full_name: string; year_of_study: number; programme: string; gender?: string; phone_number?: string; qualification_level?: string; cr_candidate?: boolean };
export type LecturerCourse = { code: string; name: string; programme: string };
export type LecturerRow = { last_name: string; full_name: string; phone_number: string; courses?: LecturerCourse[] };
export type PdfTextItem = { text: string; x: number; y: number; stream: number };

export function extractPdfTextItems(bytes: Buffer): PdfTextItem[] {
  const source = bytes.toString("latin1");
  if (!source.startsWith("%PDF-")) throw new Error("The uploaded file is not a PDF.");
  const items: PdfTextItem[] = [];
  let streamIndex = 0;
  let processed = 0;
  let extracted = 0;
  for (const match of [...source.matchAll(/<<(.*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g)].slice(0, 2000)) {
    const dictionary = match[1] ?? "";
    if (/\/Subtype\s*\/Image/.test(dictionary)) { streamIndex++; continue; }
    const raw = Buffer.from(match[2] ?? "", "latin1");
    processed += raw.length;
    if (processed > 20 * 1024 * 1024 || extracted >= 5 * 1024 * 1024) break;
    let decoded = raw;
    if (/\/FlateDecode/.test(dictionary)) {
      try { decoded = inflateSync(decoded, { maxOutputLength: Math.min(2 * 1024 * 1024, 5 * 1024 * 1024 - extracted) }); }
      catch { streamIndex++; continue; }
    }
    const content = decoded.toString("latin1");
    for (const block of content.matchAll(/BT([\s\S]*?)ET/g)) {
      const body = block[1] ?? "";
      const position = [...body.matchAll(/(-?[\d.]+)\s+(-?[\d.]+)\s+Td/g)].at(-1)
        ?? [...body.matchAll(/-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm/g)].at(-1);
      if (!position) continue;
      const x = Number(position[1]);
      const y = Number(position[2]);
      const texts = [...body.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj|<([\da-fA-F]+)>\s*Tj/g)];
      for (const text of texts) {
        const value = text[1] !== undefined ? decodePdfLiteral(text[1]) : decodeHex(text[2] ?? "");
        if (value.trim() && items.length < 100000) {
          items.push({ text: value.trim(), x, y, stream: streamIndex });
          extracted += value.length;
        }
      }
    }
    streamIndex++;
  }
  return items;
}

export function extractPdfText(bytes: Buffer): string {
  const source = bytes.toString("latin1");
  if (!source.startsWith("%PDF-")) throw new Error("The uploaded file is not a PDF.");
  const streams = [...source.matchAll(/<<(.*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g)];
  const pieces: string[] = [];
  let processed = 0; let extracted = 0;
  for (const match of streams.slice(0, 2000)) {
    if (processed >= 20 * 1024 * 1024 || extracted >= 5 * 1024 * 1024) break;
    if (/\/Subtype\s*\/Image/.test(match[1])) continue;
    const raw = Buffer.from(match[2], "latin1");
    processed += raw.length;
    let decoded = raw;
    if (/\/FlateDecode/.test(match[1])) { try { decoded = inflateSync(raw, { maxOutputLength: 2 * 1024 * 1024 }); } catch { continue; } }
    const content = decoded.toString("latin1");
    // Extract PDF text operators. This intentionally does not guess column positions.
    for (const block of content.matchAll(/\[(.*?)\]\s*TJ|\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
      const body = block[1] ?? block[2] ?? "";
      const vals = block[1] ? [...body.matchAll(/\(((?:\\.|[^\\)])*)\)|<([\da-fA-F]+)>/g)].map(m => m[1] !== undefined ? decodePdfLiteral(m[1]) : decodeHex(m[2] ?? "")) : [decodePdfLiteral(body)];
      const text = vals.map(s => unescapePdf(s)).join(""); pieces.push(text); extracted += text.length;
    }
  }
  return pieces.join("\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
}
function decodeHex(value: string) {
  const b = Buffer.from(value, "hex");
  const offset = b.length >= 2 && b[0] === 0xfe && b[1] === 0xff ? 2 : 0;
  if (offset || (b.length > 4 && b.length % 2 === 0 && b.filter((_, index) => index % 2 === 0 && b[index] === 0).length / (b.length / 2) > 0.35)) {
    let s = "";
    for (let i = offset; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]);
    return s;
  }
  return b.toString("latin1");
}
function decodePdfLiteral(value: string) {
  const unescaped = unescapePdf(value);
  const bytes = Buffer.from(unescaped, "latin1");
  if (bytes.length > 4 && bytes.length % 2 === 0 && bytes.filter((_, index) => index % 2 === 0 && bytes[index] === 0).length / (bytes.length / 2) > 0.35) {
    let text = "";
    for (let index = 0; index + 1 < bytes.length; index += 2) text += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
    return text;
  }
  return unescaped;
}
function unescapePdf(value: string) {
  return value.replace(/\\([nrtbf()\\])/g, (_, c: string) => ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" }[c] ?? c)).replace(/\\\r?\n/g, "");
}
export function parseRows(text: string, category: "student" | "lecturer") {
  const errors: string[] = []; const rows: Array<StudentRow | LecturerRow> = [];
  text.split(/\r?\n/).map(s => s.trim()).filter(line => Boolean(line) && !line.startsWith("#")).forEach((line, i) => {
    const fields = line.split(/[|\t]/).map(s => s.trim());
    if (category === "student") {
      const [registration_number, last_name, full_name, year, programme, gender, phone_number, qualification_level, cr] = fields;
      const year_of_study = Number(year);
      const extended = fields.length === 8 || fields.length === 9;
      if (![5, 8, 9].includes(fields.length) || !registration_number || !last_name || !full_name || !Number.isInteger(year_of_study) || year_of_study < 1 || year_of_study > 12 || !programme) { errors.push(`Line ${i + 1}: expected registration number | last name | full name | year | programme, optionally followed by gender | phone | UQF level | CR/NO`); return; }
      if (extended && (!['Female', 'Male', 'Other', 'Prefer not to say'].includes(gender) || !/^\+?[0-9][0-9 ()-]{5,24}$/.test(phone_number) || !/^UQF \d{1,2}$/.test(qualification_level) || (fields.length === 9 && !['CR', 'NO'].includes(cr)))) { errors.push(`Line ${i + 1}: invalid gender, phone, qualification level, or CR/NO marker`); return; }
      rows.push({ registration_number, last_name, full_name, year_of_study, programme, ...(extended ? { gender, phone_number, qualification_level, cr_candidate: cr === 'CR' } : {}) });
    } else {
      const [last_name, full_name, phone_number, courseField] = fields;
      if (![3, 4].includes(fields.length) || !last_name || !full_name || !/^\+?[0-9][0-9 ()-]{5,24}$/.test(phone_number)) { errors.push(`Line ${i + 1}: expected last name | full name | phone number, optionally followed by code~course name~programme;...`); return; }
      const courses = courseField ? courseField.split(';').map(item => {
        const [code, name, programme] = item.split('~').map(part => part.trim());
        return { code, name, programme };
      }) : [];
      if (courses.some(course => !course.code || !course.name || !course.programme)) { errors.push(`Line ${i + 1}: each course must use code~course name~programme`); return; }
      rows.push({ last_name, full_name, phone_number, ...(courses.length ? { courses } : {}) });
    }
  });
  return { rows, errors };
}
