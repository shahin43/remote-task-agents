# Table Pattern Library

Copy-paste table examples for business papers. Pick the pattern that fits your data and adapt it.

**A few formatting conventions that improve readability:**
- Header rows on every table
- Summary/total rows in **bold**
- Variance or delta columns tend to work best on the right
- Aim for 5–7 columns max; split wider tables if readability suffers
- Where possible, give tables a **takeaway title** above — a claim, not just a topic

---

## 1. Comparison table

**When to use:** Evaluating options side-by-side across consistent criteria.

**Cost of ownership by platform**

| Criterion | Option A: Build | Option B: Buy | Option C: Partner |
|---|---|---|---|
| Upfront cost | £200k | £80k | £50k |
| Annual run cost | £60k | £120k | £90k |
| Time to value | 6 months | 2 months | 3 months |
| Customisation | Full | Limited | Moderate |
| Vendor lock-in | None | High | Medium |
| **3-year TCO** | **£380k** | **£440k** | **£320k** |

**Tips:**
- First column is always the criterion/dimension
- Bold the recommended option's column header or add a note below
- Summary row at the bottom in bold
- Keep criteria to 5–8 rows; more goes in an appendix

---

## 2. Decision matrix (weighted)

**When to use:** When criteria have different importance and you need a structured scoring method.

**Platform selection — weighted scoring**

| Criterion | Weight | Option A | Option B | Option C |
|---|---|---|---|---|
| Cost | 30% | 7 (2.1) | 5 (1.5) | 8 (2.4) |
| Speed to market | 25% | 4 (1.0) | 9 (2.25) | 6 (1.5) |
| Scalability | 20% | 9 (1.8) | 6 (1.2) | 7 (1.4) |
| Team capability | 15% | 8 (1.2) | 7 (1.05) | 5 (0.75) |
| Vendor support | 10% | 6 (0.6) | 8 (0.8) | 7 (0.7) |
| **Weighted total** | **100%** | **6.7** | **6.8** | **6.75** |

**Tips:**
- Show raw score and weighted score: "7 (2.1)"
- Weights must sum to 100%
- Explain the scoring scale (e.g., 1–10) in a note below
- When scores are close, acknowledge it: "Options B and C scored within 0.05 — the decision hinges on [differentiating factor]"

---

## 3. Financial summary

**When to use:** Presenting revenue, cost, margin, or investment figures.

**Projected financial impact (base case)**

| Item | Year 1 | Year 2 | Year 3 | 3-Year Total |
|---|---|---|---|---|
| Revenue uplift | £150k | £320k | £480k | £950k |
| Implementation cost | (£200k) | — | — | (£200k) |
| Annual run cost | (£60k) | (£60k) | (£60k) | (£180k) |
| **Net benefit** | **(£110k)** | **£260k** | **£420k** | **£570k** |
| Cumulative | (£110k) | £150k | £570k | |

**Tips:**
- Use parentheses for negative numbers: (£200k)
- Em-dash (—) for zero or not applicable
- Bold the net/total rows
- Include a cumulative row to show when payback occurs
- Always state: "All figures are [annualised / one-off / run-rate]. [Draft / Validated by Finance]."

---

## 4. Timeline / status table

**When to use:** Tracking phases, milestones, or workstream progress.

**Implementation status — Week 12**

| Phase | Timeline | Status | Owner | Notes |
|---|---|---|---|---|
| Requirements | Jan–Feb 2026 | ✅ Complete | A. Smith | Signed off 14 Feb |
| Design | Mar 2026 | 🔄 In progress | B. Jones | On track |
| Build — Sprint 1 | Apr 2026 | ⏸ Not started | C. Lee | Depends on design |
| Testing | May 2026 | ⏸ Not started | D. Patel | |
| Launch | Jun 2026 | ⏸ Not started | A. Smith | |

**Status indicators:**
- ✅ Complete
- 🔄 In progress
- ⚠️ At risk
- ❌ Blocked
- ⏸ Not started

**Tips:**
- Status tables are a natural place for emoji indicators
- Keep status to single-word or two-word labels
- Notes column for context — keep to one sentence

---

## 5. Risk register

**When to use:** Any paper that identifies risks — business cases, architecture papers, strategy papers.

**Key risks and mitigations**

| # | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| 1 | Key vendor exits market | Low | High | Evaluate alternative vendors quarterly; maintain abstraction layer | CTO |
| 2 | Budget reduced mid-programme | Medium | High | Deliver in phases; Phase 1 is self-contained | CFO |
| 3 | Integration delays with legacy system | High | Medium | Start integration spike in Phase 1; allocate buffer | Tech Lead |
| 4 | Low user adoption | Medium | Medium | User research in design phase; pilot group before full rollout | Product |

**Tips:**
- Number the risks for easy reference in discussion
- Use High/Medium/Low (not numeric scales) for readability
- Ideally every risk has a mitigation and an owner
- If there's no mitigation, mark it as "Accepted risk — monitoring via [mechanism]"

---

## 6. Data summary (metrics)

**When to use:** Analytics reports, trading updates, performance reviews.

**Weekly trading performance — Week 12**

| Metric | This Week | Last Week | WoW Change | Last Year | YoY Change |
|---|---|---|---|---|---|
| Revenue | £22.3m | £21.8m | +2.3% | £20.8m | +7.2% |
| Transactions | 485k | 472k | +2.8% | 451k | +7.5% |
| AOV | £46.00 | £46.19 | −0.4% | £46.12 | −0.3% |
| Gross margin | 52.1% | 52.4% | −0.3pp | 53.2% | −1.1pp |
| Online share | 38.2% | 37.8% | +0.4pp | 34.1% | +4.1pp |

**Tips:**
- Show absolute values AND percentage changes together
- Use % for growth rates, pp (percentage points) for comparing rates/shares
- Negative changes use minus sign, not parentheses (parentheses are for financial losses)
- Always include at least two comparators (WoW + YoY, or actual + budget)

---

## 7. Stakeholder matrix

**When to use:** Strategy papers, org design papers, stakeholder engagement planning.

**Stakeholder engagement plan**

| Stakeholder | Interest | Influence | Current Position | Action |
|---|---|---|---|---|
| CFO | Budget impact | High | Supportive | Keep informed; share financial model |
| CTO | Architecture fit | High | Neutral | Deep-dive session on tech approach |
| Head of Ops | Process change | Medium | Concerned | Address process impact in next session |
| End users | Daily workflow | Low | Unaware | Include in pilot group; gather feedback |

**Tips:**
- "Current Position" is more useful than abstract "Power/Interest" quadrants
- Action column makes the table operational, not just analytical
- Update this table as engagement progresses

---

## 8. Time-series snapshot (metrics in columns)

**When to use:** Showing the same metrics across multiple time periods — quarterly results, monthly trends.

**Quarterly performance — FY26**

| Metric | Q1 | Q2 | Q3 | Q4 | FY Total |
| --- | --- | --- | --- | --- | --- |
| Revenue | £18.2m | £19.8m | £21.1m | £23.4m | £82.5m |
| Gross profit | £9.5m | £10.4m | £10.9m | £12.0m | £42.8m |
| Gross margin | 52.2% | 52.5% | 51.7% | 51.3% | 51.9% |
| EBITDA | £2.1m | £2.4m | £2.3m | £2.8m | £9.6m |
| **Net profit** | **£1.2m** | **£1.5m** | **£1.3m** | **£1.9m** | **£5.9m** |

**Tips:**

- Time periods flow left-to-right (earliest → latest)
- Include a total/average column on the right
- Bold the key "bottom line" row
- Good for: P&L snapshots, quarterly reviews, budget tracking

---

## 9. Time-series snapshot (metrics in rows)

**When to use:** When you have many time periods but few metrics, or when the time dimension is more important than the metric dimension.

**Weekly revenue trend — W8 to W12**

| Week | Revenue | WoW Change | Transactions | AOV |
| --- | --- | --- | --- | --- |
| W8 | £20.1m | — | 438k | £45.89 |
| W9 | £20.5m | +2.0% | 445k | £46.07 |
| W10 | £21.2m | +3.4% | 459k | £46.19 |
| W11 | £21.8m | +2.8% | 472k | £46.19 |
| **W12** | **£22.3m** | **+2.3%** | **485k** | **£46.00** |

**Tips:**

- Each row is a time period, columns are metrics
- Bold the most recent / current row
- Include a change column adjacent to the metric it refers to
- Em-dash for the first row's change (no prior period)

---

## 10. Group-by breakdown

**When to use:** Breaking a total into constituent parts — revenue by channel, cost by department, headcount by team.

**Revenue by channel — Q4 FY26**

| Channel | Revenue | % of Total | YoY Change |
| --- | --- | --- | --- |
| Online | £10.8m | 46.2% | +12.3% |
| Retail — UK | £7.2m | 30.8% | +1.8% |
| Retail — International | £3.1m | 13.2% | +4.5% |
| Wholesale | £1.8m | 7.7% | −2.1% |
| Marketplace | £0.5m | 2.1% | +45.0% |
| **Total** | **£23.4m** | **100%** | **+7.2%** |

**Tips:**

- Sort by size (largest first) unless there's a natural ordering
- Include a % of Total column to show composition
- Total row at the bottom in bold, must sum correctly
- If a category is growing fast from a small base, note it: "+45% (from £0.3m base)"

---

## 11. Group-by with sub-groups

**When to use:** Two-level hierarchies — department → team, region → country, category → subcategory.

**Headcount and cost by department — FY26**

| Department | Team | FTE | Fully Loaded Cost | % of Total |
| --- | --- | --- | --- | --- |
| **Engineering** | | **42** | **£4.6m** | **38%** |
| | Platform | 18 | £2.0m | 16% |
| | Data | 14 | £1.5m | 13% |
| | QA | 10 | £1.1m | 9% |
| **Product** | | **15** | **£1.8m** | **15%** |
| | Product Management | 8 | £1.0m | 8% |
| | Design | 7 | £0.8m | 7% |
| **Operations** | | **55** | **£5.7m** | **47%** |
| | Stores | 40 | £3.8m | 31% |
| | Logistics | 10 | £1.2m | 10% |
| | Support | 5 | £0.7m | 6% |
| **Total** | | **112** | **£12.1m** | **100%** |

**Tips:**

- Bold the group header rows with subtotals
- Indent sub-group names (leave group column empty for sub-rows)
- Subtotals on group rows, grand total at bottom
- Works well for org structures, cost breakdowns, product hierarchies

---

## 12. Pivot table (cross-tabulation)

**When to use:** Showing one metric across two dimensions — e.g., revenue by channel AND quarter, conversion rate by segment AND device.

**Revenue by channel and quarter (£m)**

| Channel | Q1 | Q2 | Q3 | Q4 | FY Total |
| --- | --- | --- | --- | --- | --- |
| Online | £7.8m | £8.5m | £9.2m | £10.8m | £36.3m |
| Retail — UK | £6.8m | £7.1m | £7.4m | £7.2m | £28.5m |
| Retail — Intl | £2.4m | £2.8m | £2.9m | £3.1m | £11.2m |
| Wholesale | £1.2m | £1.4m | £1.6m | £1.8m | £6.0m |
| **Total** | **£18.2m** | **£19.8m** | **£21.1m** | **£23.4m** | **£82.5m** |

**Tips:**

- Rows = one dimension, columns = another dimension
- Include both row totals (rightmost) and column totals (bottom row)
- Keep to max 5–6 columns of data; more dimensions go in separate tables
- Highlight the cell with the key insight using bold: "**£10.8m**"

---

## 13. Actual vs budget vs forecast

**When to use:** Tracking performance against plan — budget reviews, forecast updates, variance analysis.

**FY26 budget performance — Q3 YTD**

| Item | Budget | Actual | Variance | Var % | Forecast |
| --- | --- | --- | --- | --- | --- |
| Revenue | £58.0m | £59.1m | +£1.1m | +1.9% | £82.0m |
| COGS | (£27.5m) | (£28.2m) | (£0.7m) | −2.5% | (£39.5m) |
| Gross profit | £30.5m | £30.9m | +£0.4m | +1.3% | £42.5m |
| Opex | (£22.0m) | (£21.4m) | +£0.6m | +2.7% | (£28.5m) |
| **EBITDA** | **£8.5m** | **£9.5m** | **+£1.0m** | **+11.8%** | **£14.0m** |

**Tips:**

- Budget first, Actual second, Variance third — reader's eye follows the comparison naturally
- Positive variance = favourable (even if it means higher cost, sign from the business perspective)
- Include both absolute and percentage variance
- Forecast column shows where you expect to land by year-end
- Colour convention (in digital documents): nothing — let the +/− signs speak. Never rely on red/green

---

## 14. Before/after comparison

**When to use:** Showing the impact of a change — process improvement, reorganisation, migration.

**Customer query resolution — before and after AI assistant**

| Metric | Before | After | Change | Notes |
| --- | --- | --- | --- | --- |
| Avg resolution time | 4.2 hours | 1.8 hours | −57% | First-response time included |
| Queries per agent/day | 24 | 38 | +58% | Agent handles more complex cases |
| Customer satisfaction | 3.2/5 | 4.1/5 | +0.9 | CSAT survey, n=1,200 |
| Cost per query | £8.40 | £4.20 | −50% | Fully loaded agent cost |
| Escalation rate | 35% | 18% | −17pp | To senior agent or manager |

**Tips:**

- Before column first, After second
- Show both absolute change and percentage
- Notes column for methodology/context
- Works well for business cases showing ROI of an initiative

---

## 15. Ranked / league table

**When to use:** Ranking items by a metric — top products, best-performing stores, highest-impact initiatives.

**Top 10 products by revenue contribution — Q4**

| Rank | Product | Revenue | % of Total | Margin | Trend |
| --- | --- | --- | --- | --- | --- |
| 1 | Vitamin D 1000iu | £1.2m | 5.1% | 62% | ↑ |
| 2 | Omega-3 Fish Oil | £0.9m | 3.8% | 58% | → |
| 3 | Protein Powder 1kg | £0.8m | 3.4% | 41% | ↑ |
| 4 | Multivitamin Daily | £0.7m | 3.0% | 65% | ↓ |
| 5 | Collagen Peptides | £0.6m | 2.6% | 55% | ↑ |
| ... | ... | ... | ... | ... | ... |
| | **Top 10 total** | **£7.8m** | **33.3%** | **55% avg** | |

**Tips:**

- Number the rank explicitly
- Include a secondary metric (margin, growth) for context
- Trend arrows (↑ → ↓) are acceptable in tables as simple directional indicators
- Show the "Top N total" as a subtotal row
- Use "..." to indicate truncation if showing a subset

---

## 16. Scenario comparison

**When to use:** Presenting multiple what-if scenarios side-by-side — investment cases, sensitivity analysis.

**Three-year ROI under different scenarios**

| | Conservative | Base Case | Optimistic |
| --- | --- | --- | --- |
| Revenue growth | 3% p.a. | 7% p.a. | 12% p.a. |
| Customer acquisition | 5k/month | 8k/month | 12k/month |
| Avg basket size | £42 | £46 | £52 |
| **3-year revenue** | **£72m** | **£83m** | **£98m** |
| Investment required | £2.5m | £2.5m | £2.5m |
| **Payback period** | **28 months** | **18 months** | **11 months** |
| 3-year NPV | £1.2m | £4.8m | £9.1m |
| **IRR** | **8%** | **22%** | **38%** |

**Tips:**

- Base case in the middle column (reader's eye is drawn to centre)
- Bold the key decision metrics (payback, NPV, IRR)
- Keep the investment row constant across scenarios to show it's the lever being tested
- State assumptions explicitly below the table

---

## Quick reference: which format?

| Your data is... | Consider |
|---|---|
| Comparing options across criteria | Comparison table or decision matrix |
| Showing financial projections | Financial summary table |
| Tracking progress or status | Timeline/status table |
| Listing risks with mitigations | Risk register |
| Presenting metrics with trends | Data summary table |
| Showing proportions (parts of whole) | Bar chart or table |
| Showing a flow or process | Mermaid flowchart |
| Showing system interactions | Mermaid sequence diagram |
| Explaining a concept in narrative | Prose (no visual needed) |

Tables are usually the safest default for business papers — scannable, precise, and familiar. Diagrams work best when spatial relationships are the core message.
