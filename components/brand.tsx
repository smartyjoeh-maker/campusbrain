import Link from "next/link";
import { BrainCircuit } from "lucide-react";

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link href="/" className={`brand ${light ? "brand-light" : ""}`} aria-label="CampusBrain home">
      <span className="brand-mark"><BrainCircuit size={21} strokeWidth={2.2} /></span>
      <span>campus<span className="brand-accent">brain</span></span>
    </Link>
  );
}
