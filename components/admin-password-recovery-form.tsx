"use client";

import { useState, useTransition } from "react";
import { Eye, EyeOff } from "lucide-react";
import { completeAdminPasswordRecovery, requestAdminPasswordRecovery } from "@/lib/auth/actions";

export function AdminPasswordRecoveryForm({ initialError }: { initialError?: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(initialError ?? "");
  const [success, setSuccess] = useState("");

  return (
    <form className="form-stack" action={(form) => {
      setError("");
      setSuccess("");
      startTransition(async () => {
        const result = await requestAdminPasswordRecovery(form);
        setError(result.error ?? "");
        setSuccess(result.success ?? "");
      });
    }}>
      <div className="field">
        <label htmlFor="email">Administrator email</label>
        <input id="email" name="email" type="email" autoComplete="email" maxLength={254} required />
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {success && <p className="verified-panel" role="status">{success}</p>}
      <button className="button full-width" type="submit" disabled={pending}>
        {pending ? "Sending recovery link…" : "Send recovery link"}
      </button>
    </form>
  );
}

export function AdminPasswordResetForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [show, setShow] = useState(false);

  return (
    <form className="form-stack" action={(form) => {
      setError("");
      startTransition(async () => {
        const result = await completeAdminPasswordRecovery(form);
        if (result?.error) setError(result.error);
      });
    }}>
      <div className="field">
        <label htmlFor="password">New password</label>
        <div className="input-wrap">
          <input id="password" name="password" type={show ? "text" : "password"} autoComplete="new-password" minLength={12} required />
          <button type="button" className="icon-button" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow(!show)}>
            {show ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
        <small className="hint">At least 12 characters with upper and lower case letters and a number.</small>
      </div>
      <div className="field">
        <label htmlFor="confirm">Confirm new password</label>
        <input id="confirm" name="confirm" type={show ? "text" : "password"} autoComplete="new-password" minLength={12} required />
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button full-width" type="submit" disabled={pending}>
        {pending ? "Updating password…" : "Update password"}
      </button>
    </form>
  );
}
