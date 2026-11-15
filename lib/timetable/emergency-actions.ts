"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function activeCr() {
  const auth = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!auth || !admin) return null;
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return null;
  const [{ data: profile }, { data: student }] = await Promise.all([
    admin.from("profiles").select("role").eq("id", user.id).maybeSingle(),
    admin.from("student_records").select("id,programme_id,year_of_study,authorized_cr").eq("claimed_by", user.id).maybeSingle(),
  ]);
  if (!student?.authorized_cr || !profile || !["student", "cr"].includes(profile.role)) return null;
  return { admin, user, student };
}

export async function addEmergencySession(form: FormData): Promise<{ error?: string }> {
  const context = await activeCr();
  if (!context) return { error: "An active administrator-authorized CR account is required." };
  const courseId = String(form.get("course_id") ?? "");
  const sessionDate = String(form.get("session_date") ?? "");
  const startTime = String(form.get("start_time") ?? "");
  const endTime = String(form.get("end_time") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(courseId) || !/^\d{4}-\d{2}-\d{2}$/.test(sessionDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime) || endTime <= startTime) {
    return { error: "Choose a course, a valid future date, and a valid time range." };
  }
  const { error } = await context.admin.rpc("commit_cr_emergency_session", {
    p_actor: context.user.id,
    p_course_id: courseId,
    p_session_date: sessionDate,
    p_start: startTime,
    p_end: endTime,
  });
  return error ? { error: "The emergency session was not added. Check the date and selected course." } : {};
}
