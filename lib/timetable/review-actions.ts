"use server";

import { randomUUID } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { extractTimetableGroupsRobust, type RobustExtractionResult } from "@/lib/timetable/robust-extraction";

export type ReviewItem = {
  id: string;
  document_id: string;
  source_pdf_filename: string;
  source_page: number;
  item_type: "course" | "session";
  department: string | null;
  programme: string;
  year_of_study: number;
  semester: string | null;
  course_code: string;
  course_name: string;
  lecturer_name: string | null;
  day_of_week: string | null;
  start_time: string | null;
  end_time: string | null;
  venue: string | null;
  extraction_confidence: number;
  validation_warnings: string[];
  status: "pending" | "approved" | "rejected" | "needs_review";
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
};

export type ExtractionReviewResult = {
  error?: string;
  result?: {
    documentId: string;
    filename: string;
    totalPages: number;
    summary: RobustExtractionResult["summary"];
    groups: Array<{
      department: string;
      programme: string;
      year: number;
      semester: string | null;
      courses: number;
      sessions: number;
      confidence: number;
      isEmpty: boolean;
      issues: Array<{
        type: string;
        severity: string;
        message: string;
        sourcePage: number;
      }>;
    }>;
    allIssues: Array<{
      type: string;
      severity: string;
      message: string;
      sourcePage: number;
    }>;
  };
};

async function authorizedAdmin() {
  const auth = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!auth || !admin) return null;
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return null;
  const { data: profile, error } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return !error && profile?.role === "admin" ? { admin, user } : null;
}

/**
 * Phase 2: Upload a timetable PDF, run robust extraction, and stage all
 * extracted items into the timetable_extraction_review table for admin review.
 */
export async function extractAndStageTimetable(form: FormData): Promise<ExtractionReviewResult> {
  const context = await authorizedAdmin();
  if (!context) return { error: "Administrator access is required to extract timetables." };

  const file = form.get("file");
  if (!(file instanceof File) || file.size < 1 || file.size > 20 * 1024 * 1024 || file.type !== "application/pdf") {
    return { error: "Choose a PDF smaller than 20 MB." };
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const filename = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160) || "timetable.pdf";

    // Run robust extraction
    const extraction = extractTimetableGroupsRobust(bytes, filename);

    // Stage the document
    const documentId = randomUUID();
    const storagePath = `timetables/${documentId}/${filename}`;

    const { error: uploadError } = await context.admin.storage
      .from("registration-pdfs")
      .upload(storagePath, bytes, { contentType: "application/pdf", upsert: false });

    if (uploadError) return { error: "The PDF could not be staged in private storage." };

    const { error: docError } = await context.admin
      .from("imported_documents")
      .insert({
        id: documentId,
        category: "timetable",
        filename,
        storage_path: storagePath,
        status: "uploaded",
        uploaded_by: context.user.id,
      });

    if (docError) return { error: "Could not record timetable document." };

    // Stage all extracted courses and sessions into the review table
    type ReviewItemInsert = {
      document_id: string;
      source_pdf_filename: string;
      source_page: number;
      item_type: "course" | "session";
      department: string | null;
      programme: string;
      year_of_study: number;
      semester: string | null;
      course_code: string;
      course_name: string;
      lecturer_name: string | null;
      day_of_week: string | null;
      start_time: string | null;
      end_time: string | null;
      venue: string | null;
      extraction_confidence: number;
      validation_warnings: string[];
      status: "pending" | "approved" | "rejected" | "needs_review";
    };
    const reviewItems: ReviewItemInsert[] = [];

    for (const group of extraction.groups) {
      // Stage courses
      for (const course of group.courses) {
        reviewItems.push({
          document_id: documentId,
          source_pdf_filename: filename,
          source_page: course.sourcePage,
          item_type: "course",
          department: group.department || null,
          programme: group.programme,
          year_of_study: group.year,
          semester: group.semester || null,
          course_code: course.code,
          course_name: course.name,
          lecturer_name: course.lecturer,
          day_of_week: null,
          start_time: null,
          end_time: null,
          venue: null,
          extraction_confidence: course.confidence,
          validation_warnings: course.issues.map((i) => i.message),
          status: course.issues.some((i) => i.severity === "error") ? "needs_review" : "pending",
        });
      }

      // Stage sessions
      for (const session of group.sessions) {
        reviewItems.push({
          document_id: documentId,
          source_pdf_filename: filename,
          source_page: session.sourcePage,
          item_type: "session",
          department: group.department || null,
          programme: group.programme,
          year_of_study: group.year,
          semester: group.semester || null,
          course_code: session.courseCode,
          course_name: session.courseName || "",
          lecturer_name: session.lecturer,
          day_of_week: session.dayOfWeek,
          start_time: session.startTime,
          end_time: session.endTime,
          venue: session.venue,
          extraction_confidence: session.confidence,
          validation_warnings: session.issues.map((i) => i.message),
          status: session.issues.some((i) => i.severity === "error") ? "needs_review" : "pending",
        });
      }
    }

    if (reviewItems.length > 0) {
      const { error: insertError } = await context.admin
        .from("timetable_extraction_review")
        .insert(reviewItems);

      if (insertError) return { error: "Could not stage extracted items for review." };
    }

    return {
      result: {
        documentId,
        filename,
        totalPages: extraction.totalPages,
        summary: extraction.summary,
        groups: extraction.groups.map((g) => ({
          department: g.department,
          programme: g.programme,
          year: g.year,
          semester: g.semester,
          courses: g.courses.length,
          sessions: g.sessions.length,
          confidence: g.confidence,
          isEmpty: g.isEmpty,
          issues: g.issues.map((i) => ({
            type: i.type,
            severity: i.severity,
            message: i.message,
            sourcePage: i.sourcePage,
          })),
        })),
        allIssues: extraction.allIssues.map((i) => ({
          type: i.type,
          severity: i.severity,
          message: i.message,
          sourcePage: i.sourcePage,
        })),
      },
    };
  } catch {
    return { error: "The PDF could not be processed. Text-based PDFs are supported." };
  }
}

export type GetReviewItemsResult = {
  error?: string;
  items?: ReviewItem[];
  filters?: {
    documentId: string;
    statusFilter: string;
    programmeFilter: string;
  };
};

export async function getReviewItems(
  documentId: string,
  statusFilter: string = "pending",
  programmeFilter: string = ""
): Promise<GetReviewItemsResult> {
  const context = await authorizedAdmin();
  if (!context) return { error: "Administrator access is required." };

  let query = context.admin
    .from("timetable_extraction_review")
    .select("*")
    .eq("document_id", documentId)
    .order("created_at", { ascending: true });

  if (statusFilter && statusFilter !== "all") {
    query = query.eq("status", statusFilter);
  }
  if (programmeFilter) {
    query = query.ilike("programme", `%${programmeFilter}%`);
  }

  const { data, error } = await query;
  if (error) return { error: error.message };

  return {
    items: (data ?? []).map((row) => ({
      id: row.id,
      document_id: row.document_id,
      source_pdf_filename: row.source_pdf_filename,
      source_page: row.source_page,
      item_type: row.item_type as "course" | "session",
      department: row.department,
      programme: row.programme,
      year_of_study: row.year_of_study,
      semester: row.semester,
      course_code: row.course_code,
      course_name: row.course_name,
      lecturer_name: row.lecturer_name,
      day_of_week: row.day_of_week,
      start_time: row.start_time,
      end_time: row.end_time,
      venue: row.venue,
      extraction_confidence: row.extraction_confidence,
      validation_warnings: row.validation_warnings ?? [],
      status: row.status as "pending" | "approved" | "rejected" | "needs_review",
      reviewed_by: row.reviewed_by,
      reviewed_at: row.reviewed_at,
      review_notes: row.review_notes,
      created_at: row.created_at,
    })),
    filters: { documentId, statusFilter, programmeFilter },
  };
}

export type UpdateReviewItemResult = {
  error?: string;
  updated?: ReviewItem;
};

export async function updateReviewItemStatus(
  itemId: string,
  status: "approved" | "rejected" | "needs_review" | "pending",
  reviewNotes: string | null = null
): Promise<UpdateReviewItemResult> {
  const context = await authorizedAdmin();
  if (!context) return { error: "Administrator access is required." };

  const { data, error } = await context.admin
    .from("timetable_extraction_review")
    .update({
      status,
      review_notes: reviewNotes ?? null,
      reviewed_by: context.user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .select()
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) return { error: "Review item not found." };

  return {
    updated: {
      id: data.id,
      document_id: data.document_id,
      source_pdf_filename: data.source_pdf_filename,
      source_page: data.source_page,
      item_type: data.item_type as "course" | "session",
      department: data.department,
      programme: data.programme,
      year_of_study: data.year_of_study,
      semester: data.semester,
      course_code: data.course_code,
      course_name: data.course_name,
      lecturer_name: data.lecturer_name,
      day_of_week: data.day_of_week,
      start_time: data.start_time,
      end_time: data.end_time,
      venue: data.venue,
      extraction_confidence: data.extraction_confidence,
      validation_warnings: data.validation_warnings ?? [],
      status: data.status as "pending" | "approved" | "rejected" | "needs_review",
      reviewed_by: data.reviewed_by,
      reviewed_at: data.reviewed_at,
      review_notes: data.review_notes,
      created_at: data.created_at,
    },
  };
}

export type PublishReviewResult = {
  error?: string;
  published?: {
    groups: number;
    courses: number;
    sessions: number;
  };
};

type DbReviewItem = {
  id: string;
  document_id: string;
  source_pdf_filename: string;
  source_page: number;
  item_type: string;
  department: string | null;
  programme: string;
  year_of_study: number;
  semester: string | null;
  course_code: string;
  course_name: string;
  lecturer_name: string | null;
  day_of_week: string | null;
  start_time: string | null;
  end_time: string | null;
  venue: string | null;
  extraction_confidence: number;
  validation_warnings: string[];
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
};

/**
 * Phase 4: Publish all approved review items for a document to the timetable tables.
 * Creates programmes, courses, class_timetables, and timetable_entries.
 * Rejected items are skipped. Items with status 'needs_review' block publication.
 */
export async function publishApprovedItems(documentId: string): Promise<PublishReviewResult> {
  const context = await authorizedAdmin();
  if (!context) return { error: "Administrator access is required." };

  // Fetch all review items for this document
  const { data: items, error: fetchError } = await context.admin
    .from("timetable_extraction_review")
    .select("*")
    .eq("document_id", documentId)
    .order("created_at", { ascending: true });

  if (fetchError) return { error: fetchError.message };
  if (!items || items.length === 0) return { error: "No review items found for this document." };

  const typedItems = items as DbReviewItem[];

  // Block publication if any items still need review
  const needsReview = typedItems.some((i) => i.status === "needs_review");
  if (needsReview) {
    return { error: "Some items still need review. Approve or reject them before publishing." };
  }

  const approved = typedItems.filter((i) => i.status === "approved");
  if (approved.length === 0) return { error: "No approved items to publish." };

  // Group sessions by (programme, year) to create timetables
  const sessionsByGroup = new Map<string, { programme: string; year: number; sessions: DbReviewItem[] }>();
  const coursesByGroup = new Map<string, { programme: string; year: number; courses: DbReviewItem[] }>();

  for (const item of approved) {
    const groupKey = `${item.programme.toLowerCase()}|${item.year_of_study}`;

    if (item.item_type === "course") {
      if (!coursesByGroup.has(groupKey)) {
        coursesByGroup.set(groupKey, { programme: item.programme, year: item.year_of_study, courses: [] });
      }
      coursesByGroup.get(groupKey)!.courses.push(item);
    } else if (item.item_type === "session") {
      if (!sessionsByGroup.has(groupKey)) {
        sessionsByGroup.set(groupKey, { programme: item.programme, year: item.year_of_study, sessions: [] });
      }
      sessionsByGroup.get(groupKey)!.sessions.push(item);
    }
  }

  let groupsCreated = 0;
  let coursesCreated = 0;
  let sessionsCreated = 0;

  for (const groupData of coursesByGroup.values()) {
    const { programme } = groupData;

    // Create or get programme
    const { data: progData, error: progError } = await context.admin
      .from("programmes")
      .upsert({ name: programme }, { onConflict: "name" })
      .select("id")
      .maybeSingle();

    if (progError) return { error: `Failed to create programme ${programme}: ${progError.message}` };
    if (!progData) return { error: `Failed to resolve programme ${programme}` };
    const programmeId = progData.id;

    // Create courses
    for (const course of groupData.courses) {
      const { error: courseError } = await context.admin
        .from("courses")
        .upsert(
          { code: course.course_code, name: course.course_name, programme_id: programmeId },
          { onConflict: "programme_id,code" }
        )
        .select("id")
        .maybeSingle();

      if (courseError) continue; // skip individual course failures
      coursesCreated++;
    }
  }

  // Create timetables and entries
  for (const groupData of sessionsByGroup.values()) {
    const { programme, year, sessions } = groupData;

    // Get programme ID
    const { data: progData } = await context.admin
      .from("programmes")
      .select("id")
      .eq("name", programme)
      .maybeSingle();

    if (!progData) continue;
    const programmeId = progData.id;

    // Unpublish existing timetables for this group
    await context.admin
      .from("class_timetables")
      .update({ is_published: false })
      .eq("programme_id", programmeId)
      .eq("year_of_study", year)
      .eq("is_published", true);

    // Get document info
    const { data: docData } = await context.admin
      .from("imported_documents")
      .select("filename, storage_path")
      .eq("id", documentId)
      .maybeSingle();

    // Create class timetable
    const timetableId = randomUUID();
    const { error: ttError } = await context.admin.from("class_timetables").insert({
      id: timetableId,
      programme_id: programmeId,
      year_of_study: year,
      filename: docData?.filename || "",
      storage_path: docData?.storage_path || "",
      uploaded_by: context.user.id,
      is_published: true,
      published_at: new Date().toISOString(),
    });

    if (ttError) continue;

    // Create timetable entries
    for (const session of sessions) {
      // Resolve course
      const { data: courseData } = await context.admin
        .from("courses")
        .select("id")
        .eq("programme_id", programmeId)
        .eq("code", session.course_code)
        .eq("name", session.course_name)
        .maybeSingle();

      if (!courseData) continue;

      const { error: entryError } = await context.admin.from("timetable_entries").insert({
        timetable_id: timetableId,
        course_id: courseData.id,
        lecturer_record_id: null,
        lecturer_name: session.lecturer_name || null,
        day_of_week: session.day_of_week!,
        start_time: session.start_time!,
        end_time: session.end_time!,
      });

      if (!entryError) sessionsCreated++;
    }

    groupsCreated++;
  }

  // Mark document as imported
  await context.admin
    .from("imported_documents")
    .update({ status: "imported", records_imported: sessionsCreated, completed_at: new Date().toISOString() })
    .eq("id", documentId);

  return {
    published: {
      groups: groupsCreated,
      courses: coursesCreated,
      sessions: sessionsCreated,
    },
  };
}
