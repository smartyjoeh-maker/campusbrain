"use client";

import { useState } from "react";
import { CalendarDays, FileUp } from "lucide-react";
import { previewAdminTimetable, publishAdminTimetable, type AdminTimetablePreview } from "@/lib/timetable/admin-actions";

const DAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/**
 * Group sessions by day so each day appears once as a header row,
 * with all sessions for that day listed underneath (sorted by time).
 * Each session keeps its own Time cell — Time never merges.
 */
function groupRowsByDay(rows: AdminTimetablePreview["groups"][0]["rows"]) {
  const map = new Map<string, AdminTimetablePreview["groups"][0]["rows"]>();
  for (const row of rows) {
    const list: AdminTimetablePreview["groups"][0]["rows"] =
      map.get(row.day_of_week) ?? [];
    list.push(row);
    map.set(row.day_of_week, list);
  }
  return DAY_ORDER.filter((d) => map.has(d)).map((day) => ({
    day,
    rows: map.get(day)!.sort((a, b) => a.start_time.localeCompare(b.start_time)),
  }));
}

/**
 * Compute vertical rowspans for a single column within a day group.
 * Consecutive rows with identical values get merged into one cell
 * spanning N rows. Subsequent rows in the merge group return 0
 * (render nothing) so the merged cell covers them.
 */
function computeRowspans<T>(rows: T[], getValue: (row: T) => string): number[] {
  const rowspans: number[] = new Array(rows.length).fill(1);
  let i = 0;
  while (i < rows.length) {
    let count = 1;
    while (i + count < rows.length && getValue(rows[i]) === getValue(rows[i + count])) {
      count++;
    }
    if (count > 1) {
      rowspans[i] = count;
      for (let j = 1; j < count; j++) {
        rowspans[i + j] = 0;
      }
      i += count;
    } else {
      i++;
    }
  }
  return rowspans;
}

export function AdminTimetableImport() {
  const [preview, setPreview] = useState<AdminTimetablePreview | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [readingPending, setReadingPending] = useState(false);
  const [publishing, setPublishing] = useState(false);

  async function read(form: FormData) {
    setError(""); setMessage(""); setPreview(null);
    setReadingPending(true);
    const result = await previewAdminTimetable(form);
    setReadingPending(false);
    if (result.error) setError(result.error); else setPreview(result.preview ?? null);
  }

  async function publish() {
    if (!preview) return;
    setError(""); setMessage("");
    setPublishing(true);
    try {
      const result = await publishAdminTimetable(preview);
      if (result.error) {
        setError("Publish failed: " + result.error);
      } else if (result.published) {
        window.alert("Publish completed: " + result.published.groups + " groups and " + result.published.entries + " sessions published.");
        setPreview(null);
      } else {
        setError("Publish failed: No response from server.");
      }
    } catch (err) {
      setError("Publish failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setPublishing(false);
    }
  }

  const sessions = preview?.groups.reduce((total, group) => total + group.rows.length, 0) ?? 0;
  const courses = preview?.groups.reduce((total, group) => total + group.courses.length, 0) ?? 0;

  return <section className="placeholder-panel admin-timetable-import">
    <div className="member-page-section-heading"><span><CalendarDays size={18} /></span><div><small>UNIVERSITY TIMETABLES</small><h2>Import department PDF</h2></div></div>
    <p className="text-gray-600 dark:text-gray-300">Upload one text-based department PDF. CampusBrain will extract every detected programme and year, including its courses, lecturer names, and venues. Review all extracted sessions before publishing; the timetable remains private in storage.</p>
    <form className="form-stack admin-upload" action={read}>
      <div className="field"><label htmlFor="admin-timetable-file">Department timetable PDF</label><input id="admin-timetable-file" name="file" type="file" accept="application/pdf,.pdf" required className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2" /></div>
      <p className="hint text-sm text-gray-500 dark:text-gray-400">Text-based PDFs are supported. Scanned documents need OCR. Any section that cannot be parsed blocks publishing so it can be corrected instead of silently omitted.</p>
      <button className="button" disabled={readingPending}><FileUp size={16} />{readingPending ? "Reading PDF…" : "Preview timetable"}</button>
    </form>
    {error && <p className="form-error text-red-600 dark:text-red-400" role="alert">{error}</p>}{message && <p className="success-message text-emerald-600 dark:text-emerald-400" role="status">{message}</p>}
    {preview && <div className="preview-box admin-timetable-preview bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-4">
      <h3 className="text-gray-800 dark:text-gray-200">Preview: {preview.filename}</h3><p className="text-gray-600 dark:text-gray-300">{preview.groups.length} groups · {courses} programme course entries · {sessions} class sessions</p>
      {preview.errors.length > 0 && <div className="cr-preview-errors mt-3"><strong className="text-red-700 dark:text-red-400">Review required ({preview.errors.length})</strong><ul className="list-disc list-inside text-sm text-red-600 dark:text-red-300">{preview.errors.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
      {preview.groups.map((group, groupIndex) => <section className="admin-timetable-group mt-4" key={`${group.programme}-${group.year}-${groupIndex}`}>
        <h4 className="text-gray-800 dark:text-gray-200">{group.programme} · Year {group.year} <span className="text-gray-500 dark:text-gray-400"> {group.courses.length} courses · {group.rows.length} sessions</span></h4>

        {/* Courses table */}
        <div className="table-scroll member-schedule-table"><table className="w-full text-sm border-collapse bg-white dark:bg-gray-800"><thead><tr className="border-b border-gray-200 dark:border-gray-700"><th className="text-left pb-2 font-semibold text-gray-600 dark:text-gray-300">Course code</th><th className="text-left pb-2 font-semibold text-gray-600 dark:text-gray-300">Course name</th><th className="text-left pb-2 font-semibold text-gray-600 dark:text-gray-300">Lecturer listed</th></tr></thead><tbody className="divide-y divide-gray-100 dark:divide-gray-700">{group.courses.map((course, index) => <tr key={`${course.code}-${index}`} className="hover:bg-gray-50 dark:hover:bg-gray-700/50"><td className="pb-2 font-mono text-gray-800 dark:text-gray-200">{course.code}</td><td className="pb-2 text-gray-800 dark:text-gray-200">{course.name}</td><td className="pb-2 text-gray-800 dark:text-gray-200">{course.lecturer_name}</td></tr>)}</tbody></table></div>

        {/* Timetable table - grouped by day, with per-column vertical merging */}
        <div className="table-scroll member-schedule-table mt-3"><table className="w-full text-sm border-collapse bg-white dark:bg-gray-800"><thead><tr className="border-b border-gray-200 dark:border-gray-700"><th className="text-left pb-2 font-semibold text-gray-600 dark:text-gray-300">Day</th><th className="text-left pb-2 font-semibold text-gray-600 dark:text-gray-300">Time</th><th className="text-left pb-2 font-semibold text-gray-600 dark:text-gray-300">Course</th><th className="text-left pb-2 font-semibold text-gray-600 dark:text-gray-300">Code</th><th className="text-left pb-2 font-semibold text-gray-600 dark:text-gray-300">Lecturer</th><th className="text-left pb-2 font-semibold text-gray-600 dark:text-gray-300">Venue</th></tr></thead><tbody className="divide-y divide-gray-100 dark:divide-gray-700">{groupRowsByDay(group.rows).map(({ day, rows: dayRows }) => {
          const courseRowspans = computeRowspans(dayRows, r => r.course_name);
          const codeRowspans = computeRowspans(dayRows, r => r.course_code);
          const lecturerRowspans = computeRowspans(dayRows, r => r.lecturer_name);
          const venueRowspans = computeRowspans(dayRows, r => r.venue ?? "");

          return (
            <>
              {/* One row per time slot — Time never merges */}
              {dayRows.map((row, rowIndex) => (
                <tr key={`${day}-${row.start_time}-${row.course_code}-${rowIndex}`} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  {/* Day cell only rendered on first row of the day group, spans all rows */}
                  {rowIndex === 0 && (
                    <td rowSpan={dayRows.length} className="pb-2 text-gray-500 dark:text-gray-400 text-xs italic font-medium">{day}</td>
                  )}
                  <td className="pb-2 font-mono text-gray-800 dark:text-gray-200">{row.start_time.slice(0, 5)}–{row.end_time.slice(0, 5)}</td>
                  {courseRowspans[rowIndex] > 0 && (
                    <td rowSpan={courseRowspans[rowIndex]} className="pb-2 text-gray-800 dark:text-gray-200">{row.course_name}</td>
                  )}
                  {codeRowspans[rowIndex] > 0 && (
                    <td rowSpan={codeRowspans[rowIndex]} className="pb-2 font-mono text-gray-800 dark:text-gray-200">{row.course_code}</td>
                  )}
                  {lecturerRowspans[rowIndex] > 0 && (
                    <td rowSpan={lecturerRowspans[rowIndex]} className="pb-2 text-gray-800 dark:text-gray-200">{row.lecturer_name}</td>
                  )}
                  {venueRowspans[rowIndex] > 0 && (
                    <td rowSpan={venueRowspans[rowIndex]} className="pb-2 font-mono text-gray-600 dark:text-gray-400">{row.venue || "—"}</td>
                  )}
                </tr>
              ))}
            </>
          );
        })}</tbody></table></div>
      </section>)}
      <button className="button mt-3" type="button" disabled={publishing || preview.groups.length === 0} onClick={publish}>{publishing ? "Publishing…" : "Publish all timetable groups"}</button>
    </div>}
  </section>;
}
