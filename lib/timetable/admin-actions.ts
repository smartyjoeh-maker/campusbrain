"use server";

import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { extractTimetableGroupsRobust } from "@/lib/timetable/robust-extraction";
import type { TimetableGroup } from "@/lib/timetable-import";

export type AdminTimetablePreview = { filename: string; storagePath: string; documentId: string; groups: TimetableGroup[]; errors: string[] };

async function authorizedAdmin() {
  const auth = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!auth || !admin) return null;
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return null;
  const { data: profile, error } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return !error && profile?.role === "admin" ? { admin, user } : null;
}

function mapCourseToRow(course: { code: string; name: string; lecturer: string | null }): { code: string; name: string; lecturer_name: string } {
  return { code: course.code, name: course.name, lecturer_name: course.lecturer ?? "" };
}

/**
 * Map a session to a DB row, using the course name from the deduplicated
 * courses array (keyed by code). Sessions whose course_code doesn't exist
 * in the courses map are filtered out by the caller.
 */
function mapSessionToRow(
  session: {
    dayOfWeek: string;
    startTime: string;
    endTime: string;
    courseCode: string;
    courseName: string | null;
    lecturer: string | null;
    venue: string | null;
  },
  courseByCode: Map<string, { name: string; lecturer_name: string }>
): TimetableGroup["rows"][number] & { venue: string | null } | null {
  const course = courseByCode.get(session.courseCode);
  if (!course) return null; // session references a course not in the catalog
  return {
    day_of_week: session.dayOfWeek,
    start_time: session.startTime,
    end_time: session.endTime,
    course_code: session.courseCode,
    course_name: course.name,
    lecturer_name: course.lecturer_name,
    venue: session.venue ?? null,
  };
}

/**
 * Deduplicate courses by code, keeping the first occurrence.
 * This prevents SQL conflicts when the same course code appears with
 * different names in the source PDF (e.g. CH 8104 listed twice).
 */
function deduplicateCourses(courses: { code: string; name: string; lecturer_name: string }[]) {
  const seen = new Map<string, { code: string; name: string; lecturer_name: string }>();
  for (const c of courses) {
    if (!seen.has(c.code)) {
      seen.set(c.code, c);
    }
  }
  return [...seen.values()];
}

/**
 * Deduplicate exact duplicate sessions (same day, start_time, end_time, course_code).
 * Keeps every distinct time slot as its own row — Time column never merges.
 * Vertical merging of Course/Code/Lecturer/Venue is handled in the UI via rowspan.
 */
function deduplicateExactSessions(rows: TimetableGroup["rows"][number][]) {
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    const key = `${r.day_of_week}|${r.start_time}|${r.end_time}|${r.course_code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const dayOrder = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
  return unique.sort((a, b) => {
    const da = dayOrder.indexOf(a.day_of_week);
    const db = dayOrder.indexOf(b.day_of_week);
    if (da !== db) return da - db;
    return a.start_time.localeCompare(b.start_time);
  });
}

export async function previewAdminTimetable(form: FormData): Promise<{ error?: string; preview?: AdminTimetablePreview }> {
  const context = await authorizedAdmin();
  if (!context) return { error: "Administrator access is required to import timetables." };
  const file = form.get("file");
  if (!(file instanceof File) || file.size < 1 || file.size > 20 * 1024 * 1024 || file.type !== "application/pdf") return { error: "Choose a PDF smaller than 20 MB." };
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const filename = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160) || "timetable.pdf";

    const extraction = extractTimetableGroupsRobust(bytes, filename);

    const groups: TimetableGroup[] = extraction.groups.map((g) => {
      const courses = deduplicateCourses(g.courses.map(mapCourseToRow));
      const courseByCode = new Map(courses.map(c => [c.code, c]));
      const rows = g.sessions
        .map(s => mapSessionToRow(s, courseByCode))
        .filter((r): r is TimetableGroup["rows"][number] & { venue: string | null } => r !== null);
      return {
        programme: g.programme,
        year: g.year,
        courses,
        rows: deduplicateExactSessions(rows),
        errors: g.issues.map((i) => i.message),
      };
    });

    const allErrors = extraction.allIssues.map((i) => i.message);

    const documentId = randomUUID();
    const storagePath = `timetables/${documentId}/${filename}`;
    const { error: uploadError } = await context.admin.storage.from("registration-pdfs").upload(storagePath, bytes, { contentType: "application/pdf", upsert: false });
    if (uploadError) return { error: "The PDF could not be staged in private storage." };

    return { preview: { filename, storagePath, documentId, groups, errors: allErrors } };
  } catch {
    return { error: "The PDF could not be read. Text-based PDFs are supported; scanned PDFs require OCR." };
  }
}

export async function publishAdminTimetable(preview: AdminTimetablePreview): Promise<{ error?: string; published?: { groups: number; entries: number } }> {
  const context = await authorizedAdmin();
  if (!context) return { error: "Administrator access is required to publish timetables." };
  if (!preview || !Array.isArray(preview.groups) || preview.groups.length === 0 || !/^timetables\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/.test(preview.storagePath) || !/^[0-9a-f-]{36}$/i.test(preview.documentId)) return { error: "Review a valid timetable preview before publishing." };
  try {
    // Filter out groups with no courses (RPC requires at least one course per group)
    const validGroups = preview.groups.filter(g => g.courses && g.courses.length > 0);
    if (validGroups.length === 0) return { error: "No courses to publish." };
    const { data, error } = await context.admin.rpc("commit_admin_timetable_import", {
      p_document_id: preview.documentId,
      p_filename: preview.filename,
      p_storage_path: preview.storagePath,
      p_actor: context.user.id,
      p_groups: validGroups,
    });
    if (error || !data || typeof data !== "object") return { error: "The timetable import did not complete. No partial import was committed." };
    const result = data as { groups?: number; entries?: number };
    return { published: { groups: result.groups ?? validGroups.length, entries: result.entries ?? validGroups.reduce((sum, g) => sum + g.rows.length, 0) } };
  } catch {
    return { error: "The timetable import could not be completed. No changes were committed." };
  }
}
