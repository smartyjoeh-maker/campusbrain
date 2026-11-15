import { Brand } from "@/components/brand";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { logout } from "@/lib/auth/actions";
import { canAccessDashboard, effectiveDashboardRole } from "@/lib/auth/policy";
import { MemberDashboard } from "@/components/member-dashboard";
import { BookOpen, CalendarDays, CheckCircle2, GraduationCap, LayoutDashboard, MapPinned, ScrollText, Upload, UsersRound } from "lucide-react";

const memberWorkspaceItems = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "timetable", label: "Timetable", icon: CalendarDays },
  { id: "emergency", label: "Emergency Schedule", icon: CalendarDays },
  { id: "map", label: "Map & directions", icon: MapPinned },
  { id: "attendance", label: "Attendance", icon: CheckCircle2 },
  { id: "tests", label: "Tests", icon: BookOpen },
];

export default async function DashboardPage({ params, searchParams }: { params: Promise<{ role: string }>; searchParams: Promise<{ section?: string }> }) {
  const { role } = await params;
  const { section: requestedSection } = await searchParams;
  const adminSections = ["overview", "imports", "timetables", "students", "lecturers", "users", "audit"];
  const memberSections = ["overview", "timetable", "emergency", "map", "attendance", "tests"];
  const allowedSections = role === "admin" ? adminSections : role === "student" || role === "cr" ? memberSections : [];
  const section = allowedSections.includes(requestedSection ?? "") ? requestedSection! : "overview";
  if (!["student", "cr", "lecturer", "admin"].includes(role)) redirect("/login");
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/login?error=configuration");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createSupabaseAdminClient();
  if (!admin) redirect("/login");
  const { data: profile } = await admin.from("profiles").select("role,display_name").eq("id", user.id).maybeSingle();
  if (!profile) redirect("/login");
  let crAuthorized = false;
  if (profile.role === "student" || profile.role === "cr") {
    const { data: studentRecord, error: recordError } = await admin.from("student_records").select("authorized_cr").eq("claimed_by", user.id).maybeSingle();
    crAuthorized = !recordError && studentRecord?.authorized_cr === true;
  }
  const dashboardRole = effectiveDashboardRole(profile.role, crAuthorized);
  if (!canAccessDashboard(dashboardRole, role)) redirect(dashboardRole === "invalid" ? "/login" : `/dashboard/${dashboardRole}`);
  return (
    <main className={`dashboard-shell${role === "admin" ? " admin-shell" : role === "student" || role === "cr" ? " member-shell" : ""}`}>
      {role === "admin" && <aside className="admin-sidebar"><Brand /><div className="admin-sidebar-label">Workspace</div><Link className={`admin-side-link${section === "overview" ? " active" : ""}`} href="/dashboard/admin"><span><LayoutDashboard size={17} /></span> Overview</Link><Link className={`admin-side-link${section === "imports" ? " active" : ""}`} href="/dashboard/admin?section=imports"><span><Upload size={17} /></span> Imports</Link><Link className={`admin-side-link${section === "timetables" ? " active" : ""}`} href="/dashboard/admin?section=timetables"><span><CalendarDays size={17} /></span> Timetables</Link><Link className={`admin-side-link${section === "students" ? " active" : ""}`} href="/dashboard/admin?section=students"><span><GraduationCap size={17} /></span> Students &amp; CRs</Link><Link className={`admin-side-link${section === "lecturers" ? " active" : ""}`} href="/dashboard/admin?section=lecturers"><span><BookOpen size={17} /></span> Lecturers</Link><Link className={`admin-side-link${section === "users" ? " active" : ""}`} href="/dashboard/admin?section=users"><span><UsersRound size={17} /></span> Users</Link><Link className={`admin-side-link${section === "audit" ? " active" : ""}`} href="/dashboard/admin?section=audit"><span><ScrollText size={17} /></span> Audit history</Link><div className="admin-sidebar-foot"><span className="admin-online-dot" /> System workspace</div></aside>}
      {(role === "student" || role === "cr") && <aside className="member-sidebar"><Brand /><div className="admin-sidebar-label">Student workspace</div>{memberWorkspaceItems.map(({ id, label, icon: Icon }) => <Link key={id} className={`admin-side-link${section === id ? " active" : ""}`} href={id === "overview" ? `/dashboard/${role}` : `/dashboard/${role}?section=${id}`}><span><Icon size={17} /></span>{label}</Link>)}<div className="admin-sidebar-foot"><span className="admin-online-dot" /> {role === "cr" ? "CR account" : "Student account"}</div></aside>}
      <div className="admin-main-column">
        <nav className={`dashboard-nav${role === "admin" ? " admin-topbar" : role === "student" || role === "cr" ? " member-topbar" : ""}`}><div className="admin-mobile-brand">{role === "admin" && <Brand />}</div><div className="member-mobile-brand">{(role === "student" || role === "cr") && <Brand />}</div>{role === "lecturer" && <Brand />}<div className="header-actions"><span className="admin-user-label">{profile.display_name}</span><form action={logout}><button className="header-login" type="submit">Log out</button></form><ThemeToggle /></div></nav>
        {role === "admin" && <nav className="admin-mobile-nav" aria-label="Administrator sections">{[["overview", "Overview", "/dashboard/admin"], ["imports", "Imports", "/dashboard/admin?section=imports"], ["timetables", "Timetables", "/dashboard/admin?section=timetables"], ["students", "Students & CRs", "/dashboard/admin?section=students"], ["lecturers", "Lecturers", "/dashboard/admin?section=lecturers"], ["users", "Users", "/dashboard/admin?section=users"], ["audit", "Audit history", "/dashboard/admin?section=audit"]].map(([key, label, href]) => <Link key={key} className={section === key ? "active" : ""} href={href}>{label}</Link>)}</nav>}
        <section className={`dashboard-body${role === "admin" ? " admin-dashboard-body" : role !== "admin" ? " member-dashboard-body" : ""}`}>{role === "admin" ? <><div className="admin-page-heading" id="overview"><div><p className="eyebrow">CAMPUSBRAIN / ADMIN</p><h1>{section === "overview" ? `Good to see you, ${profile.display_name.split(" ")[0]}` : ({ imports: "Imports", timetables: "Timetables", students: "Students & CRs", lecturers: "Lecturers", users: "User management", audit: "Audit history" } as Record<string, string>)[section]}</h1><p className="dashboard-lede">{section === "overview" ? "Your university records and account activity, all in one place." : ({ imports: "Upload, review, and import verified university records.", timetables: "Upload department timetables and publish every verified programme and year group.", students: "Review student records and manage class representative authorization.", lecturers: "Review imported lecturer records and account claims.", users: "Review accounts registered on the CampusBrain platform.", audit: "Review recent administrative and system activity." } as Record<string, string>)[section]}</p></div><div className="admin-date-chip"><span className="admin-online-dot" /> Administrator access</div></div><AdminTools data={await loadAdminData(admin)} section={section} /></> : <MemberDashboard role={dashboardRole as "student" | "cr" | "lecturer"} name={profile.display_name} section={section} {...await loadMemberData(admin, user.id, dashboardRole as "student" | "cr" | "lecturer")} />}</section>
      </div>
    </main>
  );
}

import { AdminTools } from "@/components/admin-tools";

async function loadAdminData(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>) {
  const [students, lecturers, users, imports, audits] = await Promise.all([
    admin.from("student_records").select("id,registration_number,full_name,authorized_cr,claimed_by").order("registration_number").limit(300),
    admin.from("lecturer_records").select("id,phone_number,full_name,claimed_by").order("full_name").limit(300),
    admin.from("profiles").select("id,display_name,role,identity_key").order("created_at", { ascending: false }).limit(300),
    admin.from("imported_documents").select("id,filename,category,status,records_imported,created_at").order("created_at", { ascending: false }).limit(50),
    admin.from("audit_logs").select("id,actor_id,action,subject_type,subject_id,created_at").order("created_at", { ascending: false }).limit(100),
  ]);
  return { students: students.data ?? [], lecturers: lecturers.data ?? [], users: users.data ?? [], imports: imports.data ?? [], audits: audits.data ?? [], auditError: Boolean(audits.error) };
}

async function loadMemberData(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, userId: string, role: "student" | "cr" | "lecturer") {
  if (role === "lecturer") {
    const { data: record } = await admin.from("lecturer_records").select("id,full_name,phone_number").eq("claimed_by", userId).maybeSingle();
    if (!record) return { lecturer: null };
    const { data: assignments } = await admin.from("lecturer_course_assignments").select("courses(code,name,programmes(name))").eq("lecturer_record_id", record.id);
    const courses = (assignments ?? []).flatMap((assignment) => {
      const course = Array.isArray(assignment.courses) ? assignment.courses[0] : assignment.courses;
      if (!course) return [];
      const programme = Array.isArray(course.programmes) ? course.programmes[0] : course.programmes;
      return [{ code: course.code, name: course.name, programme: programme?.name ?? null }];
    });
    return { lecturer: { ...record, courses } };
  }

  const { data: record } = await admin.from("student_records").select("id,registration_number,full_name,year_of_study,programme_id,phone_number,gender,qualification_level,authorized_cr,programmes(name)").eq("claimed_by", userId).maybeSingle();
  if (!record) return { student: null };
  const [{ data: enrolments }, { data: timetable }, { data: emergency }, { data: emergencyCourses }] = await Promise.all([
    admin.from("student_enrolments").select("courses(code,name,programmes(name))").eq("student_id", record.id),
    admin.from("class_timetables").select("filename,timetable_entries(day_of_week,start_time,end_time,lecturer_name,courses(code,name))").eq("programme_id", record.programme_id).eq("year_of_study", record.year_of_study).eq("is_published", true).maybeSingle(),
    admin.from("emergency_schedule_entries").select("id,session_date,day_of_week,start_time,end_time,courses(code,name)").eq("programme_id", record.programme_id).eq("year_of_study", record.year_of_study).gte("session_date", new Date().toISOString().slice(0,10)).order("session_date").order("start_time"),
    role === "cr" && record.authorized_cr ? admin.from("courses").select("id,code,name").eq("programme_id",record.programme_id).order("code") : Promise.resolve({data:[],error:null}),
  ]);
  const courses = (enrolments ?? []).flatMap((enrolment) => {
    const course = Array.isArray(enrolment.courses) ? enrolment.courses[0] : enrolment.courses;
    if (!course) return [];
    const programme = Array.isArray(course.programmes) ? course.programmes[0] : course.programmes;
    return [{ code: course.code, name: course.name, programme: programme?.name ?? null }];
  });
  const programme = Array.isArray(record.programmes) ? record.programmes[0] : record.programmes;
  const dayOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const timetableEntries = (timetable?.timetable_entries ?? []).flatMap((entry) => {
    const course = Array.isArray(entry.courses) ? entry.courses[0] : entry.courses;
    if (!course) return [];
    return [{ day_of_week: entry.day_of_week, start_time: entry.start_time, end_time: entry.end_time, course_code: course.code, course_name: course.name, lecturer_name: entry.lecturer_name ?? "Not listed" }];
  }).sort((a, b) => dayOrder.indexOf(a.day_of_week) - dayOrder.indexOf(b.day_of_week) || a.start_time.localeCompare(b.start_time));
  return {
    student: { ...record, programme: programme?.name ?? null, courses, crAuthorized: Boolean(record.authorized_cr) },
    timetable: timetable ? { filename: timetable.filename, entries: timetableEntries } : null,
    emergencyCourses: emergencyCourses ?? [],
    emergencySchedule: (emergency ?? []).flatMap(item => { const course = Array.isArray(item.courses) ? item.courses[0] : item.courses; return course ? [{ id: item.id, session_date: item.session_date, day_of_week: item.day_of_week, start_time: item.start_time, end_time: item.end_time, course_code: course.code, course_name: course.name }] : []; }),
  };
}
