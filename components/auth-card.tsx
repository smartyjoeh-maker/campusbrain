import type { ReactNode } from "react";

export function AuthCard({ eyebrow, title, description, children }: {
  eyebrow: string; title: string; description: string; children: ReactNode;
}) {
  return (
    <section className="auth-card">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="auth-description">{description}</p>
      {children}
    </section>
  );
}
