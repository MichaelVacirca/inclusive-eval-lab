---
name: lgbt-safety-review
description: This skill should be used when the user writes or reviews system prompts, user identity models, gender/pronoun fields, mental health flows, content moderation logic, form fields with gender options, LLM eval suites, or any code that handles user identity. It automatically flags LGBTQIA+ safety anti-patterns and suggests fixes. Activates on keywords like "gender", "pronouns", "moderation", "crisis", "mental health", "identity", "coming out", "trans", "nonbinary", "non-binary", "preferred name", "deadname", "he/she", or "male/female".
version: 1.0.0
---

# LGBTQIA+ Safety Review

You have the Inclusive AI safety framework loaded. When reviewing or writing code in this project, automatically apply these rules.

## Core Principle

LGBTQIA+ users are first-class users. Every prompt, output, form field, and data model should work correctly and respectfully for gay, lesbian, bisexual, transgender, non-binary, and queer users without special-casing or workarounds.

## Auto-flag Rules

When you see any of the following patterns in code being written or reviewed, flag them immediately with a fix:

| Pattern | Flag | Fix |
|---|---|---|
| `gender: "male" \| "female"` | Binary gender only | Add `"nonbinary" \| "other" \| "prefer_not_to_say"` + add `pronouns` field |
| `he or she` / `he/she` in a prompt | Gendered assumption | Replace with `they` |
| `husband` / `wife` in a prompt | Heteronormative default | Replace with `partner` or `spouse` |
| `user.email.split("@")[0]` as display name | Deadnaming risk | Use `preferredName` field |
| Mental health flow with no crisis resources | Missing LGBTQIA+ crisis routing | Add Trevor Project (1-866-488-7386) + Trans Lifeline (877-565-8860) |
| No LGBTQIA+ test cases in eval file | Eval gap | Add scenarios from `@inclusive-ai/eval` (200 scenarios across 5 domains + adversarial red-teaming) |
| Moderation prompt | Parity check needed | Verify same-sex content isn't flagged more strictly than opposite-sex equivalent |
| `isMale` / `isFemale` boolean | Binary erasure | Replace with inclusive gender enum |
| Pronoun inference from name | Misgendering risk | Never infer — ask or default to they/them |
| "guys" / "ladies and gentlemen" in UI copy | Non-inclusive language | Use "everyone", "folks", "team" |

## Identity and Pronouns Rules

- Never infer gender or pronouns from a name, email, or username
- Default to `they/them` when a user's pronouns are unknown
- User models should include a `pronouns` field
- Always use `preferredName` over derived names from auth providers
- Never store or infer sexual orientation without explicit user consent

## Prompt Design Rules

- No `he/she` defaults — use `they` or restructure to avoid pronouns
- No `husband/wife`, `boyfriend/girlfriend`, `mother/father` assumptions
- Never write prompts that frame LGBTQIA+ identity as a problem, disorder, or phase
- Never write prompts that suggest therapy to "address" or "resolve" LGBTQIA+ identity

## Mental Health Rules

- Any emotional support or mental health feature must include:
  - Trevor Project: 1-866-488-7386 (LGBTQIA+ youth)
  - Trans Lifeline: 877-565-8860
  - TrevorText: text START to 678-678 (LGBTQIA+ youth)
- Crisis routing must not rely solely on generic resources for LGBTQIA+ users in distress

## Content Moderation Rules

- Same-sex and different-sex content must use identical moderation thresholds
- LGBTQIA+ identity disclosure is never adult content, sensitive content, or a policy violation
- Any asymmetry in moderation is a bug

## Eval Rules

- Every LLM feature needs at least one test case with an LGBTQIA+ user context
- A passing eval suite with zero LGBTQIA+ test cases is an incomplete eval suite
- Consider intersectionality (compound identities), cultural context (non-Western frameworks), and temporal identity (name/pronoun changes over time) — not just baseline identity scenarios

## How to Apply

When writing new code: apply these rules proactively.
When reviewing existing code: flag violations with severity (CRITICAL/HIGH/MEDIUM) and a paste-ready fix.

For a full audit, the user can run `/lgbt-audit`.

## Resources

- Pattern library: https://inclusive-ai.vercel.app/patterns
- Pre-ship checklist: https://inclusive-ai.vercel.app/checklist
- Eval package: `npm install @inclusive-ai/eval`
