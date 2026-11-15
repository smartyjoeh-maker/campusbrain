import { extractPdfText, extractPdfTextItems } from "./pdf-import.ts";

export type TimetableRow = {
  day_of_week: string;
  start_time: string;
  end_time: string;
  course_code: string;
  course_name: string;
  lecturer_name: string;
};

export type TimetableCourse = { code: string; name: string; lecturer_name: string };
export type TimetableGroup = { programme: string; year: number; courses: TimetableCourse[]; rows: TimetableRow[]; errors: string[] };

/** Extract every programme/year section from the department-style timetable PDFs. */
export function parseTimetablePdfGroups(bytes: Buffer): { groups: TimetableGroup[]; errors: string[] } {
  const text = extractPdfText(bytes);
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const yearStarts: number[] = [];
  lines.forEach((line, index) => { if (/\b(?:FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH)\s+YEAR\b|\bYEAR\s*[:|]?\s*\d{1,2}\b/i.test(line)) yearStarts.push(index); });
  const ordinal: Record<string, number> = { FIRST: 1, SECOND: 2, THIRD: 3, FOURTH: 4, FIFTH: 5, SIXTH: 6, SEVENTH: 7, EIGHTH: 8, NINTH: 9, TENTH: 10 };
  const groups: TimetableGroup[] = [];
  const errors: string[] = [];
  for (const [index, lineIndex] of yearStarts.entries()) {
    const lowerBound = index ? yearStarts[index - 1] + 1 : 0;
    const end = yearStarts[index + 1] ?? lines.length;
    const yearLine = lines[lineIndex];
    const yearMatch = yearLine?.match(/\b(FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH)\s+YEAR\b/i);
    const numericYear = yearLine?.match(/\bYEAR\s*[:|]?\s*(\d{1,2})\b/i)?.[1];
    const year = yearMatch ? ordinal[yearMatch[1].toUpperCase()] : numericYear ? Number(numericYear) : null;
    const programmeIndex = lines.slice(lowerBound, lineIndex).findLastIndex(line => /^(?:(?:ADVANCED\s+)?DIPLOMA|BACHELOR|CERTIFICATE|MASTER|BSC|B\.SC|DOCTOR|DEGREE)\b|^(?:PROGRAMME(?:\s+NAME)?|PROGRAM)\s*[:|]/i.test(line));
    const absoluteProgrammeIndex = programmeIndex < 0 ? lineIndex : lowerBound + programmeIndex;
    const programmeLine = lines[absoluteProgrammeIndex]?.replace(/\s+/g, " ") ?? "";
    const programme = /^(?:PROGRAMME(?:\s+NAME)?|PROGRAM)\s*[:|]/i.test(programmeLine)
      ? (programmeLine.match(/^(?:PROGRAMME(?:\s+NAME)?|PROGRAM)\s*[:|]\s*(.+)$/i)?.[1] ?? "")
      : programmeLine;
    const section = lines.slice(absoluteProgrammeIndex, end);
    if (!yearLine) continue;
    if (!programme || !year || year < 1 || year > 12) {
      errors.push(`Section ${index + 1}: programme or year of study could not be identified; this section was not imported.`);
      continue;
    }
    const sectionText = section.join("\n");
    const parsed = parsePositionedGrid(bytes, sectionText, { programme, year }, true);
    const catalog = parsed.courses;
    const beforeModules = section.slice(0, Math.max(0, section.findIndex(line => /^modules$/i.test(line))));
    const hasScheduledCourse = beforeModules.some(line => /^[A-Z][A-Z0-9-]*\s*\d{2,5}\s*\|/i.test(line));
    const gridNotMatched = parsed.errors.length === 1 && parsed.errors[0].startsWith("No timetable grid matched");
    const allowedEmptyGrid = parsed.rows.length === 0 && gridNotMatched && !hasScheduledCourse && catalog.length > 0;
    if ((parsed.rows.length === 0 && !allowedEmptyGrid) || (parsed.errors.length && !allowedEmptyGrid)) {
      errors.push(`${programme}, year ${year}: ${parsed.errors.join(" ") || "No class sessions were found."}`);
      continue;
    }
    const key = `${programme.toLowerCase()}|${year}`;
    if (groups.some(group => `${group.programme.toLowerCase()}|${group.year}` === key)) {
      errors.push(`${programme}, year ${year}: duplicate timetable section found in the PDF.`);
      continue;
    }
    groups.push({ programme, year, courses: catalog, rows: parsed.rows, errors: [] });
  }
  if (groups.length === 0 && errors.length === 0) errors.push("No timetable programme/year sections were found in the PDF.");
  return { groups, errors };
}

export function parseTimetablePdf(bytes: Buffer, expected?: { programme?: string; year?: number }) {
  const text = extractPdfText(bytes);
  let programme = "";
  let year: number | null = null;
  const rows: TimetableRow[] = [];
  const errors: string[] = [];
  const dayNames: Record<string, string> = {
    monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday",
    thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday",
  };
  const validTime = (value: string) => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value);
    return Boolean(match && Number(match[1]) < 24 && Number(match[2]) < 60);
  };
  const minutes = (value: string) => {
    const [hours, mins] = value.split(":").map(Number);
    return hours * 60 + mins;
  };

  for (const [index, original] of text.split(/\r?\n/).entries()) {
    const line = original.trim();
    if (!line || line.startsWith("#")) continue;
    const fields = line.split(/[|\t]/).map(field => field.trim());
    const key = fields[0]?.toLowerCase().replace(/\s+/g, " ");
    const metadata = /^(programme(?: name)?|program(?:me)?|year(?: of study)?)\s*[:|]\s*(.+)$/i.exec(line);
    if (metadata) {
      const kind = metadata[1].toLowerCase().startsWith("year") ? "year" : "programme";
      const value = metadata[2].trim();
      if (kind === "programme") {
        if (programme && programme.toLowerCase() !== value.toLowerCase()) errors.push(`Line ${index + 1}: conflicting programme names.`);
        else programme = value;
      } else {
        const parsedYear = Number(value.replace(/^year\s*/i, ""));
        if (!Number.isInteger(parsedYear) || parsedYear < 1 || parsedYear > 12) errors.push(`Line ${index + 1}: year of study must be between 1 and 12.`);
        else if (year !== null && year !== parsedYear) errors.push(`Line ${index + 1}: conflicting year values.`);
        else year = parsedYear;
      }
      continue;
    }

    if (fields.some(field => /\bbreak\b/i.test(field))) continue;
    if (/^(day|weekday|course code|course name)$/i.test(key ?? "")) continue;
    const day = dayNames[key ?? ""];
    if (!day) {
      errors.push(`Line ${index + 1}: expected a timetable day or programme/year header.`);
      continue;
    }

    let start_time = "";
    let end_time = "";
    let course_code = "";
    let course_name = "";
    let lecturer_name = "";
    if (fields.length === 5) {
      const range = /^(\d{1,2}:\d{2})\s*(?:-|–|to)\s*(\d{1,2}:\d{2})$/i.exec(fields[1] ?? "");
      if (range) [, start_time, end_time] = range;
      course_code = fields[2] ?? "";
      course_name = fields[3] ?? "";
      lecturer_name = fields[4] ?? "";
    } else if (fields.length === 6) {
      [, start_time, end_time, course_code, course_name, lecturer_name] = fields;
    } else {
      errors.push(`Line ${index + 1}: expected day | start-end time | course code | course name | lecturer, or day | start time | end time | course code | course name | lecturer.`);
      continue;
    }
    if (!validTime(start_time) || !validTime(end_time) || minutes(end_time) <= minutes(start_time) || !course_code || !course_name || !lecturer_name) {
      errors.push(`Line ${index + 1}: incomplete row or invalid time range.`);
      continue;
    }
    rows.push({ day_of_week: day, start_time: `${start_time.padStart(5, "0")}:00`, end_time: `${end_time.padStart(5, "0")}:00`, course_code, course_name, lecturer_name });
  }

  if (!programme) errors.push("Programme name was not found. Add a PROGRAMME | programme name header.");
  if (year === null) errors.push("Year of study was not found. Add a YEAR | number header.");
  if (rows.length === 0) {
    const grid = parsePositionedGrid(bytes, text, expected);
    if (grid.rows.length || grid.errors.length) {
      programme = grid.programme || programme;
      year = grid.year ?? year;
      rows.push(...grid.rows);
      errors.length = 0;
      errors.push(...grid.errors);
    }
  }
  if (rows.length === 0) errors.push("No class sessions were found in the PDF.");
  const duplicates = new Set<string>();
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.day_of_week}|${row.start_time}|${row.course_code}`.toLowerCase();
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  for (const duplicate of duplicates) errors.push(`Duplicate timetable session: ${duplicate}.`);
  return { programme, year, rows, errors };
}

function parsePositionedGrid(bytes: Buffer, extractedText: string, expected?: { programme?: string; year?: number }, strictProgramme = false) {
  const items = extractPdfTextItems(bytes);
  const errors: string[] = [];
  const rows: TimetableRow[] = [];
  const days: Record<string, string> = { monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday" };
  const timePattern = /^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/;
  const codePattern = /^([A-Z][A-Z0-9-]*\s*\d{2,5})\b/i;
  const moduleMap = new Map<string, { code: string; name: string; lecturer: string }>();
  const lines = extractedText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (let section = 0; section < lines.length; section++) {
    if (!/^modules$/i.test(lines[section])) continue;
    for (let index = section + 1; index + 2 < lines.length && !/^(?:modules|venue definition)$/i.test(lines[index]); index++) {
      const code = lines[index].match(/^([A-Z][A-Z0-9-]*(?:\s+\d{3,5})?)$/i)?.[1];
      if (!code) continue;
      const name = lines[index + 1].replace(/^[-–]\s*/, "").replace(/\s*\|\s*$/, "").trim();
      const lecturer = lines[index + 2].trim();
      if (name && lecturer && !/^(venue definition|code|name|wing|capacity)$/i.test(name)) {
        const key = normalizeCode(code);
        const existing = moduleMap.get(key);
        if (existing && (existing.name !== name || existing.lecturer !== lecturer)) errors.push(`${code}: conflicting course details appear in this programme's module list.`);
        else if (!existing) moduleMap.set(key, { code, name, lecturer });
        index += 2;
      }
    }
  }
  const streams = new Map<number, typeof items>();
  for (const item of items) streams.set(item.stream, [...(streams.get(item.stream) ?? []), item]);
  const streamGroups = [...streams.values()];
  if (expected?.programme) {
    const programmeFor = (streamItems: typeof items) => {
      const value = [...streamItems].sort((a, b) => b.y - a.y || a.x - b.x).map(item => item.text).join("\n");
      return value.match(/(?:PROGRAMME(?:\s+NAME)?|PROGRAM)\s*[:|]\s*([^\n]+)/i)?.[1]?.trim()
        ?? value.match(/(?:DIPLOMA|BACHELOR|CERTIFICATE)\s+IN\s+([^\n]+)/i)?.[0]?.trim()
        ?? "";
    };
    streamGroups.sort((a, b) => Number(programmeFor(a).toLowerCase() !== expected.programme!.toLowerCase()) - Number(programmeFor(b).toLowerCase() !== expected.programme!.toLowerCase()));
  }
  let programme = "";
  let year: number | null = null;
  for (const streamItems of streamGroups) {
    const ordered = [...streamItems].sort((a, b) => b.y - a.y || a.x - b.x);
    const header = ordered.find(item => /^(?:slot\s*\/\s*day|time\s*\/\s*day)$/i.test(item.text));
    if (!header) continue;
    const dayHeaders = ordered.filter(item => Object.hasOwn(days, item.text.toLowerCase()) && Math.abs(item.y - header.y) <= 2);
    if (dayHeaders.length < 2) continue;
    const streamLines = ordered.map(item => item.text.trim()).filter(Boolean);
    const streamText = streamLines.join("\n");
    let streamProgramme = streamText.match(/(?:PROGRAMME(?:\s+NAME)?|PROGRAM)\s*[:|]\s*([^\n]+)/i)?.[1]?.trim() ?? "";
    const yearHeader = streamText.match(/YEAR\s*[:|]?\s*(\d{1,2})\b/i)?.[1]
      ?? streamText.match(/\b(FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH)\s+YEAR\b/i)?.[1];
    const ordinal: Record<string, number> = { FIRST: 1, SECOND: 2, THIRD: 3, FOURTH: 4, FIFTH: 5, SIXTH: 6, SEVENTH: 7, EIGHTH: 8, NINTH: 9, TENTH: 10 };
    const streamYear = yearHeader ? Number(yearHeader) || ordinal[yearHeader.toUpperCase()] || null : null;
    if (!streamProgramme) {
      const diploma = streamText.match(/(?:^(?:ADVANCED\s+)?DIPLOMA|^BACHELOR|^CERTIFICATE|^MASTER|^BSC|^B\.SC|^DOCTOR|^DEGREE)[^\n]*/im)?.[0];
      if (diploma) streamProgramme = diploma.trim().toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase());
    }
    if (strictProgramme && expected?.programme && streamProgramme && normalizeLabel(streamProgramme) !== normalizeLabel(expected.programme)) continue;
    if (expected?.year && streamYear !== expected.year) continue;
    programme = streamProgramme || programme;
    year = streamYear ?? year;

    const slots = ordered.flatMap(item => {
      if (item.y >= header.y) return [];
      const match = timePattern.exec(item.text);
      return match ? [{ item, start: normalizeTime(match[1]), end: normalizeTime(match[2]) }] : [];
    }).sort((a, b) => b.item.y - a.item.y);
    if (!slots.length) { errors.push("The timetable grid has no readable time slots."); continue; }
    const headers = [...dayHeaders].sort((a, b) => a.x - b.x);
    const daySessions = new Map<string, TimetableRow[]>();
    for (const slot of slots) {
      if (slot.end <= slot.start) { errors.push(`Invalid time slot ${slot.start}-${slot.end}.`); continue; }
      for (let dayIndex = 0; dayIndex < headers.length; dayIndex++) {
        const headerItem = headers[dayIndex];
        const left = dayIndex === 0 ? -Infinity : (headers[dayIndex - 1].x + headerItem.x) / 2;
        const right = dayIndex === headers.length - 1 ? Infinity : (headerItem.x + headers[dayIndex + 1].x) / 2;
        const cell = ordered.find(item => item.y < header.y && Math.abs(item.y - slot.item.y) <= 5 && item.x >= left && item.x < right && codePattern.test(item.text));
        if (!cell) continue;
        const code = normalizeCode(codePattern.exec(cell.text)?.[1] ?? "");
        const courseInfo = moduleMap.get(code);
        if (!courseInfo || !courseInfo.lecturer) {
          errors.push(`${code}: its module name and assigned lecturer could not be read from the timetable module list.`);
          continue;
        }
        const day = days[headerItem.text.toLowerCase()];
        const sessions = daySessions.get(day) ?? [];
        const previous = sessions.at(-1);
        if (previous && normalizeCode(previous.course_code) === code && previous.end_time.slice(0, 5) === slot.start) previous.end_time = `${slot.end}:00`;
        else sessions.push({ day_of_week: day, start_time: `${slot.start}:00`, end_time: `${slot.end}:00`, course_code: courseInfo.code, course_name: courseInfo.name, lecturer_name: courseInfo.lecturer });
        daySessions.set(day, sessions);
      }
    }
    for (const daySessionsList of daySessions.values()) rows.push(...daySessionsList);
    break;
  }
  if (!rows.length && !errors.length) errors.push(expected ? "No timetable grid matched the verified programme and year in your account." : "No readable timetable grid was found. Include weekday columns and time-slot rows.");
  return { programme, year, rows, errors, courses: [...moduleMap.values()].map(item => ({ code: item.code, name: item.name, lecturer_name: item.lecturer })) };
}

function normalizeCode(value: string) { return value.replace(/\s+/g, "").toUpperCase(); }
function normalizeTime(value: string) { return value.padStart(5, "0"); }
function normalizeLabel(value: string) { return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
