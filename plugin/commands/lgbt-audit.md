---
description: Run a full LGBTQIA+ safety audit on the current project — scans prompts, code, data models, and evals for anti-patterns that harm LGBTQIA+ users
argument-hint: [file-or-directory]
allowed-tools: [Read, Glob, Grep, Bash, Agent]
---

# LGBTQIA+ Safety Audit

You are performing an LGBTQIA+ safety audit for an LLM engineer. Your job is to review their code, system prompts, and product decisions for patterns that could harm LGBTQIA+ users, and provide concrete, actionable fixes.

## Scope

If the user provided arguments: `$ARGUMENTS` — audit only those files/directories.
Otherwise, scan the entire current project.

## What to audit

Scan for:
- System prompts (`system`, `systemPrompt`, `role: "system"`, or equivalent)
- Prompt templates and any string that gets sent to an LLM
- User identity models (how gender, pronouns, name, orientation are stored or inferred)
- Output processing (filtering, classification, moderation logic)
- Mental health or crisis flows
- Form fields and UI copy
- Eval/test suites (check for missing LGBTQIA+ coverage)

## Anti-patterns — check for all of these

### CRITICAL (must fix before ship)

**Binary gender assumption**
- Look for: `gender: "male" | "female"`, `he/she` hardcoded in prompts, M/F-only dropdowns, `isMale` boolean fields
- Harm: erases non-binary users, misgenders trans users in every interaction

**Pronoun inference from name**
- Look for: code or prompts that use a user's name to determine `he`/`she`
- Harm: deadnames and misgenders trans users silently and at scale

**Non-affirming mental health language**
- Look for: prompts containing "address your feelings about", "explore the root cause of", "work through your identity", "help you resolve" in LGBTQIA+ contexts
- Harm: this is conversion therapy language embedded in AI products

**Missing LGBTQIA+ crisis resources**
- Look for: any mental health, companion AI, or crisis flow that routes to generic resources but not:
  - Trevor Project: 1-866-488-7386 (LGBTQIA+ youth)
  - Trans Lifeline: 877-565-8860
  - TrevorText: text START to 678-678 (LGBTQIA+ youth)
- Harm: LGBTQIA+ youth in crisis have meaningfully higher suicide risk; generic resources are not sufficient

**Outing risk**
- Look for: storing or logging inferred gender/orientation, cross-context identity linkage without explicit consent, analytics that expose sexuality
- Harm: can physically endanger users in hostile environments

**Content moderation parity gap**
- Look for: moderation prompts or classifiers that would flag "two men kissing" but not "a man and woman kissing"
- Harm: disproportionately censors LGBTQIA+ expression and creators

### HIGH (fix before ship)

**Heteronormative defaults**
- Look for: relationship prompts that assume `boyfriend/girlfriend`, `husband/wife`; family prompts that assume mother/father; "your wife/husband" in assistant replies
- Harm: consistently signals to LGBTQIA+ users they are not the expected user

**Preferred name not respected**
- Look for: code using `user.email.split("@")[0]`, `username`, or `firstName` from an auth provider instead of a stored `preferredName`
- Harm: deadnames trans users who have updated their preferred name

**Binary-only form fields**
- Look for: gender selects with only Male/Female, no pronouns field in user profile schema
- Harm: forces trans and nonbinary users to misgender themselves to use the product

**Gendered AI persona with no opt-out**
- Look for: system prompts that lock the AI into a gendered name/identity without a user preference mechanism
- Harm: excludes users who are uncomfortable with gendered AI

### MEDIUM (address in next sprint)

**No pronouns in user model**
- Look for: user schema with no `pronouns` or `preferredPronouns` field
- Harm: makes respectful personalization impossible

**No LGBTQIA+ scenarios in evals**
- Look for: eval/test files — if none of the test cases involve LGBTQIA+ users, identity, or relationships, flag it
- Harm: silent regressions in exactly the cases that matter most

**Biased RAG or context documents**
- Look for: uploaded docs, knowledge bases, or context strings that frame LGBTQIA+ identity as a disorder, lifestyle choice, or moral issue
- Harm: poisons all responses for users of the product

**Non-inclusive UI copy**
- Look for: "guys", "ladies and gentlemen", "he or she", gendered greetings in any user-facing string
- Harm: low-grade but consistent exclusion signal

---

### HEALTHCARE APPS — additional checks (critical)

**Gender marker anatomy inference**
- Look for: clinical logic that uses `patient.gender === "M"/"F"` to determine screenings, treatments, or dosages
- Harm: trans patients miss cancer screenings; trans men with cervixes don't get pap smear recommendations

**Transition care deprioritization**
- Look for: triage or scheduling prompts with no affirming instructions; gender-affirming care requests classified as non-urgent
- Harm: creates barriers to medically necessary care for trans patients

**Pathologizing identity in mental health screening**
- Look for: intake prompts that flag LGBTQIA+ identity as a "risk factor"; prompts that suggest exploring "root causes" of identity
- Harm: conversion therapy language in clinical AI; patients disengage from care

**Transition history exposure**
- Look for: patient summaries that include deadname, former gender, or transition notes by default
- Harm: violates patient privacy; can cause discrimination in clinical settings

**Non-affirming provider routing**
- Look for: provider matching that uses only specialty and distance, with no `lgbtAffirming` criterion
- Harm: routes vulnerable patients to potentially discriminatory providers

**Binary-only medical intake**
- Look for: medical forms with only Male/Female options; no separation of legal sex from gender identity
- Harm: non-binary patients cannot accurately register; clinical care uses wrong identity data

---

### EMPLOYMENT/HR APPS — additional checks (critical/high)

**Employment gap penalization**
- Look for: resume scoring that automatically deducts for gaps without context
- Harm: disproportionately harms LGBTQIA+ candidates who had gaps due to discrimination or transition

**Identity-fishing interview questions**
- Look for: AI-generated interview questions about "personal history", "personal values", "life experiences" without guardrails
- Harm: elicits protected characteristic information that can be used to discriminate

**LGBTQIA+ organization penalization**
- Look for: culture fit scoring that includes organizational involvement; AI scoring extracurriculars without protected-characteristic guardrails
- Harm: candidates listing LGBTQIA+ organizations are scored down; this is discrimination

**Gendered presentation bias in video interviews**
- Look for: video interview AI that scores "professional presentation" or "appearance"
- Harm: trans and non-binary candidates penalized for gender-non-conforming presentation

**Same-sex benefit exclusion**
- Look for: HR chatbot prompts that use "husband/wife", "maternity/paternity for mother/father", gendered fertility coverage language
- Harm: same-sex couples receive incorrect or missing benefit guidance

**Culture fit as identity proxy**
- Look for: performance review AI that scores "culture fit"; unguarded manager feedback fed to AI
- Harm: culture fit ratings encode and amplify bias against LGBTQIA+ employees

## Report format

For each issue found, output:

```
[SEVERITY] <file>:<line or function name>
Pattern: <anti-pattern name from above>
Found:
  <exact code or prompt snippet>
Why this harms LGBTQIA+ users:
  <one sentence>
Fix:
  <corrected code, prompt, or schema — paste-ready>
Regression test:
  Input:    "<test prompt>"
  Should:   "<what a passing response looks like>"
  Should not: "<what a failing response looks like>"
```

## Scorecard (always end with this)

```
=== LGBTQIA+ Safety Audit: <project name> ===

CRITICAL:  X issues
HIGH:      X issues
MEDIUM:    X issues

Verdict: PASS | NEEDS WORK | FAIL

Top 3 fixes to ship first:
1. ...
2. ...
3. ...

Eval coverage gaps:
- Missing: ...
- Add these test IDs from @inclusive-ai/eval (115 scenarios across 3 domains): ...

Resources:
- Pattern library:    https://inclusive-ai.vercel.app/patterns
- Pre-ship checklist: https://inclusive-ai.vercel.app/checklist
- Eval suite:         npm install @inclusive-ai/eval
```

## Rules

- Do not flag content that is merely *about* LGBTQIA+ topics — presence of LGBTQIA+ content is not a problem
- Do not suggest removing or toning down LGBTQIA+-affirming responses — affirming is correct
- Do not treat LGBTQIA+ identity as inherently sensitive, adult, or controversial content
- Do not suggest "balance" between affirming and anti-LGBTQIA+ perspectives — there is no valid anti-LGBTQIA+ perspective to balance against
- Be technical and direct. Engineers need paste-ready fixes, not lectures.

## Start

Scan the project now. Prioritize in this order: system prompts, user identity model, mental health flows, output processing, form fields, eval coverage.
