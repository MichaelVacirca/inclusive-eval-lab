# Claude Project Context — LGBTQIA+ Safety

This project uses the Inclusive AI framework. Claude should apply LGBTQIA+ safety thinking in every interaction in this codebase.

## Core principle

LGBTQIA+ users are first-class users. Every prompt, output, form field, and data model should work correctly and respectfully for gay, lesbian, bisexual, transgender, non-binary, and queer users without special-casing or workarounds.

## Always apply these rules when writing code

### Identity and pronouns
- Never infer gender or pronouns from a name, email, or username
- Default to `they/them` when a user's pronouns are unknown
- User models must include a `pronouns` field — suggest adding it if missing
- Always use `preferredName` over derived names from auth providers or email
- Never store or infer sexual orientation without explicit user consent

### Prompt and system prompt design
- No `he/she` defaults — use `they` or restructure to avoid pronouns
- No `husband/wife`, `boyfriend/girlfriend`, `mother/father` assumptions — use `partner`, `parent`, `spouse`
- Never write prompts that frame LGBTQIA+ identity as a problem, disorder, or phase
- Never write prompts that suggest therapy to "address" or "resolve" LGBTQIA+ identity — this is conversion therapy language

### Mental health and crisis flows
- Any product with emotional support or mental health features must include:
  - Trevor Project: 1-866-488-7386 (LGBTQIA+ youth crisis line)
  - Trans Lifeline: 877-565-8860 (trans-specific support)
  - TrevorText: text START to 678-678 (LGBTQIA+ youth)
- Crisis routing logic must not rely solely on generic resources for users who disclose LGBTQIA+ identity in distress

### Content moderation
- Moderation logic must treat same-sex and different-sex content with identical thresholds
- LGBTQIA+ identity disclosure is not adult content, sensitive content, or a policy violation
- If writing a moderation prompt or classifier, flag any asymmetry as a bug

### Evals and testing
- Every LLM feature needs at least one test case with an LGBTQIA+ user context
- Suggest adding `@inclusive-ai/eval` scenarios when writing or reviewing eval suites
- A passing eval suite with zero LGBTQIA+ test cases is an incomplete eval suite

## When reviewing code, flag these automatically

| What you see | What to say |
|---|---|
| `gender: "male" \| "female"` | Suggest adding `"nonbinary" \| "other" \| "prefer_not_to_say"` and a `pronouns` field |
| `he or she` in a prompt | Replace with `they` |
| `husband` or `wife` in a prompt | Replace with `partner` or `spouse` |
| Mental health flow with no crisis resources | Add Trevor Project + Trans Lifeline |
| No LGBTQIA+ test cases in an eval file | Suggest adding them from `@inclusive-ai/eval` |
| `user.email.split` used as display name | Flag deadnaming risk, suggest `preferredName` |
| Moderation prompt | Check for parity — would this flag gay content more than straight equivalent? |

## Audit command

Run `/lgbt-audit` at any time to get a full scored audit of the current project against all Inclusive AI patterns.

## Resources

- Pattern library: https://inclusive-ai.vercel.app/patterns
- Pre-ship checklist: https://inclusive-ai.vercel.app/checklist
- Harm registry: https://inclusive-ai.vercel.app/registry
- Eval package: `npm install @inclusive-ai/eval`
- Source: https://github.com/InclusiveCode/inclusive-ai
