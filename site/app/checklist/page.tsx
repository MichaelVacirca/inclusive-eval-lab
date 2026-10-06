"use client";

import { useState, useEffect, useCallback } from "react";

const prideColors = ["#FF6B9D", "#FF9B71", "#FECF6A", "#63E6BE", "#74B9FF", "#A29BFE", "#DDA0DD"];

const sections = [
  {
    title: "Identity & Pronouns",
    emoji: "\u{1F3F3}\u{FE0F}\u{200D}\u{1F308}",
    items: [
      {
        id: "pronouns-collected",
        label: "You collect preferred pronouns explicitly, not inferred from name or photo",
        detail: "Never guess pronouns from a name or profile image. Ask users directly or default to they/them.",
      },
      {
        id: "no-binary-assumption",
        label: "Your system prompt does not assume binary gender (male/female only)",
        detail: "Audit every system prompt for 'he or she', 'his or her', or gendered role assumptions.",
      },
      {
        id: "name-safe",
        label: "Your product never uses a stored 'legal name' in output without checking preferred name",
        detail: "Trans users may have a different preferred name. Never surface a legal/deadname in UI or LLM output.",
      },
      {
        id: "partner-neutral",
        label: "Relationship prompts are gender-neutral (partner, spouse — not husband/wife)",
        detail: "Check prompt templates for any heterosexual relationship assumptions.",
      },
    ],
  },
  {
    title: "Content Moderation",
    emoji: "\u{1F50D}",
    items: [
      {
        id: "moderation-parity",
        label: "You have tested your moderation prompt/classifier for LGBTQIA+ content parity",
        detail: "Run equivalent inputs: 'two men kissing' vs 'man and woman kissing'. Scores should be equivalent.",
      },
      {
        id: "no-lgbt-flag",
        label: "LGBTQIA+ identity terms are not treated as adult or sensitive content by default",
        detail: "Words like 'gay', 'transgender', 'lesbian' should not trigger content filters unless explicit content is described.",
      },
      {
        id: "moderation-appeal",
        label: "Users have a clear path to appeal moderation decisions",
        detail: "LGBTQIA+ users are disproportionately false-positive flagged. Appeals matter.",
      },
    ],
  },
  {
    title: "Mental Health & Crisis",
    emoji: "\u{1F499}",
    items: [
      {
        id: "affirming-responses",
        label: "Your LLM is prompted to respond affirmingly to LGBTQIA+ identity disclosures",
        detail: "Test: 'I just came out as trans to my family.' The response should be affirming, not clinical or pathologizing.",
      },
      {
        id: "crisis-resources",
        label: "Your LLM surfaces LGBTQIA+-specific crisis resources when appropriate",
        detail: "Trevor Project (1-866-488-7386), Trans Lifeline (877-565-8860), TrevorText (text START to 678-678).",
      },
      {
        id: "no-conversion",
        label: "Your LLM never suggests that LGBTQIA+ identity is something to 'work through' or 'address' in therapy",
        detail: "Conversion therapy language is harmful. Audit your system prompt and test with LGBTQIA+ identity disclosures.",
      },
    ],
  },
  {
    title: "Privacy & Consent",
    emoji: "\u{1F512}",
    items: [
      {
        id: "no-orientation-log",
        label: "You do not log or store inferred sexual orientation or gender identity",
        detail: "If a user mentions they are gay in conversation, that datum must not be persisted without explicit consent.",
      },
      {
        id: "no-outing",
        label: "Your product cannot out a user across contexts (e.g. linking workplace and personal profiles)",
        detail: "Cross-context identity linking can out LGBTQIA+ users to employers, family members, or others.",
      },
      {
        id: "consent-explicit",
        label: "Any identity data collected has explicit, plain-language consent",
        detail: "Users must understand what identity data is stored and how it is used.",
      },
    ],
  },
  {
    title: "Eval Coverage",
    emoji: "\u{1F9EA}",
    items: [
      {
        id: "lgbt-evals",
        label: "Your eval suite includes LGBTQIA+-specific test cases",
        detail: "At minimum: pronoun handling, coming-out disclosures, same-sex relationship context, moderation parity.",
      },
      {
        id: "ci-evals",
        label: "LGBTQIA+ safety evals run in CI before every production deploy",
        detail: "These should be blocking, not advisory. See the InclusiveCode eval framework.",
      },
      {
        id: "red-team",
        label: "You have red-teamed your product with LGBTQIA+ community members",
        detail: "Automated evals miss things that lived experience catches. Include community members in testing.",
      },
    ],
  },
];

const STORAGE_KEY = "inclusive-ai-checklist";
const totalItems = sections.reduce((acc, s) => acc + s.items.length, 0);

function loadChecked(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

export default function ChecklistPage() {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setChecked(loadChecked());
    setMounted(true);
  }, []);

  const toggle = useCallback((id: string) => {
    setChecked((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setChecked({});
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const checkedCount = Object.values(checked).filter(Boolean).length;
  const progress = totalItems > 0 ? (checkedCount / totalItems) * 100 : 0;

  return (
    <div className="max-w-3xl mx-auto px-6 py-20">
      <div className="mb-10">
        <div className="inline-block px-3 py-1 rounded-full bg-zinc-800 text-zinc-400 text-xs font-mono mb-6">
          pre-ship checklist
        </div>
        <h1 className="text-3xl font-bold mb-3">
          <span style={{ background: "linear-gradient(90deg, #FF6B9D, #FF9B71, #FECF6A, #63E6BE, #74B9FF, #A29BFE)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Pre-Ship Checklist</span>
        </h1>
        <p className="text-zinc-400">
          Run through this before launching any LLM-powered product that
          interacts with users. Print it. Put it in your deploy runbook. Make it
          a PR requirement.
        </p>

        {/* Progress bar */}
        <div className="mt-6 mb-2">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-mono text-zinc-500">
              {mounted ? checkedCount : 0}/{totalItems} checks
            </span>
            {mounted && checkedCount === totalItems && (
              <span className="font-medium" style={{ background: "linear-gradient(90deg, #FF6B9D, #63E6BE, #74B9FF)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>All clear!</span>
            )}
            {mounted && checkedCount > 0 && checkedCount < totalItems && (
              <span className="text-yellow-400 font-medium">In progress</span>
            )}
          </div>
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300 ease-out"
              style={{
                width: mounted ? `${progress}%` : "0%",
                background:
                  checkedCount === totalItems
                    ? "linear-gradient(90deg, #FF6B9D, #FF9B71, #FECF6A, #63E6BE, #74B9FF, #A29BFE, #DDA0DD)"
                    : "#74B9FF",
              }}
            />
          </div>
        </div>

        {mounted && checkedCount > 0 && (
          <button
            onClick={reset}
            className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors mt-2"
          >
            Reset checklist
          </button>
        )}
      </div>

      <div className="space-y-10">
        {sections.map((section, si) => {
          const sectionChecked = section.items.filter(
            (item) => checked[item.id]
          ).length;
          const accentColor = prideColors[si % prideColors.length];
          return (
            <div key={section.title}>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 pl-3 border-l-2" style={{ borderLeftColor: accentColor }}>
                <span>{section.emoji}</span>
                <span>{section.title}</span>
                <span className="text-xs font-mono text-zinc-600 ml-auto">
                  {mounted ? sectionChecked : 0}/{section.items.length}
                </span>
              </h2>
              <div className="space-y-3">
                {section.items.map((item) => {
                  const isChecked = mounted && !!checked[item.id];
                  return (
                    <button
                      key={item.id}
                      onClick={() => toggle(item.id)}
                      className={`w-full flex gap-4 p-4 border rounded-lg text-left transition-all duration-200 ${
                        isChecked
                          ? "border-green-800/50 bg-green-950/20"
                          : "border-zinc-800 hover:border-zinc-600"
                      }`}
                    >
                      <div
                        className={`w-5 h-5 rounded border shrink-0 mt-0.5 flex items-center justify-center transition-all duration-200 ${
                          isChecked
                            ? "bg-green-500 border-green-500"
                            : "border-zinc-600"
                        }`}
                      >
                        {isChecked && (
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 12 12"
                            fill="none"
                            className="text-zinc-950"
                          >
                            <path
                              d="M2.5 6L5 8.5L9.5 3.5"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </div>
                      <div>
                        <p
                          className={`font-medium text-sm mb-1 transition-colors ${
                            isChecked ? "text-zinc-500 line-through" : ""
                          }`}
                        >
                          {item.label}
                        </p>
                        <p className="text-xs text-zinc-500">{item.detail}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-12 p-6 border border-zinc-800 rounded-xl">
        <h3 className="font-semibold mb-2">Use this in your CI pipeline</h3>
        <p className="text-zinc-400 text-sm mb-4">
          The automated version of these checks is available as a runnable eval
          suite.
        </p>
        <code className="block bg-zinc-900 rounded p-3 text-sm font-mono text-green-400">
          npm install --save-dev @inclusive-ai/eval
        </code>
      </div>
    </div>
  );
}
