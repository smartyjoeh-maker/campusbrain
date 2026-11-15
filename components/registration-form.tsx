"use client";

import { useState, useTransition } from "react";
import { Eye, EyeOff } from "lucide-react";
import { completeRegistration, retrieveRecord } from "@/lib/auth/actions";

export function RegistrationForm({ kind }: { kind: "student" | "cr" | "lecturer" }) {
  const [pending, start] = useTransition();
  const [details, setDetails] = useState<NonNullable<Awaited<ReturnType<typeof retrieveRecord>>["details"]> | null>(null);
  const [error, setError] = useState(""); const [show, setShow] = useState(false);
  async function retrieve(form: FormData) { setError(""); setDetails(null); form.set("kind", kind); const result = await retrieveRecord(form); if (result.error) setError(result.error); else setDetails(result.details ?? null); }
  return <form className="form-stack" action={async (form) => { setError(""); const result = await completeRegistration(form); if (result?.error) setError(result.error); }} onSubmit={(e) => {
    if (!details) { e.preventDefault(); const form = new FormData(e.currentTarget); start(() => { void retrieve(form); }); }
  }}>
    <input type="hidden" name="kind" value={kind} />
    {kind === "lecturer" ? <div className="field"><label htmlFor="phone">Phone number</label><input id="phone" name="phone" autoComplete="tel" required placeholder="Phone number on your university record" /></div> : <>
      <div className="field"><label htmlFor="registration">Registration number</label><input id="registration" name="registration" autoComplete="off" required /></div>
      <div className="field"><label htmlFor="year">Year of study</label><select id="year" name="year" defaultValue="" required><option value="" disabled>Select your year</option>{Array.from({ length: 12 }, (_, i) => i + 1).map(y => <option key={y} value={y}>Year {y}</option>)}</select></div>
    </>}
    <div className="field"><label htmlFor="lastName">Last name</label><input id="lastName" name="lastName" autoComplete="family-name" required /></div>
    {details && <div className="verified-panel" role="status"><strong>Record verified</strong><p>{details.name}</p>{details.registration && <small>{details.registration} · {details.programme}</small>}{details.gender && <small>{details.gender}{details.qualificationLevel ? ` · ${details.qualificationLevel}` : ""}</small>}{details.phone && <small>Phone ending {details.phone.slice(-3)}</small>}<input type="hidden" name="ticket" value={details.ticket} /></div>}
    {details && <>
      <div className="field"><label htmlFor="password">New password</label><div className="input-wrap"><input id="password" name="password" type={show ? "text" : "password"} autoComplete="new-password" minLength={12} required /><button type="button" className="icon-button" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow(!show)}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button></div><small className="hint">At least 12 characters with upper and lower case letters and a number.</small></div>
      <div className="field"><label htmlFor="confirm">Confirm password</label><input id="confirm" name="confirm" type={show ? "text" : "password"} autoComplete="new-password" required /></div>
    </>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {!details ? <button className="button full-width" type="submit" disabled={pending}>{pending ? "Checking records…" : "Retrieve record →"}</button> : <button className="button full-width" type="submit" disabled={pending}>{pending ? "Creating account…" : "Register"}</button>}
  </form>;
}
