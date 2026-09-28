# Malaysia

Rules for Malaysian companies (Sdn Bhd) and resident individuals. Every rule names its source: the statute section, or the official page it was read from. A rule marked **secondary** was confirmed only by practitioner sources; check it against the current LHDN programme before relying on it.

**Deliberate choices:** dates are the statutory ones. The one-month e-filing grace LHDN usually allows is not used for planning, and no date is moved for weekends or public holidays. Earlier is always safe.

## Entity facts to collect

| Fact | Why it matters |
|---|---|
| Legal name, SSM registration no., incorporation date | SSM annual return falls on the incorporation anniversary |
| Income tax no. (`C …`), employer no. (`E …`) | Every LHDN filing |
| Financial year end | Anchors the estimate, Form C, audited accounts |
| Date operations began | Tax agents commonly treat the first sales invoice as commencement. It starts the first estimate's 3-month clock and splits off pre-commencement costs |
| Paid-up capital, gross business income, foreign ownership % | SME status (rate and estimate exemption) |
| Payroll (any salary, including a director's) | PCB/EPF/SOCSO/EIS monthly, Form EA and Form E yearly |
| SST registration, taxable-period months | SST-02 every two months |
| Imported services (foreign software, cloud, contractors) | SST-02A and withholding tax |
| Tax incentive (e.g. MDEC MD Status) | Separate account for qualifying income, related-party rules |
| Individual: residence (182-day test), employment, business income | Form BE vs Form B, CP500 instalments |

## SME status

A company is an SME for a year of assessment (YA) when, at the start of the basis period, paid-up ordinary capital is RM2.5 million or less, it isn't linked to a larger company (related-company test), gross business income is RM50 million or less, and, **from YA 2024, no more than 20% is owned directly or indirectly by foreign companies or non-Malaysian citizens** (ITA 1967 Sch. 1; s107C(4B)(d)).

| | SME | Not an SME |
|---|---|---|
| Rate | 15% on the first RM150,000, 17% on the next RM450,000, 24% above | 24% flat |
| First estimate | Exempt for the first two YAs (s107C(4A)). LHDN still recommends filing a RM0 estimate | Due within 3 months of commencement |

Source: [hasil.gov.my, Anggaran Cukai](https://www.hasil.gov.my/en/syarikat/anggaran-cukai/).

## Obligation catalog

Copy an entry into the entity profile's `## Obligations` yaml block (never its frontmatter) only when the entity's facts trigger it, then set `from:` to the first period to track. Periods are keyed by their end month. `anchor` is a month in which a period ends, or `fye`.

### Company income tax (LHDN)

```yaml
- id: cp204
  title: CP204 estimate for next YA
  period: { months: 12, anchor: fye }
  due: { from: start, days: -31 }
  note: Estimate of tax payable for the coming YA, filed 30 days before its basis period begins (1 Dec for a 1 Jan start). Must be at least 85% of the latest estimate for the current YA. Tax agent files.
  source: ITA 1967 s107C(2); hasil.gov.my Anggaran Cukai
- id: cp204a-6th
  title: CP204A revision (6th month)
  period: { months: 12, anchor: fye }
  due: { from: start, months: 5, day: last }
  note: Optional revision of the current YA's estimate, then the remaining instalments are re-spread.
  source: hasil.gov.my Anggaran Cukai (CP204A revision windows)
- id: cp204a-9th
  title: CP204A revision (9th month)
  period: { months: 12, anchor: fye }
  due: { from: start, months: 8, day: last }
  note: Optional revision; 4 instalments remain after it.
  source: hasil.gov.my Anggaran Cukai (CP204A revision windows)
- id: cp204a-11th
  title: CP204A revision (11th month, last chance)
  period: { months: 12, anchor: fye }
  due: { from: start, months: 10, day: last }
  note: Final revision window (from YA 2024); 2 instalments remain after it. Revise if actual tax will exceed the estimate by more than 30%.
  source: hasil.gov.my Anggaran Cukai (CP204A revision windows)
- id: cp204-instalment
  title: CP204 instalment
  period: { months: 1, anchor: 1 }
  due: { from: end, months: 1, day: 15 }
  lead: 10
  note: Monthly instalment of the estimate, due the 15th. Set from/until to the instalment months on the LHDN schedule; skip when the estimate is RM0.
  source: ITA 1967 s107C(12); hasil.gov.my Anggaran Cukai
- id: form-c
  title: Form C (company tax return)
  period: { months: 12, anchor: fye }
  due: { from: end, months: 7, day: last }
  lead: 45
  note: Return and balance of tax, 7 months after FYE. Tax agent files; director signs the tax computation first.
  source: ITA 1967 s77A; secondary (LHDN filing programme)
```

### Employer (LHDN, KWSP, PERKESO)

```yaml
- id: form-e
  title: Form E (employer return)
  period: { months: 12, anchor: 12 }
  due: { from: end, months: 3, day: 31 }
  lead: 30
  note: Mandatory for every company, even with no employees or while dormant.
  source: ITA 1967 s83(1); secondary (LHDN filing programme)
- id: form-ea
  title: Form EA to employees
  period: { months: 12, anchor: 12 }
  due: { from: end, months: 2, day: last }
  note: Statement of remuneration to each employee, including a paid director. Only when salary was paid in the year.
  source: ITA 1967 s83(1A)
- id: payroll-monthly
  title: PCB, EPF, SOCSO and EIS
  period: { months: 1, anchor: 1 }
  due: { from: end, months: 1, day: 15 }
  lead: 10
  note: Monthly tax deduction and contributions for the month's salaries, due the 15th of the following month. Only while payroll runs.
  source: hasil.gov.my navigasi-hasil-2026 (CP39, 15th of the following month)
```

### Indirect tax (Customs, MySST)

```yaml
- id: sst-02a
  title: SST-02A imported services
  period: { months: 1, anchor: 1 }
  due: { from: end, months: 1, day: last }
  lead: 10
  note: Service tax on imported taxable services (foreign software, cloud, contractors) paid or invoiced in the month, declared by the last day of the following month. Close with a thread line when there were none.
  source: Service Tax Act 2018 s26A; MySST Guide on Return and Payment
- id: sst-02
  title: SST-02 service tax return
  period: { months: 2, anchor: 2 }
  due: { from: end, months: 1, day: last }
  note: Registered persons only. Two-month taxable periods (set anchor to a month the entity's periods end in); return due even when nothing is payable.
  source: MySST Guide on Return and Payment; mysst.customs.gov.my FAQ
```

### Companies Commission (SSM)

```yaml
- id: annual-return
  title: SSM annual return
  period: { months: 12, anchor: 4 }
  due: { from: end, months: 1, day: 10 }
  note: Within 30 days of the incorporation anniversary. Set anchor to the incorporation month and day to the date 30 days after the anniversary (incorporated 10 Apr, due 10 May). Company secretary files.
  source: Companies Act 2016 s68; ssm.com.my Annual Submission
- id: fs-circulate
  title: Circulate audited financial statements
  period: { months: 12, anchor: fye }
  due: { from: end, months: 6, day: last }
  lead: 60
  note: Private company circulates audited statements to members within 6 months of FYE. Plan the audit backwards from this date.
  source: Companies Act 2016 s258
- id: fs-lodge
  title: Lodge financial statements with SSM
  period: { months: 12, anchor: fye }
  due: { from: end, months: 7, day: 30 }
  note: Within 30 days after circulation. This date assumes circulation on the last allowed day; lodge earlier when circulated earlier.
  source: Companies Act 2016 s259; ssm.com.my Annual Submission
```

### Individual (resident)

```yaml
- id: form-be
  title: Form BE (no business income)
  period: { months: 12, anchor: 12 }
  due: { from: end, months: 4, day: 30 }
  lead: 30
  note: Return and balance of tax for residents without business income.
  source: hasil.gov.my navigasi-hasil-2026
- id: form-b
  title: Form B (with business income)
  period: { months: 12, anchor: 12 }
  due: { from: end, months: 6, day: 30 }
  lead: 30
  note: Residents with any business income, including freelance or consulting billed personally. Employment income is declared on the same form.
  source: hasil.gov.my navigasi-hasil-2026
- id: cp500
  title: CP500 instalment
  period: { months: 2, anchor: 2 }
  due: { from: end, months: 1, day: last }
  note: Only when LHDN issues a CP500 notice (business, rental or royalty income). Six bi-monthly instalments from March; take exact dates and amounts from the notice. Revise with CP502 by 30 June.
  source: hasil.gov.my navigasi-hasil-2026
```

## Event-driven obligations

These have no calendar; a document or event starts them. [capture](../playbooks/capture.md) raises them.

| Event | Obligation | Deadline | Source |
|---|---|---|---|
| A company begins operations (first sales invoice) | First CP204 estimate, unless an exempt SME | 3 months after commencement, when the first basis period is 6 months or more | s107C(4)(a); hasil.gov.my Anggaran Cukai |
| Payment to a non-resident for software use or a licence (royalty, including subscriptions) | Withholding tax | 1 month after paying or crediting | ITA 1967 s109; LHDN e-commerce guidelines |
| Payment to a non-resident for services performed in Malaysia | Withholding tax | 1 month after paying or crediting | ITA 1967 s109B |
| Imported taxable service, not SST-registered | SST-02A | Last day of the month after payment or invoice, whichever is earlier | Service Tax Act 2018 s26A |
| Taxable services pass RM500,000 over 12 months | SST registration | On passing the threshold | Service Tax Act 2018 |
| Annual revenue passes the e-Invoice threshold | e-Invoice via MyInvois | Per LHDN phase (exemption threshold raised to RM3 million from 1 Sep 2026) | [Bernama](https://www.bernama.com/en/news.php?id=2610866) (secondary) |

Withholding tax paid late costs 10% of the unpaid tax, and the expense is disallowed until it is paid. Rates depend on the payment type and any tax treaty: the tax agent computes them.

## Estimates and penalties

- **Formula:** tax payable = (estimated profit ± tax adjustments) × rate.
- **Instalments:** due the 15th of each month from the second month of the basis period (a new company: from the sixth). A late instalment costs 10% of it (s107C(9)).
- **Floor:** a YA's estimate may not be below 85% of the latest estimate for the previous YA (s107C(3)).
- **Underestimation penalty** (s107C(10)): if actual tax exceeds the final estimate by more than 30%, the penalty is 10% × (actual − estimate − 30% × actual). With a RM0 estimate that is 7% of the actual tax.
- **No estimate filed** when one was required: the tax for the YA is increased by 10% (s107C(10A)), and the late filing is an offence (fine RM200–20,000).
- **Pre-commencement costs** are not deductible (Public Ruling 11/2013), which is one reason the commencement date matters.

## Rates

Read by the tax engine to compute what is owed at any moment. Rates are percentages; each band taxes the slice of chargeable income up to `upto` (the last band has none). Update this block when a budget changes them, and the engine follows.

```yaml
ya: 2025-2026
currency: MYR
company:
  flat: 24
  sme:
    - { upto: 150000, rate: 15 }
    - { upto: 600000, rate: 17 }
    - { rate: 24 }
  zakat_cap: 2.5
  source: hasil.gov.my navigasi-hasil-2026 (company rates); SME rates need paid-up capital up to RM2.5M, gross business income up to RM50M, and no more than 20% foreign ownership from YA 2024 (ITA 1967 Sch. 1)
individual:
  resident:
    - { upto: 5000, rate: 0 }
    - { upto: 20000, rate: 1 }
    - { upto: 35000, rate: 3 }
    - { upto: 50000, rate: 6 }
    - { upto: 70000, rate: 11 }
    - { upto: 100000, rate: 19 }
    - { upto: 400000, rate: 25 }
    - { upto: 600000, rate: 26 }
    - { upto: 2000000, rate: 28 }
    - { rate: 30 }
  non_resident: 30
  self_relief: 9000
  rebate: { upto: 35000, amount: 400 }
  source: hasil.gov.my navigasi-hasil-2026 (resident schedule YA 2025, reliefs, RM400 rebate); PwC Malaysian Tax Booklet (YA 2025/2026 schedule and RM9,000 self relief)
```

## Annual cycle (company, FYE month M)

1. Month M closed, final management accounts to the accountant.
2. Audit: engage early. Audited statements are circulated by M+6 and lodged within 30 days after.
3. Tax computation: review disallowed items, then the director signs.
4. Form C and the balance of tax by M+7.
5. SSM annual return within 30 days of the incorporation anniversary (not tied to FYE).
6. Form EA by end February and Form E by 31 March, for the calendar year.
7. Next YA's CP204 by 30 days before the new basis period; a revision in months 6, 9, or 11 if the year changes shape.

## Levers

Questions to raise with the tax agent, never actions to take unaided.

| Lever | Applies when | Effect | Source |
|---|---|---|---|
| Revise the estimate in month 6, 9 or 11 | Profit is running well above or below the estimate | Avoids the underestimation penalty, or frees cash tied up in instalments | hasil.gov.my Anggaran Cukai; s107C(10) |
| Company zakat (zakat perniagaan) | The company pays zakat to a state religious authority | Deduction up to 2.5% of aggregate income | ITA 1967 s44(11A) |
| Individual zakat and fitrah | Paid to a state religious authority, receipt in the payer's name | Rebate against tax, ringgit for ringgit, capped at the tax charged | ITA 1967 s6A(3), (4) |
| Commencement date | Costs incurred before the first sales invoice | Pre-commencement costs are lost; bill early or time the costs | PR 11/2013 |
| Capital allowances | Equipment and software bought for the business | Claimed over its life instead of expensed | ITA 1967 Sch. 3 |
| Salary vs dividends from the operator's company | The operator draws money from a company they own | Salary is deductible to the company but taxed with payroll duties; dividend treatment for individuals changed from YA 2025, so confirm the current rules | Ask the tax agent |
| Personal reliefs | Resident individual | EPF/PRS, medical, lifestyle, education, spouse and child reliefs; caps change yearly, so read LHDN's current reliefs page | hasil.gov.my |
| Related-party fees | The operator's companies bill each other | Needs arm's-length pricing and transfer-pricing documentation unless exempt. The domestic exemption is lost when one party has a tax incentive or a different rate | Income Tax (Transfer Pricing) Rules 2023; Malaysian TP Guidelines 2024 |
| Tax incentives (e.g. MD Status) | The company holds an approved incentive | Qualifying income taxed at the incentive rate; keep it in a separate account | The incentive's own guidelines |
