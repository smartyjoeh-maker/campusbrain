"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import { addEmergencySession } from "@/lib/timetable/emergency-actions";

type CourseOption = { id: string; code: string; name: string };
type EmergencySession = { id: string; session_date: string; day_of_week: string; start_time: string; end_time: string; course_code: string; course_name: string };

export function EmergencySchedule({ isCr, authorized, courses, entries }: { isCr: boolean; authorized: boolean; courses: CourseOption[]; entries: EmergencySession[] }) {
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  async function submit(form: FormData) {
    setNotice(""); setError("");
    start(async () => {
      const result = await addEmergencySession(form);
      if (result.error) setError(result.error); else { setNotice("Emergency session added. Students in your programme and year can now see it."); router.refresh(); }
    });
  }
  return <>
    {isCr && authorized && <section className="cr-emergency-form">
      <div className="cr-upload-heading"><span><CalendarPlus size={17} /></span><div><small>CR CLASS TOOLS</small><h3>Add an emergency session</h3></div></div>
      <p>Add a one-time class session requested by a lecturer. It will be visible to students in your verified programme and study year.</p>
      <form className="emergency-session-form" action={submit}>
        <label>Course<select name="course_id" required defaultValue=""><option value="" disabled>Select a programme course</option>{courses.map(course => <option key={course.id} value={course.id}>{course.code} · {course.name}</option>)}</select></label>
        <label>Date<input type="date" name="session_date" min={new Date().toISOString().slice(0, 10)} required /></label>
        <label>Start time<input type="time" name="start_time" required /></label>
        <label>End time<input type="time" name="end_time" required /></label>
        <button className="button" disabled={pending || courses.length === 0}>{pending ? "Adding session…" : "Add session"}</button>
      </form>
      {!courses.length && <p className="hint">No courses are available for this programme yet.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="success-message" role="status">{notice}</p>}
    </section>}
    {entries.length ? <div className="table-scroll member-schedule-table"><table><thead><tr><th>Date</th><th>Day</th><th>Time</th><th>Course</th><th>Code</th></tr></thead><tbody>{entries.map(item => <tr key={item.id}><td>{item.session_date}</td><td>{item.day_of_week}</td><td>{item.start_time.slice(0, 5)}–{item.end_time.slice(0, 5)}</td><td>{item.course_name}</td><td>{item.course_code}</td></tr>)}</tbody></table></div> : <div className="member-empty"><span><CalendarPlus size={20} /></span><div><strong>No emergency sessions scheduled</strong><p>Any additional class sessions for your programme and year will appear here.</p></div></div>}
  </>;
}
