"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { login } from "@/lib/auth/actions";

export function LoginForm({ admin = false }: { admin?: boolean }) {
  const [show, setShow] = useState(false); const [error, setError] = useState("");
  return <form className="form-stack" action={async (form) => { setError(""); const result = await login(form); if (result?.error) setError(result.error); }}>
    <input type="hidden" name="type" value={admin ? "admin" : "user"} />
    <div className="field"><label htmlFor="identifier">{admin ? "Administrator email" : "Registration number or phone"}</label><input id="identifier" name="identifier" autoComplete="username" required /></div>
    <div className="field"><label htmlFor="password">Password</label><div className="input-wrap"><input id="password" name="password" type={show ? "text" : "password"} autoComplete="current-password" required /><button type="button" className="icon-button" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow(!show)}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></div>
    {admin && <p className="form-meta"><Link href="/admin/forgot-password" className="inline-link">Forgot password?</Link></p>}
    {error && <p className="form-error" role="alert">{error}</p>}<button className="button full-width" type="submit">Continue →</button>
  </form>;
}
