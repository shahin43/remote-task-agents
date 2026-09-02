---
name: business-paper
description: >
    Write high-quality business papers in markdown. Use whenever the user asks to
    write, draft, structure, or improve a business paper, business case, strategy
    paper, architecture document, product brief, analytics report, operational
    summary, executive summary, decision paper, investment case, options paper,
    case for change, org design paper, trading update, market review, or any
    professional business document. Also use when the user asks for help with
    paper structure, data storytelling, mermaid diagrams in documents, formatting
    business documents in markdown, or improving the quality of a written paper.
    Even if the user doesn't say "paper" explicitly — if they want a structured
    written deliverable for a business audience, this skill applies.
---

# Business Paper Skill

Write high-quality business papers in markdown with tables and mermaid diagrams.

This skill is a collection of writing guidelines — not rules. It covers structure, principles, formatting, and quality patterns that tend to produce stronger papers. Use your judgement throughout: adapt to the context, the audience, and the user's preferences. The LLM should figure out the right structure for each paper — these guidelines are here to inform that judgement, not replace it.

Domain-specific skills may layer on top with org-specific terminology, branding, data sources, and approval workflows; when they do, their instructions take precedence.

## Reference files

Load all of the reference files listed below — they're reference examples, not instructions to follow mechanically:

| File                             | Purpose                                                                |
| -------------------------------- | ---------------------------------------------------------------------- |
| `references/paper-types.md`      | Example heading structures for common paper types — use as inspiration |
| `references/mermaid-patterns.md` | Copy-paste mermaid diagram examples                                    |
| `references/tables-and-data.md`  | Copy-paste table pattern examples                                      |
| `references/common-gaps.md`      | A short list of formatting gaps that are easy to miss                  |

---

## Common paper types

These are common patterns, not a closed list. Many papers blend types or don't fit neatly into one category — that's fine. Use these as starting points, not constraints.

| Paper type          | Core purpose                                                                             | Typical length |
| ------------------- | ---------------------------------------------------------------------------------------- | -------------- |
| Business Case       | Justify spend with financial models and options analysis                                 | 8–15 pages     |
| Architecture Paper  | Describe systems, integrations, and phased delivery                                      | 6–12 pages     |
| Strategy Paper      | Build argument for a directional shift                                                   | 5–10 pages     |
| Product Brief       | Define scope, constraints, and open questions for a new initiative                       | 4–8 pages      |
| Operational Summary | Capture decisions, actions, and owners from a session or review                          | 2–4 pages      |
| Analytics Report    | Present data-driven findings and recommendations                                         | 4–10 pages     |
| Methodology Paper   | Document how a model, algorithm, or system works — data, logic, performance, limitations | 5–12 pages     |

If the user's request resembles one of these, glance at `references/paper-types.md` for structural inspiration. If it doesn't fit neatly — combine elements, skip sections, or design a structure that fits the content.

---

## Writing approach

These are guidelines, not a rigid process. If the user says "just write it" — go. You can always restructure later. The best papers are iterated, not planned to death.

### Quick start

If you have enough context, start writing immediately. Figure out the right structure for the content and draft. You can always ask clarifying questions as you go.

### When to plan first

For longer or higher-stakes papers (business cases, strategy papers), it helps to align on a few things before diving in:

- **Paper type** — propose one based on the user's request
- **Audience** — who reads this? (executives, technical team, mixed)
- **Key question** — what decision or finding does this paper support?
- **Available data** — what evidence exists?

If the user wants to discuss structure first, draft a heading skeleton (H2/H3) and get quick feedback. But don't block on this — a draft with the wrong structure teaches you more than 30 minutes of planning.

### Guidelines to keep in mind

- **Conclusion first (Pyramid Principle)** — lead every section with its main point, then evidence. The reader should get the argument from first sentences alone
- **Layer for audiences** — executive summary (3 min), main body (10 min), appendices (reference)
- **Visual rhythm** — break up prose with tables or diagrams where they add value. Every visual should convey a specific insight, not just decorate
- **Quick sanity check** — before delivering, glance at `references/common-gaps.md` to catch obvious formatting gaps

---

## Writing guidelines

These patterns tend to produce stronger papers. Use your judgement on when to apply them.

### Pyramid Principle — conclusion first

The most important idea goes first, at every level:

- The **paper** opens with an executive summary stating the recommendation
- Each **section** opens with its main finding or conclusion
- Each **paragraph** opens with the key claim, followed by evidence

This means the reader can stop at any depth and still have the essential message. An executive who reads only the summary gets the answer. A specialist who reads every appendix gets the proof.

**Section headings should be claims, not topics.** Write "Revenue grew 12% driven by online expansion" not "Revenue Analysis". The heading itself should tell the story.

### SCQA — narrative structure for persuasion

Use this framework for the opening sections of strategy papers, business cases, and analytics reports:

- **Situation** — stable context that everyone accepts as true
- **Complication** — what changed, what's broken, what's at risk
- **Question** — the question this paper answers (often implicit)
- **Answer** — your recommendation or key finding

SCQA builds narrative tension before delivering the answer. It works well when you need to persuade a sceptical audience or justify a significant change. It's less useful for operational summaries or product briefs, which tend to be action-oriented and lead directly with the content.

### Data storytelling — insight, not just information

When presenting data (tables, charts, metrics):

1. **State the takeaway first.** "Customer acquisition cost rose 23% in Q3" not "Q3 CAC Data"
2. **Annotate the insight, not just the numbers.** Say what changed, by how much, and why it matters — in that order
3. **Provide context.** A number without a comparator is meaningless. Always show vs budget, vs prior year, vs target, or vs benchmark
4. **Use the right format.** Tables for precise comparisons; mermaid diagrams for flows and relationships; prose for narrative interpretation. See `references/tables-and-data.md` for examples

### Tone and voice

- **Active voice.** "We recommend Option B" not "It is recommended that Option B be selected"
- **Authoritative but transparent.** State your position confidently, but acknowledge constraints and risks explicitly. Credibility comes from candour, not certainty
- **Concise.** Paragraphs max 4–5 sentences. Cut filler words. If a sentence doesn't advance the argument, remove it
- **Audience-appropriate language.** Jargon is fine for specialist audiences. For mixed audiences, define terms on first use or add a glossary appendix
- **No hedging without substance.** "Further analysis may be needed" is weak. "We need to validate assumption #3 with Finance by 15 March" is actionable

---

## Formatting guidelines

### Document structure

- `#` (H1) — paper title only. Exactly one per document
- `##` (H2) — major sections (Executive Summary, Background, Analysis, Recommendations, etc.)
- `###` (H3) — subsections
- `####` (H4) — sparingly, for sub-subsections within long sections
- Avoid skipping heading levels (no H2 → H4) — it breaks document outline tools
- Number sections only when they represent a sequence (phases, steps, priorities). For most papers, descriptive headings without numbers are clearer

### Emphasis and notation

- **Bold** — key terms on first use, financial figures, critical findings, recommended options
- _Italics_ — publication titles, foreign terms, subtle emphasis
- `Monospace` — system names, database tables, API endpoints, technical identifiers
- Avoid ALL CAPS for emphasis — it reads as shouting
- Status indicators (✅ ❌ ⚠️ 🔄 ⏸) — work well inside tables for rapid scanning. Best kept out of body text

### Financial and numeric formatting

- **Currency:** symbol + amount + suffix — "$150k", "EUR 2.3m", "GBP 1.2m", "£4.5m"
- Use the organisation's local currency convention. If unknown, ask the user
- **Percentages:** +/−% for growth rates; percentage points (pp) when comparing two rates (e.g., "margin improved by 3pp")
- **Ranges:** "150k–200k" (with en-dash or hyphen), not "between 150k and 200k" in tables
- Where possible, state whether a figure is annualised, run-rate, one-off, or cumulative
- Show actuals alongside comparators: "Revenue £22.3m (+7.2% YoY)" gives both the number and the trend

### Tables

- Every table has a header row
- Summary/total rows in **bold**
- Variance or delta columns rightmost
- Keep tables to 5–7 columns max; split wider tables
- Give every table a takeaway title above it, not just a topic label
- See `references/tables-and-data.md` for copy-paste examples

### Mermaid diagrams

- One concept per diagram — avoid overloading
- Give every diagram a descriptive title (as a heading or bold text above)
- Use consistent colour coding when multiple node types exist in a diagram
- Avoid pie charts — human perception is poor at comparing angles. Bar charts or tables work better
- Keep diagrams to 15–20 nodes max; split complex ones
- See `references/mermaid-patterns.md` for copy-paste examples

### Scope boundaries

For longer papers, consider including a scope section near the top:

- "This paper covers..." (bullet list)
- "This paper does NOT cover..." (bullet list)

This can prevent scope creep and set reader expectations — but it's not always needed. Short papers or operational summaries usually don't need one.

---

## Section-writing patterns

These sections recur across paper types. Here are guidelines for writing each one well — adapt as needed.

### Executive summary

- Aim for 50–150 words
- Open with the single most important finding or recommendation
- No new information — only summarise what appears in the body
- Write this LAST, even though it appears first in the document
- If the paper requires a decision, state the ask: "We are seeking approval for £500k investment in..."

### Options and recommendations

- Multiple options tend to be more credible than a single recommendation (one option can look like advocacy, not analysis)
- Use a comparison table or decision matrix with explicit criteria
- State the recommended option explicitly: "We recommend Option B"
- For each rejected option, state the primary reason in one sentence
- If the recommendation is conditional, say so: "We recommend Option B, subject to Finance confirming the FY26 budget allocation"

### Financial model / cost-benefit

- State all assumptions in a numbered list before the model
- Present at least 2 scenarios (base case + one other: conservative, optimistic, or downside)
- Show both upside and downside — a one-sided model undermines credibility
- Include payback period or break-even point
- Add sensitivity analysis: "If [assumption] changes by +/−X%, the outcome shifts by Y"
- Distinguish cost avoidance from actual savings
- Label all figures as draft/validated and state the source

### Next steps / actions

- Numbered lists work well here — numbers imply priority and sequence
- Format: "1. **[Action]** — [Owner] — [Date]"
- Group by workstream if more than 8 items
- Ideally every action has an owner and a date. "TBD" is fine temporarily

### Risks and constraints

- Use a table: Risk | Likelihood | Impact | Mitigation | Owner
- Or simpler: Constraint | Implication | Mitigation
- Be specific — "Budget may be reduced" is vague; "FY26 budget has 15% downside risk based on Q3 actuals" is useful
- Ideally every risk has a mitigation or is explicitly marked as an accepted risk

---

## Common anti-patterns

| Anti-pattern                                   | Why it fails                                                    | Do this instead                                                       |
| ---------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| Burying the recommendation on page 8           | Executives stop reading by page 2                               | Lead with the conclusion in the executive summary                     |
| Presenting only one option                     | Looks like you didn't analyse alternatives                      | Present 2–4 options with explicit trade-offs                          |
| Walls of text with no tables or diagrams       | Readers can't compare or scan                                   | Add a table or diagram every 1–2 pages                                |
| Decorative diagrams                            | Waste attention; readers distrust visuals that don't earn space | Every diagram must convey one specific, load-bearing concept          |
| Vague next steps ("we will explore...")        | No accountability, no momentum                                  | Specific action + owner + date                                        |
| Assumptions hidden in prose                    | Readers miss them; stakeholders can't challenge them            | Numbered assumption list, clearly labelled                            |
| "Further analysis required" with no scope      | Kicks the can indefinitely                                      | State what analysis, who owns it, and the deadline                    |
| Mixing facts and opinions in the same breath   | Undermines credibility                                          | Label opinions as recommendations; cite data for facts                |
| Repeating the same point in different sections | Wastes the reader's time and suggests poor structure            | State each point once in the right section; cross-reference if needed |
| Opening with background instead of the answer  | Loses busy readers before the point arrives                     | SCQA: background is the Situation, but the Answer comes quickly       |

---

## Working with domain-specific skills

This skill provides the general writing framework. Domain-specific skills (layered on top) may add:

- Organisation-specific terminology and branding
- Specific data sources and how to query them
- Templates mandated by the organisation
- Approval workflows and stakeholder lists
- House style overrides (e.g., different heading conventions, specific diagram styles)

When a domain skill is active, its instructions take precedence for domain-specific content. This skill provides the general writing guidelines — domain skills can override any of them. If no domain skill is active, use the patterns here and ask the user for domain context as needed.

---

## Interaction pattern

Adapt to the user's pace. Some users want to plan; others want a draft immediately. Follow their lead.

- **If the user gives clear instructions** — start writing. Ask questions inline as needed, don't front-load them
- **If the request is vague** — propose a paper type and structure, then start drafting once you have enough to go on
- **For long papers** — offer checkpoints after major sections so the user can redirect early. Don't write 10 pages in silence
- **When data is available** (e.g., from a database skill) — discuss the findings briefly with the user, then weave them into the narrative. Data should inform the paper, not be dumped into it
- **Before delivering** — glance at `references/common-gaps.md` to catch obvious formatting gaps
- **After writing** — run the grounding check (see below). This is mandatory, not optional

---

## Grounding check (mandatory)

After completing the paper, launch a subagent to verify that every claim, figure, name, date, and factual statement in the paper is grounded in the source material provided by the user (transcripts, files, data, conversation context). This is not a guideline — it is a hard rule.

### What the subagent does

The subagent receives the full draft and all source inputs. For every factual claim in the paper, it checks:

1. **Is this stated or clearly implied in the source material?** If yes — grounded.
2. **Is this a reasonable inference from the source material?** If yes — flag it as an inference and note what it was inferred from.
3. **Is this not in the source material at all?** If yes — flag it as ungrounded.

### What to check

- Names of people, teams, and organisations
- Financial figures, percentages, and dates
- Decisions attributed to specific people
- Quotes or paraphrased statements
- Causal claims ("X happened because Y")
- Status of projects or initiatives
- Any specific detail that could be wrong if the model invented it

### How to handle the results

- **Ungrounded claims:** Remove them or clearly mark them as assumptions (e.g., "[Assumption — not confirmed in source material]")
- **Inferences:** Keep them if reasonable, but soften the language to signal they are interpretive (e.g., "This suggests..." rather than "This confirms...")
- **Grounded claims:** No action needed

### Subagent prompt template

Use this as the prompt when launching the grounding subagent:

```
You are a fact-checker. You have been given a business paper and the source material it was based on.

Your job: check every factual claim in the paper against the source material. For each claim, classify it as:
- GROUNDED: directly stated or clearly supported by the source material
- INFERENCE: a reasonable interpretation, but not explicitly stated — note what it was inferred from
- UNGROUNDED: not supported by the source material — the author may have invented this

Focus on: names, figures, dates, decisions, attributions, causal claims, and project statuses.

Return a list of any INFERENCE or UNGROUNDED items with:
- The claim (quote from the paper)
- The classification (INFERENCE or UNGROUNDED)
- The evidence (what source material supports or contradicts it, or "No source found")

If everything is grounded, say so.

SOURCE MATERIAL:
[insert source material here]

PAPER TO CHECK:
[insert paper here]
```

After the subagent returns, fix any ungrounded claims before delivering the final paper to the user. If you cannot ground a claim, remove it or flag it transparently.
