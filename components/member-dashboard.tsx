import Link from "next/link";
import { EmergencySchedule } from "@/components/emergency-schedule";
import {
  BookOpen, CalendarDays, CheckCircle2, Clock3, GraduationCap, MapPinned,
  ShieldCheck, UserRound, UsersRound,
} from "lucide-react";

type Course = { code: string; name: string; programme: string | null };
type TimetableEntry = { day_of_week: string; start_time: string; end_time: string; course_code: string; course_name: string; lecturer_name: string };
type StudentRecord = {
  registration_number: string;
  full_name: string;
  year_of_study: number;
  programme: string | null;
  phone_number: string | null;
  gender: string | null;
  qualification_level: string | null;
  courses: Course[];
  crAuthorized: boolean;
};
type LecturerRecord = { full_name: string; phone_number: string; courses: Course[] };

const sections = [
  { id: "overview", label: "Overview", icon: GraduationCap },
  { id: "timetable", label: "Timetable", icon: CalendarDays },
  { id: "emergency", label: "Emergency Schedule", icon: CalendarDays },
  { id: "map", label: "Map & directions", icon: MapPinned },
  { id: "attendance", label: "Attendance", icon: CheckCircle2 },
  { id: "tests", label: "Tests", icon: BookOpen },
] as const;

export function MemberDashboard({ role, name, student, lecturer, timetable, emergencyCourses = [], emergencySchedule = [], section = "overview" }: {
  role: "student" | "cr" | "lecturer";
  name: string;
  section?: string;
  student?: StudentRecord | null;
  lecturer?: LecturerRecord | null;
  timetable?: { filename: string; entries: TimetableEntry[] } | null;
  emergencyCourses?: Array<{ id: string; code: string; name: string }>;
  emergencySchedule?: Array<{ id: string; session_date: string; day_of_week: string; start_time: string; end_time: string; course_code: string; course_name: string }>;
}) {
  if (role === "lecturer") {
    return <div className="member-dashboard">
      <header className="member-welcome"><div><p className="eyebrow">CAMPUSBRAIN / LECTURER</p><h1>Welcome back, {name.split(" ")[0]}</h1><p className="dashboard-lede">Your lecturer workspace and verified teaching assignments.</p></div><span className="member-role-badge lecturer"><BookOpen size={15} /> Lecturer</span></header>
      {!lecturer ? <EmptyState title="Lecturer record not linked" text="Your account is active, but no imported lecturer record is linked to it yet. Contact the CampusBrain administrator." /> : <>
        <section className="member-profile-card"><div className="member-avatar lecturer"><UserRound size={25} /></div><div className="member-profile-main"><span className="member-kicker">VERIFIED LECTURER PROFILE</span><h2>{lecturer.full_name}</h2><p>Phone number · {lecturer.phone_number}</p></div><span className="member-verified"><ShieldCheck size={15} /> Verified</span></section>
        <section className="member-section"><div className="member-section-heading"><div><span className="member-kicker">TEACHING</span><h2>Assigned courses</h2></div><span className="member-count">{lecturer.courses.length} courses</span></div>
          {lecturer.courses.length ? <div className="member-course-grid">{lecturer.courses.map(course => <CourseCard key={course.code} course={course} />)}</div> : <EmptyState title="No course assignments yet" text="Course assignments will appear here after they are added to your verified lecturer record." />}
        </section>
      </>}
    </div>;
  }

  const base = `/dashboard/${role}`;
  const isCr = role === "cr";
  const sectionTitle = sections.find(item => item.id === section)?.label ?? "Overview";
  return <div className="member-dashboard member-workspace">
    <header className="member-welcome"><div><p className="eyebrow">CAMPUSBRAIN / {isCr ? "CLASS REPRESENTATIVE" : "STUDENT"}</p><h1>{section === "overview" ? `Welcome back, ${name.split(" ")[0]}` : sectionTitle}</h1><p className="dashboard-lede">{section === "overview" ? "Your student workspace for learning, campus information, and updates." : memberSectionDescription(section)}</p></div><span className={`member-role-badge ${isCr ? "cr" : "student"}`}><GraduationCap size={16} /> {isCr ? "Student (CR)" : "Student"}</span></header>

    <nav className="member-workspace-nav" aria-label="Student workspace">
      {sections.map(({ id, label, icon: Icon }) => <Link key={id} href={id === "overview" ? base : `${base}?section=${id}`} className={section === id ? "active" : ""} aria-current={section === id ? "page" : undefined}><Icon size={17} /><span>{label}</span></Link>)}
    </nav>

    {section === "overview" && <>
      {student ? <>
        <section className="member-profile-card"><div className="member-avatar"><UserRound size={25} /></div><div className="member-profile-main"><span className="member-kicker">VERIFIED STUDENT PROFILE</span><h2>{student.full_name}</h2><p>{student.registration_number} <span>·</span> {student.programme ?? "Programme not available"}</p></div><span className="member-verified"><ShieldCheck size={15} /> Verified record</span></section>
        <section className="member-detail-grid" aria-label="Student record details"><Detail label="Programme" value={student.programme ?? "Not available"} icon={<BookOpen size={17} />} /><Detail label="Study year" value={`Year ${student.year_of_study}`} icon={<CalendarDays size={17} />} /><Detail label="Qualification level" value={student.qualification_level ?? "Not available"} icon={<GraduationCap size={17} />} /><Detail label="Gender" value={student.gender ?? "Not available"} icon={<UserRound size={17} />} /><Detail label="Phone number" value={student.phone_number ?? "Not available"} icon={<UserRound size={17} />} /></section>
        {isCr && <section className={`member-cr-status${student.crAuthorized ? " authorized" : ""}`}><ShieldCheck size={19} /><div><strong>{student.crAuthorized ? "Representative access active" : "Representative access pending"}</strong><p>{student.crAuthorized ? "Your administrator-approved class representative access is active." : "Your account is not currently authorized as a class representative. Contact an administrator."}</p></div></section>}
        <section className="member-section"><div className="member-section-heading"><div><span className="member-kicker">LEARNING</span><h2>Enrolled courses</h2></div><span className="member-count">{student.courses.length} courses</span></div>{student.courses.length ? <div className="member-course-grid">{student.courses.map(course => <CourseCard key={course.code} course={course} />)}</div> : <EmptyState title="No course enrolments yet" text="Your verified course enrolments will appear here when they are available." />}</section>
      </> : <EmptyState title="Student record not linked" text="Your account is active, but no imported student record is linked to it yet. Contact the CampusBrain administrator." />}
    </>}

    {section === "timetable" && <section className="member-section"><SectionHeading kicker="YOUR CLASSES" title="Class timetable" icon={<CalendarDays size={18} />} />{timetable?.entries.length ? <><p className="member-timetable-source">Published by the CampusBrain administrator: {timetable.filename}</p><div className="table-scroll member-schedule-table"><table><thead><tr><th>Day</th><th>Time</th><th>Course name</th><th>Course code</th><th>Lecturer</th></tr></thead><tbody>{timetable.entries.map((entry, index) => <tr key={`${entry.day_of_week}-${entry.start_time}-${entry.course_code}-${index}`}><td>{entry.day_of_week}</td><td>{entry.start_time.slice(0, 5)}–{entry.end_time.slice(0, 5)}</td><td>{entry.course_name}</td><td>{entry.course_code}</td><td>{entry.lecturer_name}</td></tr>)}</tbody></table></div></> : <EmptyState title="No verified timetable published" text="Your timetable will appear here when an administrator publishes a department PDF for your programme and year." />}</section>}

    {section === "emergency" && <section className="member-section"><SectionHeading kicker="ADDITIONAL CLASSES" title="Emergency Schedule" icon={<CalendarDays size={18} />} /><p className="member-timetable-source">One-time sessions for {student?.programme ?? "your programme"}, year {student?.year_of_study ?? "—"}.</p><EmergencySchedule isCr={isCr} authorized={Boolean(student?.crAuthorized)} courses={emergencyCourses} entries={emergencySchedule} /></section>}

    {section === "map" && <section className="member-section member-map-section"><SectionHeading kicker="CAMPUS NAVIGATION" title="Map & directions" icon={<MapPinned size={18} />} /><div className="member-map-notice"><MapPinned size={18} /><div><strong>Campus map is not configured yet</strong><p>Directions will be enabled when verified university map and venue data is available.</p></div></div><div className="member-map-canvas" aria-label="Campus map unavailable until verified map data is provided"><div className="member-map-grid" /><div className="member-map-empty"><MapPinned size={24} /><strong>University map</strong><span>Verified map data will appear here.</span></div></div><form className="member-map-search"><fieldset disabled><div className="member-map-fields"><label>Starting location<input type="text" placeholder="What do you see around you?" /></label><label>Destination<input type="text" placeholder="Enter a university venue name or number" /></label></div><div className="member-map-photo"><label>Or identify your location with a photo<input type="file" accept="image/*" capture="environment" /></label><small>Photo recognition is unavailable until campus map data is configured.</small></div><button className="button" type="button"><MapPinned size={16} /> Find directions</button></fieldset></form></section>}

    {section === "attendance" && <section className="member-section"><SectionHeading kicker="CLASS PARTICIPATION" title="Attendance" icon={<CheckCircle2 size={18} />} /><EmptyState title="Attendance tracking is not set up yet" text="Attendance records and period marking will appear here once your institution configures the attendance process." /></section>}

    {section === "tests" && <section className="member-section"><SectionHeading kicker="ASSESSMENTS" title="Upcoming tests" icon={<BookOpen size={18} />} /><EmptyState title="No upcoming tests published" text="Test dates and details will appear here after verified assessment information is added." />{isCr && <p className="member-cr-note"><UsersRound size={17} /> CR test information tools are not enabled yet.</p>}</section>}
  </div>;
}

function memberSectionDescription(section: string) {
  const descriptions: Record<string, string> = {
    timetable: "View your overall class schedule when it is published.",
    emergency: "See one-time sessions added for your verified study group.",
    map: "Find university venues when verified map data is available.",
    attendance: "Review class attendance when tracking is configured.",
    tests: "See upcoming assessment information when it is published.",
  };
  return descriptions[section] ?? "Your verified student information and workspace links.";
}

function SectionHeading({ kicker, title, icon }: { kicker: string; title: string; icon: React.ReactNode }) {
  return <div className="member-page-section-heading"><span>{icon}</span><div><small>{kicker}</small><h2>{title}</h2></div></div>;
}

function Detail({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return <article className="member-detail-card"><span className="member-detail-icon">{icon}</span><div><small>{label}</small><strong>{value}</strong></div></article>;
}

function CourseCard({ course }: { course: Course }) {
  return <article className="member-course-card"><span className="member-course-icon"><BookOpen size={17} /></span><div><small>{course.code}</small><h3>{course.name}</h3><p>{course.programme ?? "Programme not specified"}</p></div></article>;
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="member-empty"><span><Clock3 size={20} /></span><div><strong>{title}</strong><p>{text}</p></div></div>;
}
