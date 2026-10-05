"use client";

import { useState } from "react";
import Link from "next/link";

const links = [
  { href: "/patterns", label: "Patterns" },
  { href: "/checklist", label: "Checklist" },
  { href: "/registry", label: "Registry" },
  { href: "/research", label: "Research" },
  { href: "/tools", label: "Tools" },
  { href: "/lab", label: "Lab" },
];

export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <div className="sm:hidden">
      <button
        onClick={() => setOpen(!open)}
        className="p-2 text-zinc-400 hover:text-zinc-100 transition-colors"
        aria-label={open ? "Close menu" : "Open menu"}
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 4l12 12M16 4L4 16" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 5h14M3 10h14M3 15h14" />
          </svg>
        )}
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 bg-zinc-950 border-b border-zinc-800 px-6 py-4 flex flex-col gap-4 text-sm text-zinc-400">
          {links.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="hover:text-zinc-100 transition-colors">
              {l.label}
            </Link>
          ))}
          <a href="https://github.com/InclusiveCode" target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} className="hover:text-zinc-100 transition-colors">
            GitHub
          </a>
        </div>
      )}
    </div>
  );
}
