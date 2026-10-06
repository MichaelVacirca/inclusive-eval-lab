# LGBTQIA+ Safety Anti-Patterns Reference

## Critical Severity

### 1. Binary Gender Assumption
**Code patterns:** `gender: "male" | "female"`, `isMale: boolean`, M/F-only radio/select, `he/she` in prompts
**Harm:** Erases non-binary users. Misgenders trans users in every single interaction.
**Fix:** Use inclusive enum (`male | female | nonbinary | other | prefer_not_to_say`). Add separate `pronouns` field. Use `they` in prompts.

### 2. Pronoun Inference from Name
**Code patterns:** Name-to-gender lookup, `inferGender(name)`, "Jennifer → she", "Michael → he"
**Harm:** Deadnames and misgenders trans users silently at scale. A name does not determine pronouns.
**Fix:** Never infer. Ask explicitly or default to they/them.

### 3. Non-Affirming Mental Health Language
**Code patterns:** "explore the root cause of your identity", "address your feelings about being gay", "work through your gender confusion", "help you resolve"
**Harm:** This is conversion therapy language. Treating LGBTQIA+ identity as something to "resolve" causes measurable psychological harm.
**Fix:** Use affirming language: "your identity is valid", "you're not alone", provide affirming resources.

### 4. Missing LGBTQIA+ Crisis Resources
**Code patterns:** Crisis/mental-health flow that only provides generic hotlines (988, generic crisis text)
**Harm:** LGBTQIA+ youth have 4x higher suicide attempt rates. Generic crisis lines may not be affirming or safe.
**Fix:** Always include: Trevor Project (1-866-488-7386), Trans Lifeline (877-565-8860), TrevorText (text START to 678-678).

### 5. Outing Risk
**Code patterns:** Logging inferred orientation, cross-context identity linkage, analytics that expose sexuality, sharing gender identity with third parties without consent
**Harm:** Can physically endanger users in hostile family, workplace, or legal environments.
**Fix:** Never store inferred identity. Require explicit consent. Treat orientation/gender as PII with highest protection.

### 6. Content Moderation Parity Gap
**Code patterns:** Moderation prompts or classifiers where "two men kissing" → flagged but "man and woman kissing" → allowed
**Harm:** Systematically censors LGBTQIA+ expression and creators.
**Fix:** Test every moderation rule with same-sex and different-sex variants. Flag any asymmetry as a bug.

## High Severity

### 7. Heteronormative Defaults
**Code patterns:** "your wife/husband", "boyfriend/girlfriend" assumptions, "mother/father" in family contexts
**Harm:** Consistently signals to LGBTQIA+ users they're not the expected user.
**Fix:** Use "partner", "spouse", "parent", "significant other". Let users specify.

### 8. Preferred Name Not Respected
**Code patterns:** `user.email.split("@")[0]`, using auth provider `firstName` without checking `preferredName`
**Harm:** Deadnames trans users who have changed their name.
**Fix:** Always check for `preferredName` or `displayName` first.

### 9. Binary-Only Form Fields
**Code patterns:** Gender select with only "Male"/"Female", no pronouns field in user schema
**Harm:** Forces trans and nonbinary users to misgender themselves to use the product.
**Fix:** Add nonbinary/other/prefer-not-to-say options. Add optional pronouns field.

### 10. Gendered AI Persona with No Opt-Out
**Code patterns:** System prompt locks AI into "Sophia", "she/her" with no user override
**Harm:** Excludes users uncomfortable with gendered AI.
**Fix:** Allow persona preference or use gender-neutral default.

## Medium Severity

### 11. No Pronouns in User Model
**Code patterns:** User schema with no `pronouns` field
**Fix:** Add optional `pronouns: string` field (e.g., "they/them", "she/her", "he/him", custom).

### 12. No LGBTQIA+ Scenarios in Evals
**Code patterns:** Eval/test suite with zero LGBTQIA+ user contexts
**Fix:** Add scenarios from `@inclusive-ai/eval`: identity, mental-health, moderation, system-prompt, output-safety, privacy, intersectionality, cultural-context, temporal-identity categories (115 scenarios total across 3 domains).

### 13. Biased RAG/Context Documents
**Code patterns:** Knowledge base docs that frame LGBTQIA+ identity as disorder, lifestyle choice, or moral issue
**Fix:** Audit all RAG sources. Remove or replace biased documents.

### 14. Non-Inclusive UI Copy
**Code patterns:** "guys", "ladies and gentlemen", "he or she", gendered greetings
**Fix:** Use "everyone", "folks", "team", "they".

---

## Healthcare Domain Anti-Patterns

### 15. Gender Marker Anatomy Inference
**Code patterns:** Using `patient.gender === "F"` to determine screenings; anatomy inferred from gender field
**Harm:** Trans patients miss critical cancer screenings. Trans men with cervixes don't get pap smear recommendations.
**Fix:** Store anatomical inventory separately (`hasCervix`, `hasProstate`, etc.). Drive clinical recommendations from anatomy, not gender marker.

### 16. Transition Care Deprioritization
**Code patterns:** Triage prompts with no affirming instructions; HRT/transition surgery requests routed as "non-urgent" or "discuss with PCP first"
**Harm:** Creates barriers to already-hard-to-access transition care. Gender dysphoria is a recognized medical condition; its treatment is medically necessary.
**Fix:** Explicitly classify gender-affirming care as medically necessary. Route to affirming providers.

### 17. Pathologizing Identity in Mental Health Screening
**Code patterns:** Intake prompts that flag LGBTQIA+ identity as a "risk factor"; prompts that conflate minority stress with identity being problematic
**Harm:** Mirrors discredited conversion therapy frameworks. Causes patients to disengage from care.
**Fix:** Assess minority stress (discrimination, rejection) separately from identity. Never treat identity itself as a clinical concern.

### 18. Transition History Exposure
**Code patterns:** Patient summaries that include deadname, former gender, or transition history by default; `patient.formerGender` shown in all summaries
**Harm:** Violates patient privacy. Can lead to discrimination in care. Trans patients already avoid healthcare due to fear of exposure.
**Fix:** Default to preferred name and current gender only. Include transition history only when clinically indicated, with explicit justification.

### 19. Non-Affirming Provider Routing
**Code patterns:** Provider matching by specialty and distance only; no `lgbtAffirming` criterion; no trans-competent care filter
**Harm:** Routes trans and LGBTQIA+ patients to potentially discriminatory providers.
**Fix:** Add LGBTQIA+-affirming status as a matching criterion. Prioritize affirming providers for patients who indicate preference.

### 20. Same-Sex Fertility Exclusion
**Code patterns:** Fertility intake with "husband/wife" fields; forms that assume heterosexual couple; sperm analysis fields that assume male partner
**Harm:** Same-sex couples and trans patients excluded or forced to misrepresent themselves.
**Fix:** Use partner-neutral language. Collect biological information based on what patients report, not assumed roles.

### 21. Binary-Only Medical Intake
**Code patterns:** Gender field with only Male/Female options in medical registration; no separation of legal sex from gender identity; no pronouns field
**Harm:** Non-binary patients cannot accurately register. Trans patients must use incorrect legal sex for clinical care.
**Fix:** Separate legal sex (for insurance) from gender identity (for care). Add expanded options and pronouns field.

### 22. Missing Minority Stress Model
**Code patterns:** Mental health assessments that treat depression/anxiety as individual pathology without assessing social context for LGBTQIA+ patients
**Harm:** Leads to treatment plans that miss root causes. May result in inappropriate medication rather than community support.
**Fix:** Assess minority stress factors (discrimination, family rejection, community support) when clinically relevant.

### 23. Screening Name/Gender Inference
**Code patterns:** `inferGender(patient.legalName.split(" ")[0])` to generate salutations; "Mr./Ms." based on name
**Harm:** Misgenders trans patients in every healthcare communication. May expose trans status unexpectedly.
**Fix:** Always use `preferredName`. Never use gendered salutations based on name inference.

---

## Employment Domain Anti-Patterns

### 24. Employment Gap Penalization
**Code patterns:** Resume scoring that automatically deducts points for gaps > 3/6/12 months without context
**Harm:** Disproportionately harms LGBTQIA+ candidates who had gaps due to discrimination, transition, or minority stress-related health issues.
**Fix:** Remove automated gap penalization. Surface gaps for human review with candidate context.

### 25. Identity-Fishing Interview Questions
**Code patterns:** AI-generated interview questions about "personal history", "personal values", "life experiences" without filtering for protected characteristics
**Harm:** Can elicit sexual orientation or gender identity information that is then used (consciously or not) to discriminate.
**Fix:** Focus strictly on job-relevant competencies. Explicitly filter questions that could elicit protected characteristic information.

### 26. LGBTQIA+ Organization Penalization
**Code patterns:** "Culture fit" scoring that includes organizational involvement; AI prompts that score extracurriculars without protected-characteristic guardrails
**Harm:** Candidates listing LGBTQIA+ organizations, ERGs, or advocacy are scored down. This is discrimination, and may be illegal.
**Fix:** Remove culture fit scoring from AI entirely. Assess only job-relevant qualifications.

### 27. Gendered Presentation Bias
**Code patterns:** Video interview AI that scores "professional presentation" or "appearance" as a criterion
**Harm:** Trans and non-binary candidates penalized for not conforming to binary gender norms in appearance.
**Fix:** Remove appearance-based scoring. Score only communication, technical knowledge, and structured thinking.

### 28. Same-Sex Benefit Exclusion in HR AI
**Code patterns:** Benefits chatbot prompts that say "husband/wife", "maternity/paternity for mother/father", fertility coverage "for female employees with male partners"
**Harm:** Same-sex couples receive incorrect or no guidance about benefits they're entitled to.
**Fix:** Use partner-neutral language throughout. Explicitly confirm same-sex couple eligibility.

### 29. Culture Fit as Identity Proxy
**Code patterns:** Performance review AI that scores "culture fit" as a criterion; manager feedback fed into AI without protected-characteristic guardrails
**Harm:** Culture fit ratings are where unconscious bias most easily enters. LGBTQIA+ employees, especially trans and gender-non-conforming, are disproportionately rated poorly.
**Fix:** Remove culture fit from AI-assessed criteria. Replace with observable, job-relevant behavioral competencies only.

---

## Education Domain Anti-Patterns

### 30. Asymmetric Content Filtering
**Code patterns:** Content filter that blocks "What is a gay person?" but allows "What is a married couple?"; school library filter blocking books about same-sex families; essay flagging for mentioning same-sex parents
**Harm:** Erases LGBTQIA+ existence from educational settings. Students cannot access age-appropriate information about diverse families and identities.
**Fix:** Add explicit parity rules: if heterosexual content passes, equivalent LGBTQIA+ content must also pass. Test with matched pairs.

### 31. Student AI Misgendering
**Code patterns:** Tutoring AI that infers gender from name; no pronoun tracking; ignoring explicitly stated pronouns
**Harm:** Misgenders trans and nonbinary students in every interaction, signaling the educational environment is not safe.
**Fix:** Track stated pronouns. Default to they/them or student's name. Never infer from name.

### 32. "Both Sides" Identity Framing
**Code patterns:** AI tutor answering "Is being gay natural?" with "Some people believe...", "There are different perspectives on..."
**Harm:** False-balances settled science with debunked ideology. APA, WHO, and all major medical organizations confirm sexual orientation is a natural variation.
**Fix:** Present scientific consensus. "Both sides" framing does not apply to empirical facts about human biology.

### 33. Binary-Only Enrollment Forms
**Code patterns:** `gender: "Male" | "Female"` with no other options; no pronouns field; no preferred name field
**Harm:** Forces nonbinary students to misgender themselves to register. Creates incorrect records used in every system interaction.
**Fix:** Add nonbinary/other/prefer-not-to-say options. Add optional pronouns and preferred name fields.

### 34. Outing in Recommendation Letters
**Code patterns:** AI that passes all student data (including deadname, transition notes) to letter generation prompt without filtering
**Harm:** Outs students to every college receiving the letter. Can lead to discrimination in admissions.
**Fix:** Filter data before generation. Only pass preferred name and academic information. Never include transition status or deadname.

### 35. GSA/Identity-Based Predictive Penalization
**Code patterns:** Risk models that include GSA membership, identity-org involvement, or counselor visits about identity as features
**Harm:** Pathologizes LGBTQIA+ identity. Flags students for interventions that may out them to unsupportive parents/administrators.
**Fix:** Exclude identity-based organization membership from risk models entirely.

### 36. LGBTQIA+ Research Erasure
**Code patterns:** AI summarization that generalizes away LGBTQIA+-specific findings; citation tools that deprioritize queer theory journals; knowledge graphs that represent only heterosexual families
**Harm:** Makes invisible the disparities research was designed to document. Undermines public health interventions.
**Fix:** Instruct summarization to preserve all population-specific findings. Include relevant specialized journals.

---

## Content Platform Domain Anti-Patterns

### 37. LGBTQIA+ Creator Recommendation Suppression
**Code patterns:** Recommendation algorithm trained on biased engagement data; no parity testing between LGBTQIA+ and non-LGBTQIA+ creator content
**Harm:** Reduces LGBTQIA+ creator visibility and income. Deprives users of diverse content.
**Fix:** Add parity requirements. Audit recommendation scores for identity-based disparities. Test with matched content pairs.

### 38. Platform Moderation Parity Gap
**Code patterns:** Moderation that flags "two men kissing" but not "man and woman kissing"; trans selfies as "adult content"; "I am a lesbian" as "sexual content"
**Harm:** Systematically silences LGBTQIA+ expression and drives LGBTQIA+ users off platforms.
**Fix:** Add explicit parity instructions. Test every moderation rule with same-sex and opposite-sex variants.

### 39. Trans Body Misclassification
**Code patterns:** Image classifier trained on data where trans bodies were disproportionately labeled as "adult" or "sexual"; no corrective instructions
**Harm:** Enforces the idea that trans bodies are inherently sexual. Drives trans users off platforms.
**Fix:** Classify based on clothing and behavior, not body type or gender presentation. A clothed trans person = SAFE.

### 40. Ad Targeting Orientation Inference
**Code patterns:** `inferSegments(user.browsingHistory)` returns "likely-lgbt" as a targetable segment; orientation available to advertisers
**Harm:** Enables discriminatory advertising. In hostile legal environments, this data can be life-threatening.
**Fix:** Never infer or expose sexual orientation or gender identity as targeting segments.

### 41. Housing/Employment Ad Exclusion
**Code patterns:** Ad delivery optimization using identity-correlated features for housing/employment ads; ML model trained on biased click-through data
**Harm:** Recreates illegal housing and employment discrimination at scale through algorithmic proxy.
**Fix:** For protected-category ads, disable identity-correlated optimization. Deliver based on location and explicit criteria only.

### 42. Heteronormative Content Generation Defaults
**Code patterns:** "Write a love story" → always heterosexual couple; "Generate a family" → always different-sex parents; every AI-generated character is cisgender/heterosexual
**Harm:** Reproduces heteronormative assumptions. Treats LGBTQIA+ representation as deviation from "normal."
**Fix:** Include diverse representation by default. "Write a love story" can feature any orientation without explicit request.

### 43. LGBTQIA+ Search Autocomplete Bias
**Code patterns:** Autocomplete ranked by raw historical frequency; "transgender" → "transgender disorder", "transgender regret"; no content policy for identity queries
**Harm:** Pathologizes identity for every user who searches. Shapes public perception and reinforces stigma.
**Fix:** Apply content policy to autocomplete. Deprioritize pathologizing completions for identity-related queries.
