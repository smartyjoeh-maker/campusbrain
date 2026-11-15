"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { extractPdfText, parseRows, type LecturerRow, type StudentRow } from "@/lib/pdf-import";

async function administrator() {
  const client = await createSupabaseServerClient(); const admin = createSupabaseAdminClient();
  if (!client || !admin) return null;
  const { data: { user } } = await client.auth.getUser(); if (!user) return null;
  const { data } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "admin" ? { admin, user } : null;
}
export type ImportPreview = { category: "student" | "lecturer"; filename: string; rows: Array<StudentRow | LecturerRow>; errors: string[]; duplicates: string[]; path: string };
export async function previewPdf(form: FormData): Promise<{ error?: string; preview?: ImportPreview }> {
  const actor = await administrator(); if (!actor) return { error: "Administrator access required." };
  const file = form.get("file"); const category = String(form.get("category")) as "student" | "lecturer";
  if (!(file instanceof File) || file.size < 1 || file.size > 20 * 1024 * 1024 || file.type !== "application/pdf" || !["student", "lecturer"].includes(category)) return { error: "Choose a PDF file smaller than 20 MB and a valid category." };
  try {
    const bytes = Buffer.from(await file.arrayBuffer()); const text = extractPdfText(bytes); const parsed = parseRows(text, category);
    if (!text) return { error: "No extractable text found. This PDF may be scanned; OCR support is not configured." };
    const path = `previews/${crypto.randomUUID()}/${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error: uploadError } = await actor.admin.storage.from("registration-pdfs").upload(path, bytes, { contentType: "application/pdf", upsert: false });
    if (uploadError) return { error: "Could not securely stage the PDF for review." };
    const seen = new Set<string>(); const duplicates: string[] = [];
    const keys = parsed.rows.map(r => category === "student" ? (r as StudentRow).registration_number : (r as LecturerRow).phone_number);
    keys.forEach(key => { if (seen.has(key)) duplicates.push(`Repeated within PDF: ${key}`); seen.add(key); });
    const column = category === "student" ? "registration_number" : "phone_number";
    const { data: existing, error: duplicateQueryError } = keys.length
      ? await actor.admin.from(category === "student" ? "student_records" : "lecturer_records").select(column).in(column, keys)
      : { data: [], error: null };
    if (duplicateQueryError) return { error: "Could not check for existing records. Try previewing the PDF again." };
    existing?.forEach((entry: Record<string, string>) => duplicates.push(`Already imported: ${entry[column]}`));
    return { preview: { category, filename: file.name, rows: parsed.rows, errors: parsed.errors, duplicates, path } };
  } catch (e) { return { error: e instanceof Error ? e.message : "Unable to read this PDF." }; }
}
export async function importReviewed(preview: ImportPreview): Promise<{ error?: string; imported?: number; rejected?: number }> {
  const actor = await administrator(); if (!actor) return { error: "Administrator access required." };
  if (!preview || !["student", "lecturer"].includes(preview.category) || !Array.isArray(preview.rows) || preview.rows.length > 10000 || typeof preview.path !== "string" || !preview.path.startsWith("previews/")) return { error: "Invalid import preview." };
  const { data: downloaded, error: downloadError } = await actor.admin.storage.from("registration-pdfs").download(preview.path);
  if (downloadError || !downloaded) return { error: "The staged source PDF has expired or is unavailable." };
  const bytes = Buffer.from(await downloaded.arrayBuffer());
  if (bytes.length > 20 * 1024 * 1024 || !bytes.toString("latin1").startsWith("%PDF-")) return { error: "The source PDF is invalid." };
  const parsed = parseRows(extractPdfText(bytes), preview.category);
  if (parsed.rows.length !== preview.rows.length || JSON.stringify(parsed.rows) !== JSON.stringify(preview.rows)) return { error: "The preview changed. Upload the PDF again." };
  const column = preview.category === "student" ? "registration_number" : "phone_number";
  const keys = parsed.rows.map(row => preview.category === "student" ? (row as StudentRow).registration_number : (row as LecturerRow).phone_number);
  const existingQuery = keys.length
    ? await actor.admin.from(preview.category === "student" ? "student_records" : "lecturer_records").select(column).in(column, keys)
    : { data: [], error: null };
  if (existingQuery.error) return { error: "Could not recheck duplicate records. Try again." };
  const existing = new Set((existingQuery.data ?? []).map((row: Record<string, string>) => row[column]));
  const seen = new Set<string>(); const importRows: Array<StudentRow | LecturerRow> = [];
  for (const [index, row] of parsed.rows.entries()) {
    const key = keys[index];
    if (seen.has(key) || existing.has(key)) continue;
    seen.add(key); importRows.push(row);
  }
  const rejected = parsed.errors.length + parsed.rows.length - importRows.length;
  const fileId = crypto.randomUUID();
  const { data, error: importError } = await actor.admin.rpc("commit_enriched_registration_import", {
    p_document_id: fileId,
    p_category: preview.category,
    p_filename: preview.filename,
    p_storage_path: preview.path,
    p_actor: actor.user.id,
    p_rows: importRows,
    p_rejected: rejected,
  });
  if (importError || !data || typeof data !== "object") {
    await actor.admin.storage.from("registration-pdfs").remove([preview.path]);
    return { error: "The import was rolled back. Check the reviewed rows and try again." };
  }
  const result = data as { imported?: number; rejected?: number };
  return { imported: result.imported ?? 0, rejected: result.rejected ?? rejected };
}

export async function setCrAuthorization(recordId: string, authorized: boolean): Promise<{ error?: string }> {
  const actor = await administrator(); if (!actor) return { error: "Administrator access required." };
  if (!/^[0-9a-f-]{36}$/i.test(recordId)) return { error: "Invalid record." };
  const { data, error } = await actor.admin.rpc("admin_set_cr_authorization", { p_record: recordId, p_authorized: authorized, p_actor: actor.user.id });
  if (error || data !== true) return { error: "CR authorization could not be changed. No changes were committed." };
  return {};
}

export async function removeUnclaimedRecord(category: "student" | "lecturer", recordId: string): Promise<{ error?: string }> {
  const actor = await administrator(); if (!actor) return { error: "Administrator access required." };
  if (!["student", "lecturer"].includes(category) || !/^[0-9a-f-]{36}$/i.test(recordId)) return { error: "Invalid record." };
  const { data, error } = await actor.admin.rpc("admin_remove_unclaimed_record", { p_category: category, p_record: recordId, p_actor: actor.user.id });
  if (error || data !== true) return { error: "Record could not be removed. It may already be claimed. No changes were committed." };
  return {};
}
