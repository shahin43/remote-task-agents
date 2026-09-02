# Paper Type Examples

Example heading structures for common paper types. Use these as inspiration — combine elements, skip sections, or invent new structures that fit the content. Not every paper fits neatly into one type, and that's fine.

---

## 1. Business Case

**Purpose:** Justify an investment, programme, or significant spend.

**Typical audience:** Investment committee, senior leadership, Finance | **Typical length:** 8–15 pages

```
# [Initiative Name] — Business Case
## Executive Summary
## Strategic Context
## Problem Statement
## Options Analysis
### Option A: [Name]
### Option B: [Name]
### Option C: [Name]
### Comparison
## Recommended Option
## Financial Model
### Assumptions
### Base Case
### [Alternative Scenario]
### Sensitivity Analysis
## Implementation Plan
### Phases and Timeline
### Resource Requirements
## Risks and Mitigations
## Next Steps
## Appendix
### Detailed Financial Workings
### Stakeholder Consultation Summary
```

**Tip:** The strongest business cases quantify the problem, present multiple options with trade-offs, and make assumptions explicit and challengeable.

---

## 2. Architecture Paper

**Purpose:** Describe a system's design, components, integrations, and delivery plan.

**Typical audience:** Technical leadership, engineering, product managers | **Typical length:** 6–12 pages

```
# [System Name] — Architecture & Design
## Executive Summary
## Context and Objectives
## Current State
## Target Architecture
### Component Overview
### Data Flows
### Integration Points
## Phased Delivery
### Phase 1: [Name]
### Phase 2: [Name]
### Phase 3: [Name]
## Technical Risks and Constraints
## Dependencies
## Open Questions
## Next Steps
## Appendix
### Glossary
### Detailed Sequence Diagrams
### Alternative Approaches Considered
```

**Tip:** Diagram the current state honestly before presenting the target. Multiple views (high-level overview + zoomed subsystems) work well for complex architectures.

---

## 3. Strategy Paper

**Purpose:** Build a compelling argument for a directional shift — new operating model, capability investment, or strategic pivot.

**Typical audience:** Senior leadership, board, cross-functional stakeholders | **Typical length:** 5–10 pages

```
# [Topic] — Strategy Paper
## Executive Summary
## Situation
## Complication
## Vision
## Operating Principles
## Strategic Priorities
### Priority 1: [Name]
### Priority 2: [Name]
### Priority 3: [Name]
## Enablers
## Success Metrics
## Risks
## Next Steps
## Appendix
### Stakeholder Feedback Summary
### Benchmarks and Comparators
```

**Tip:** The SCQA flow (Situation → Complication → Question → Answer) builds narrative tension before delivering the recommendation. Success metrics should be measurable, not vague.

---

## 4. Product Brief

**Purpose:** Define what's being built, for whom, and within what constraints.

**Typical audience:** Product team, engineering, design, business sponsors | **Typical length:** 4–8 pages

```
# [Product Name] — Product Brief
## Executive Summary
## Context
## User Problem
## Proposed Solution
### What It Does
### How It Works (simplified)
### What It Does NOT Do
## Scope
### In Scope
### Out of Scope
## Constraints
## Dependencies
## Open Questions
## Success Criteria
## Next Steps
## Appendix
### User Research / Evidence
### Mockups or Wireframes
### Related Documents
```

**Tip:** Lead with the user problem, not the solution. "What It Does NOT Do" is often the most valuable section for preventing scope creep.

---

## 5. Operational Summary

**Purpose:** Capture decisions, actions, and outcomes from a meeting, review, or workshop.

**Typical audience:** Session participants, their managers, action owners | **Typical length:** 2–4 pages

```
# [Session Name] — Summary
## Overview
## Key Decisions
## Actions
## Risks and Blockers
## Open Items
## Next Session
## Appendix
### Attendance
### Detailed Discussion Notes
```

**Tip:** Decisions and actions are the core value — everything else is supporting context. Numbered actions with owners and dates create accountability.

---

## 6. Analytics Report

**Purpose:** Present data-driven findings and recommendations.

**Typical audience:** Business stakeholders, commercial teams, senior leadership | **Typical length:** 4–10 pages

```
# [Topic] — Analytics Report
## Executive Summary
## Methodology
## Key Findings
### Finding 1: [Takeaway headline]
### Finding 2: [Takeaway headline]
### Finding 3: [Takeaway headline]
## Detailed Analysis
### [Analysis Area 1]
### [Analysis Area 2]
## Recommendations
## Limitations
## Next Steps
## Appendix
### Data Sources
### Methodology Details
### Supporting Data Tables
```

**Tip:** Lead each finding with a takeaway headline (a claim, not a topic). Stating limitations builds trust rather than undermining credibility.

---

## 7. Methodology Paper

**Purpose:** Document how a model, system, algorithm, or set of business rules works — what it does, how it was built, how it performs, and how to interpret its outputs. Used for ML models, data products, scoring engines, optimisation systems, or any technical methodology that stakeholders need to understand and trust.

**Typical audience:** Data science peers, technical leadership, product managers, business stakeholders who consume the outputs | **Typical length:** 5–12 pages

```
# [Model/System Name] — Methodology
## Executive Summary
## Business Context
## Problem Definition
### What This Solves
### What This Does NOT Solve
## Approach
### Methodology Overview
### Alternatives Considered
## Data
### Training Data
### Input Features
### Data Quality and Preprocessing
## Model / Rules
### Architecture or Logic
### Key Parameters and Assumptions
### Feature Importance
## Outputs
### What the Model Produces
### How to Interpret Outputs
### Known Edge Cases
## Performance
### Metrics
### Validation Approach
### Results
### Comparison to Baseline
## Limitations and Risks
## Deployment and Operations
### How It Runs
### Monitoring and Retraining
### Dependencies
## Next Steps
## Appendix
### Detailed Feature List
### Hyperparameter Configuration
### Full Results Tables
```

**Tip:** The audience often includes non-technical stakeholders who consume the model's outputs — lead with the business context and what the model does in plain language before going into technical detail. The Performance section should be honest about where the model struggles, not just where it excels.
