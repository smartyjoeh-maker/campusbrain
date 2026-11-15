/**
 * Robust university timetable document ingestion engine.
 *
 * Replaces the fragile single-strategy parser with a multi-strategy,
 * layout-adaptive extraction pipeline that adapts to different official
 * PDF layouts instead of requiring the university to redesign its documents.
 *
 * Design principles:
 * 1. Never invent missing data — flag uncertain items for administrator review.
 * 2. Course codes are scoped by (department, programme, year) — not globally unique.
 * 3. Empty timetables are valid — do not reject a group because it has no sessions.
 * 4. "DRAFT", "WORKSHOP", "VENUE DEFINITION" etc. are document headings, not course codes.
 * 5. Extract everything confidently identifiable, flag the rest with confidence scores.
 */

import { extractPdfText } from "../pdf-import.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExtractionIssueType =
  | "conflict"
  | "missing_lecturer"
  | "empty_grid"
  | "unrecognized_heading"
  | "multi_line_cell"
  | "ocr_error"
  | "layout_ambiguity"
  | "missing_module_entry";

export type ExtractionIssueSeverity = "warning" | "error" | "info";

export type ExtractionIssue = {
  type: ExtractionIssueType;
  severity: ExtractionIssueSeverity;
  message: string;
  sourcePage: number;
  sourceLine?: number;
  sourceText?: string;
  suggestion?: string | null;
};

export type ExtractedCourse = {
  code: string;
  name: string;
  lecturer: string | null;
  sourcePage: number;
  sourceLine: number;
  confidence: number; // 0-100
  issues: ExtractionIssue[];
};

export type ExtractedSession = {
  dayOfWeek: string;
  startTime: string; // "HH:MM:00"
  endTime: string; // "HH:MM:00"
  courseCode: string;
  courseName: string | null; // resolved from course catalog
  lecturer: string | null;
  venue: string | null;
  sourcePage: number;
  sourceLine?: number;
  confidence: number; // 0-100
  issues: ExtractionIssue[];
};

export type ExtractionGroup = {
  department: string;
  programme: string;
  year: number;
  semester: string | null;
  courses: ExtractedCourse[];
  sessions: ExtractedSession[];
  confidence: number; // 0-100 overall group confidence
  issues: ExtractionIssue[];
  isEmpty: boolean; // true if no sessions found (genuinely empty timetable)
};

export type RobustExtractionResult = {
  filename: string;
  totalPages: number;
  groups: ExtractionGroup[];
  allIssues: ExtractionIssue[];
  summary: {
    totalGroups: number;
    totalCourses: number;
    totalSessions: number;
    emptyGroups: number;
    groupsWithIssues: number;
    averageConfidence: number;
  };
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAYS: Record<string, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

// Known non-course headings that should never be treated as course codes
const NON_COURSE_HEADINGS = new Set([
  "draft",
  "workshop",
  "workshop/studio days",
  "venue definition",
  "code",
  "name",
  "wing",
  "capacity",
  "modules",
  "slot/day",
  "day",
  "time",
  "break time",
  "cross-cuttings",
  "cross-cutting",
  "programme",
  "program",
  "students",
  "tolerance",
  "torelance",
]);

// Course code pattern: starts with 2+ uppercase letters, may contain digits/hyphens/spaces
// Must contain at least one digit to avoid matching pure words like "DRAFT"
const CODE_PATTERN = /^([A-Z]{2,}[A-Z0-9\-]*\s*\d{2,5}|[A-Z]{2,}\s+\d{2,5})$/i;

// Module line patterns (tried in order)
const MODULE_PATTERN_A = /^([A-Z]{2,}[A-Z0-9\-]*\s*\d{2,5})\s*[-–]\s*(.+?)\s*\|\s*(.+)$/i;
const MODULE_PATTERN_B = /^([A-Z]{2,}[A-Z0-9\-]*\s*\d{2,5})\s*\|\s*(.+?)\s*\|\s*(.+)$/i;
const MODULE_PATTERN_C = /^([A-Z]{2,}[A-Z0-9\-]*\s*\d{2,5})\s*[-–]\s*(.+)$/i;

// Time range pattern: "HH:MM - HH:MM"
const TIME_RANGE_PATTERN = /^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/;

// Year pattern
const YEAR_PATTERN = /\b(FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH)\s+YEAR\b|\bYEAR\s*[:|]?\s*(\d{1,2})\b/i;
const ORDINAL_YEAR: Record<string, number> = {
  FIRST: 1, SECOND: 2, THIRD: 3, FOURTH: 4, FIFTH: 5,
  SIXTH: 6, SEVENTH: 7, EIGHTH: 8, NINTH: 9, TENTH: 10,
};

// Degree keywords — only stripped when they appear at the START of a programme line

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNonCourseHeading(text: string): boolean {
  const lower = text.trim().toLowerCase();
  if (NON_COURSE_HEADINGS.has(lower)) return true;
  if (/^(draft|workshop|venue)\b/i.test(lower)) return true;
  return false;
}

function parseYear(value: string): number | null {
  const ordinal = value.match(/\b(FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH)\s+YEAR\b/i);
  if (ordinal) return ORDINAL_YEAR[ordinal[1].toUpperCase()] ?? null;
  const numeric = value.match(/\bYEAR\s*[:|]?\s*(\d{1,2})\b/i);
  if (numeric) {
    const n = Number(numeric[1]);
    if (n >= 1 && n <= 12) return n;
  }
  return null;
}

function normalizeTime(value: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return "";
  const h = Number(match[1]).toString().padStart(2, "0");
  const m = match[2].padStart(2, "0");
  return `${h}:${m}:00`;
}

function extractCourseCode(text: string): string | null {
  const match = CODE_PATTERN.exec(text.trim());
  if (!match) return null;
  return match[1].trim();
}

/**
 * Clean a course name by removing leading/trailing hyphens, pipes,
 * and whitespace so only the pure course name remains.
 * e.g. "- Agricultural Botany |" → "Agricultural Botany"
 *      "Communication Skills -" → "Communication Skills"
 *      "| Computer Graphics |" → "Computer Graphics"
 */
function cleanCourseName(name: string): string {
  return name
    .replace(/^[-–|\s]+/, "")   // strip leading hyphens, pipes, spaces
    .replace(/[-–|\s]+$/, "")   // strip trailing hyphens, pipes, spaces
    .trim();
}

// ---------------------------------------------------------------------------
// Section detection
// ---------------------------------------------------------------------------

type RawSection = {
  department: string;
  programme: string;
  year: number;
  semester: string | null;
  startLine: number;
  endLine: number;
  lines: string[];
  page: number;
};

/**
 * Detect programme/year sections within extracted text lines.
 * Looks for YEAR headers, then finds the programme line immediately before.
 */
function detectSections(
  lines: string[],
  pageMap: Map<number, number>
): RawSection[] {
  const sections: RawSection[] = [];
  const yearStarts: number[] = [];

  lines.forEach((line, index) => {
    if (YEAR_PATTERN.test(line)) yearStarts.push(index);
  });

  for (const [idx, lineIndex] of yearStarts.entries()) {
    const lowerBound = idx === 0 ? 0 : yearStarts[idx - 1] + 1;
    const end = yearStarts[idx + 1] ?? lines.length;
    const yearLine = lines[lineIndex];
    const year = parseYear(yearLine);
    if (!year) continue;

    // Find programme line: look immediately before the year line
    let programmeLine = "";
    let programmeIndex = lineIndex;

    // Check the line immediately before year
    if (lineIndex - 1 >= lowerBound) {
      const candidate = lines[lineIndex - 1].trim();
      if (candidate && !YEAR_PATTERN.test(candidate)) {
        programmeLine = candidate;
        programmeIndex = lineIndex - 1;
      }
    }

    // If not found, search further back
    if (!programmeLine) {
      for (let i = lineIndex - 2; i >= lowerBound; i--) {
        const candidate = lines[i].trim();
        if (candidate && !YEAR_PATTERN.test(candidate) && !isNonCourseHeading(candidate)) {
          programmeLine = candidate;
          programmeIndex = i;
          break;
        }
      }
    }

    if (!programmeLine) continue;

    // Keep the full programme name including degree keyword (Bachelor/Diploma/etc.)
    const programme = programmeLine.trim().replace(/\s+/g, " ");

    // Extract department: look for "DEPARTMENT OF X" pattern above programme
    let department = "";
    for (let i = programmeIndex - 1; i >= Math.max(0, programmeIndex - 6); i--) {
      const candidate = lines[i].trim();
      const deptMatch = candidate.match(/^DEPARTMENT\s+OF\s+(.+)$/i);
      if (deptMatch) {
        department = deptMatch[1].trim();
        break;
      }
    }

    // Extract semester from year line
    const semesterMatch = yearLine.match(/SEMESTER\s*([IVX]+|\d)/i);
    const semester = semesterMatch ? semesterMatch[1] : null;

    sections.push({
      department,
      programme,
      year,
      semester,
      startLine: programmeIndex,
      endLine: end,
      lines: lines.slice(programmeIndex, end),
      page: pageMap.get(lineIndex) ?? 1,
    });
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Module parsing (flexible, multi-pattern)
// ---------------------------------------------------------------------------

type ModuleParseResult = {
  courses: ExtractedCourse[];
  nextLineIndex: number;
};

/**
 * Parse a module list starting at the "MODULES" heading.
 * Tries multiple patterns and handles multi-line cells.
 */
function parseModuleList(
  lines: string[],
  startIndex: number,
  sourcePage: number
): ModuleParseResult {
  const courses: ExtractedCourse[] = [];
  let i = startIndex + 1; // skip "MODULES" heading

  while (i < lines.length) {
    const line = lines[i].trim();

    // Stop at section boundaries
    if (/^(VENUE DEFINITION|WORKSHOP\/STUDIO|CROSS-CUTTINGS|PROGRAM STUDENTS|VENUE TORELANCE)/i.test(line)) {
      break;
    }

    // Stop if we hit another YEAR header (new section)
    if (YEAR_PATTERN.test(line)) {
      break;
    }

    if (!line) {
      i++;
      continue;
    }

    // Skip known non-course headings
    if (isNonCourseHeading(line)) {
      i++;
      continue;
    }

    // Skip "DRAFT" on its own line
    if (/^DRAFT\s*$/i.test(line)) {
      i++;
      continue;
    }

    // Try Pattern A: "CODE - Name | Lecturer"
    let match = MODULE_PATTERN_A.exec(line);
    if (match) {
      const code = match[1].trim();
      const name = cleanCourseName(match[2].trim());
      const lecturer = match[3].trim() || null;
      const issues: ExtractionIssue[] = [];
      let confidence = 90;

      if (!lecturer) {
        issues.push({
          type: "missing_lecturer",
          severity: "warning",
          message: `Course ${code} has no assigned lecturer in module list.`,
          sourcePage,
          sourceLine: i + 1,
          sourceText: line,
          suggestion: "Assign a lecturer or mark as 'Not Set'.",
        });
        confidence = 70;
      }

      courses.push({ code, name, lecturer, sourcePage, sourceLine: i + 1, confidence, issues });
      i++;
      continue;
    }

    // Try Pattern B: "CODE | Name | Lecturer"
    match = MODULE_PATTERN_B.exec(line);
    if (match) {
      const code = match[1].trim();
      const name = cleanCourseName(match[2].trim());
      const lecturer = match[3].trim() || null;
      const issues: ExtractionIssue[] = [];
      let confidence = 85;

      if (!lecturer) {
        issues.push({
          type: "missing_lecturer",
          severity: "warning",
          message: `Course ${code} has no assigned lecturer in module list.`,
          sourcePage,
          sourceLine: i + 1,
          sourceText: line,
          suggestion: "Assign a lecturer or mark as 'Not Set'.",
        });
        confidence = 65;
      }

      courses.push({ code, name, lecturer, sourcePage, sourceLine: i + 1, confidence, issues });
      i++;
      continue;
    }

    // Try Pattern C: "CODE - Name" (no lecturer)
    match = MODULE_PATTERN_C.exec(line);
    if (match) {
      const code = match[1].trim();
      const name = cleanCourseName(match[2].trim());
      const issues: ExtractionIssue[] = [{
        type: "missing_lecturer",
        severity: "warning",
        message: `Course ${code} has no assigned lecturer in module list.`,
        sourcePage,
        sourceLine: i + 1,
        sourceText: line,
        suggestion: "Assign a lecturer or mark as 'Not Set'.",
      }];
      courses.push({ code, name, lecturer: null, sourcePage, sourceLine: i + 1, confidence: 75, issues });
      i++;
      continue;
    }

    // Check for multi-line continuation of previous course name
    if (courses.length > 0 && /^\s*[a-z]|\s*\|\s*$/.test(line)) {
      const last = courses[courses.length - 1];
      last.name = cleanCourseName(last.name + " " + line.trim().replace(/\|$/, "").trim());
      last.confidence = Math.max(40, last.confidence - 15);
      last.issues.push({
        type: "multi_line_cell",
        severity: "warning",
        message: `Course ${last.code} name spans multiple lines; may be incomplete.`,
        sourcePage,
        sourceLine: i + 1,
        sourceText: line,
        suggestion: "Verify the complete course name.",
      });
      i++;
      continue;
    }

    // Code on its own line with trailing hyphen, name+lecturer on next line
    // e.g. "CS 6208 -" followed by "Software Engineering | Dutu W"
    const codeWithHyphen = line.match(/^([A-Z]{2,}[A-Z0-9\-]*\s*\d{2,5})\s*[-–]\s*$/i);
    if (codeWithHyphen && i + 1 < lines.length) {
      const code = codeWithHyphen[1].trim();
      const nextLine = lines[i + 1].trim();
      if (!isNonCourseHeading(nextLine)) {
        // Parse "Name | Lecturer" from next line
        const pipeParts = nextLine.split(/\s*\|\s*/);
        const name = cleanCourseName(pipeParts[0].trim());
        const lecturer = pipeParts.length > 1 ? pipeParts[pipeParts.length - 1].trim() || null : null;
        const issues: ExtractionIssue[] = [];
        let confidence = 75;
        if (!lecturer) {
          issues.push({
            type: "missing_lecturer",
            severity: "warning",
            message: `Course ${code} has no assigned lecturer in module list.`,
            sourcePage,
            sourceLine: i + 2,
            sourceText: nextLine,
            suggestion: "Assign a lecturer or mark as 'Not Set'.",
          });
          confidence = 65;
        }
        courses.push({ code, name, lecturer, sourcePage, sourceLine: i + 1, confidence, issues });
        i += 2;
        continue;
      }
    }

    // Code on its own line, name+lecturer on next lines
    const codeOnly = extractCourseCode(line);
    if (codeOnly && i + 2 < lines.length) {
      const nextLine = lines[i + 1].trim();
      const nextNextLine = lines[i + 2].trim();
      if (!isNonCourseHeading(nextLine) && !isNonCourseHeading(nextNextLine)) {
        const issues: ExtractionIssue[] = [];
        let confidence = 80;
        let lecturer: string | null = null;
        if (isNonCourseHeading(nextNextLine) || nextNextLine === "") {
          lecturer = null;
          issues.push({
            type: "missing_lecturer",
            severity: "warning",
            message: `Course ${codeOnly} has no lecturer.`,
            sourcePage,
            sourceLine: i + 3,
            sourceText: nextNextLine,
            suggestion: "Assign a lecturer.",
          });
          confidence = 65;
        } else {
          lecturer = nextNextLine;
        }
        courses.push({
          code: codeOnly,
          name: cleanCourseName(nextLine),
          lecturer,
          sourcePage,
          sourceLine: i + 1,
          confidence,
          issues,
        });
        i += 3;
        continue;
      }
    }

    i++;
  }

  return { courses, nextLineIndex: i };
}

// ---------------------------------------------------------------------------
// Grid parsing (line-based, layout-adaptive)
// ---------------------------------------------------------------------------

/**
 * Parse a timetable grid from line-based text extracted by extractPdfText.
 *
 * The extraction fragments TJ arrays onto separate lines. The structure is:
 *
 *   "Slot/Day"          <- header start
 *   "Monday"            <- day columns, each on its own line
 *   "Tuesday"
 *   ...
 *   "07:30 - 08:15"     <- time slot
 *   "CH 8102 | CLR 2"   <- cell 1 (Monday)
 *   "HS 8102 | 209-A"   <- cell 2 (Tuesday)
 *   "CH 8104 | A-B24"   <- cell 3 (Wednesday)
 *   "10:40 - 11:25"     <- next time slot
 *   ...
 *
 * Cells appear in day order (Monday→Friday). Empty days are simply omitted
 * (no line for that cell). We assign cells to days sequentially.
 */
function parseTimetableGridLines(
  lines: string[],
  sourcePage: number
): { sessions: ExtractedSession[]; issues: ExtractionIssue[] } {
  const sessions: ExtractedSession[] = [];
  const issues: ExtractionIssue[] = [];

  // Find the header: consecutive lines starting with "Slot/Day" followed by day names
  const headerStart = lines.findIndex((l) => /slot\s*\/\s*day/i.test(l.trim()));
  if (headerStart < 0) {
    issues.push({
      type: "layout_ambiguity",
      severity: "warning",
      message: "No timetable grid header found; sessions may be missing.",
      sourcePage,
    });
    return { sessions, issues };
  }

  // Collect day names from lines after "Slot/Day"
  const dayOrder: string[] = [];
  let hi = headerStart + 1;
  while (hi < lines.length) {
    const dayKey = lines[hi].trim().toLowerCase();
    if (Object.hasOwn(DAYS, dayKey)) {
      dayOrder.push(DAYS[dayKey]);
      hi++;
    } else {
      break;
    }
  }

  if (dayOrder.length < 2) {
    issues.push({
      type: "layout_ambiguity",
      severity: "warning",
      message: "Fewer than 2 day columns detected in grid header.",
      sourcePage,
    });
    return { sessions, issues };
  }

  // Parse data lines after the header days
  let li = hi;
  while (li < lines.length) {
    const line = lines[li];
    if (!line.trim()) { li++; continue; }

    // Stop at section boundaries
    if (/^(MODULES|VENUE DEFINITION|WORKSHOP\/STUDIO|CROSS-CUTTINGS|PROGRAM STUDENTS|VENUE TORELANCE)/i.test(line.trim())) {
      break;
    }
    if (YEAR_PATTERN.test(line.trim())) break;

    // Extract time range from this line
    const timeMatch = TIME_RANGE_PATTERN.exec(line.trim());
    if (!timeMatch) { li++; continue; }

    const startTime = normalizeTime(timeMatch[1]);
    const endTime = normalizeTime(timeMatch[2]);
    if (!startTime || !endTime) { li++; continue; }

    // Collect cell lines: subsequent lines that are NOT time ranges and NOT section boundaries
    const cells: string[] = [];
    let ci = li + 1;
    while (ci < lines.length) {
      const cl = lines[ci].trim();
      if (!cl) { ci++; continue; }

      // Stop if we hit another time range
      if (TIME_RANGE_PATTERN.test(cl)) break;
      // Stop at section boundaries
      if (/^(MODULES|VENUE DEFINITION|WORKSHOP\/STUDIO|CROSS-CUTTINGS|PROGRAM STUDENTS|VENUE TORELANCE)/i.test(cl)) break;
      if (YEAR_PATTERN.test(cl)) break;
      // Stop if it looks like a header
      if (/slot\s*\/\s*day/i.test(cl)) break;

      cells.push(cl);
      ci++;
    }

    // Assign cells to days in order: cell[0] = Monday, cell[1] = Tuesday, etc.
    for (let di = 0; di < cells.length; di++) {
      const cell = cells[di].trim();
      if (!cell) continue;
      const day = di < dayOrder.length ? dayOrder[di] : null;
      if (!day) continue;

      // Parse cell: "CODE | VENUE" or "CODE | VENUE *" or just "CODE"
      const pipeParts = cell.split(/\s*\|\s*/);
      const code = pipeParts[0].trim();
      const venueRaw = pipeParts.length > 1 ? pipeParts[pipeParts.length - 1].trim() : null;

      const courseCode = extractCourseCode(code);
      if (!courseCode) continue;

      // Clean venue: remove asterisks, trailing spaces
      let venue: string | null = null;
      if (venueRaw) {
        venue = venueRaw.replace(/\*/g, "").trim();
        if (!venue || venue === "*") venue = null;
      }

      // Check for merged cell (same course continuing from previous slot on same day)
      const previous = sessions[sessions.length - 1];
      if (
        previous &&
        previous.dayOfWeek === day &&
        previous.courseCode === courseCode &&
        previous.endTime === startTime
      ) {
        previous.endTime = endTime;
        continue;
      }

      const session: ExtractedSession = {
        dayOfWeek: day,
        startTime,
        endTime,
        courseCode,
        courseName: null,
        lecturer: null,
        venue,
        sourcePage,
        sourceLine: li + 1,
        confidence: 85,
        issues: [],
      };

      if (!venue) {
        session.issues.push({
          type: "layout_ambiguity",
          severity: "warning",
          message: `Session ${courseCode} on ${day} has no venue.`,
          sourcePage,
        });
        session.confidence = Math.max(50, session.confidence - 10);
      }

      sessions.push(session);
    }

    li = ci; // continue after the collected cells
  }

  if (sessions.length === 0) {
    issues.push({
      type: "empty_grid",
      severity: "info",
      message: "No timetable sessions found in grid — timetable appears empty for this period.",
      sourcePage,
    });
  }

  return { sessions, issues };
}

// ---------------------------------------------------------------------------
// Main extraction entry point
// ---------------------------------------------------------------------------

/**
 * Extract timetable groups from a PDF using multiple robust strategies.
 * Returns a review-ready result with confidence scores and issues.
 */
export function extractTimetableGroupsRobust(
  bytes: Buffer,
  filename: string
): RobustExtractionResult {
  const text = extractPdfText(bytes);
  const rawLines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Build line -> page mapping
  const pageMap = new Map<number, number>();
  let currentPage = 1;
  for (let i = 0; i < rawLines.length; i++) {
    if (/^===== PAGE \d+ =====$/.test(rawLines[i])) {
      const match = rawLines[i].match(/PAGE (\d+)/);
      if (match) currentPage = Number(match[1]);
    }
    pageMap.set(i, currentPage);
  }

  // Detect sections
  const sections = detectSections(rawLines, pageMap);

  const groups: ExtractionGroup[] = [];
  const allIssues: ExtractionIssue[] = [];

  for (const section of sections) {
    const sectionPage = section.page;

    // Find MODULES heading within section
    const modulesIndex = section.lines.findIndex((l) => /^modules$/i.test(l.trim()));

    let courses: ExtractedCourse[] = [];
    if (modulesIndex >= 0) {
      const parsed = parseModuleList(section.lines, modulesIndex, sectionPage);
      courses = parsed.courses;
    }

    // Build code -> course map for resolving session course names/lecturers
    const courseMap = new Map<string, ExtractedCourse>();
    for (const c of courses) {
      const key = c.code;
      if (!courseMap.has(key)) {
        courseMap.set(key, c);
      } else {
        // Duplicate code — flag conflict but keep first entry
        const existing = courseMap.get(key)!;
        if (existing.name !== c.name || existing.lecturer !== c.lecturer) {
          allIssues.push({
            type: "conflict",
            severity: "warning",
            message: `Course code ${c.code} has conflicting details: "${existing.name}" (${existing.lecturer}) vs "${c.name}" (${c.lecturer}).`,
            sourcePage: sectionPage,
            sourceText: c.name,
            suggestion: "Review and keep one version, or treat as separate course variants.",
          });
        }
      }
    }

    // Parse grid using line-based approach
    const gridResult = parseTimetableGridLines(section.lines, sectionPage);
    const sessions = gridResult.sessions;
    allIssues.push(...gridResult.issues);

    // Resolve session course names and lecturers from course catalog
    for (const session of sessions) {
      const course = courseMap.get(session.courseCode);
      if (course) {
        session.courseName = course.name;
        session.lecturer = course.lecturer;
        session.confidence = Math.min(95, session.confidence + 5);
      } else {
        session.issues.push({
          type: "missing_module_entry",
          severity: "warning",
          message: `Session course ${session.courseCode} not found in module list for ${section.programme} year ${section.year}.`,
          sourcePage: sectionPage,
          suggestion: "Add course to module list or verify course code.",
        });
        session.confidence = Math.max(40, session.confidence - 20);
      }
    }

    // Calculate group confidence
    const courseConfidences = courses.map((c) => c.confidence);
    const sessionConfidences = sessions.map((s) => s.confidence);
    const allConfidences = [...courseConfidences, ...sessionConfidences];
    const groupConfidence =
      allConfidences.length > 0
        ? allConfidences.reduce((sum, c) => sum + c, 0) / allConfidences.length
        : 0;

    // Collect section issues
    const sectionIssues: ExtractionIssue[] = [];
    for (const c of courses) {
      sectionIssues.push(...c.issues);
    }
    for (const s of sessions) {
      sectionIssues.push(...s.issues);
    }

    // Check for empty grid
    const isEmpty = sessions.length === 0;
    if (isEmpty) {
      sectionIssues.push({
        type: "empty_grid",
        severity: "info",
        message: `No timetable sessions found for ${section.programme} year ${section.year}. This may be a genuinely empty timetable — verify with the department.`,
        sourcePage: sectionPage,
      });
    }

    allIssues.push(...sectionIssues);

    groups.push({
      department: section.department,
      programme: section.programme,
      year: section.year,
      semester: section.semester,
      courses,
      sessions,
      confidence: Math.round(groupConfidence),
      issues: sectionIssues,
      isEmpty,
    });
  }

  // If no sections detected, try whole-document fallback
  if (groups.length === 0) {
    const fallbackCourses: ExtractedCourse[] = [];
    const fallbackIssues: ExtractionIssue[] = [];

    const modulesIndex = rawLines.findIndex((l) => /^modules$/i.test(l));
    if (modulesIndex >= 0) {
      const parsed = parseModuleList(rawLines, modulesIndex, 1);
      fallbackCourses.push(...parsed.courses);
    }

    const gridResult = parseTimetableGridLines(rawLines, 1);
    const fallbackSessions = gridResult.sessions;
    fallbackIssues.push(...gridResult.issues);

    fallbackIssues.push({
      type: "layout_ambiguity",
      severity: "warning",
      message: "No programme/year sections detected; extracted as single group.",
      sourcePage: 1,
    });

    const isEmpty = fallbackSessions.length === 0;
    groups.push({
      department: "Unknown",
      programme: "Unknown",
      year: 1,
      semester: null,
      courses: fallbackCourses,
      sessions: fallbackSessions,
      confidence: 40,
      issues: fallbackIssues,
      isEmpty,
    });
    allIssues.push(...fallbackIssues);
  }

  // Summary statistics
  const totalCourses = groups.reduce((sum, g) => sum + g.courses.length, 0);
  const totalSessions = groups.reduce((sum, g) => sum + g.sessions.length, 0);
  const emptyGroups = groups.filter((g) => g.isEmpty).length;
  const groupsWithIssues = groups.filter((g) => g.issues.length > 0).length;
  const allConfidences = groups.map((g) => g.confidence);
  const averageConfidence =
    allConfidences.length > 0
      ? Math.round(allConfidences.reduce((sum, c) => sum + c, 0) / allConfidences.length)
      : 0;

  return {
    filename,
    totalPages: Math.max(...[...pageMap.values()], 1),
    groups,
    allIssues,
    summary: {
      totalGroups: groups.length,
      totalCourses,
      totalSessions,
      emptyGroups,
      groupsWithIssues,
      averageConfidence,
    },
  };
}
