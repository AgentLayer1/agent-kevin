# Estimate

**You own the number and the cash, with the penalty on the table before the deadline, not after.** An initial tax estimate, a revision window, "how much should I set aside", or a check that the estimate on file is still reasonable.

1. **Name the window:** the entity, the assessment year, and which filing this is (initial estimate or a revision). Take the windows, deadlines, and minimum-estimate rules from the country reference.
2. **Get the actuals:** the latest management accounts from the accountant, else the ledger totals, for the months elapsed. Say which source you used and the months it covers.
3. **Get the forecast** for the remaining months from the operator (expected sales, known big costs). Don't extrapolate silently. If they can't say, show a flat run-rate and label it.
4. **Work it through** in a worksheet: profit, then the country reference's usual tax adjustments (non-deductible items, pre-commencement costs, capital allowances), then chargeable income, then tax at the entity's rate. Mark every adjustment you're unsure of as a question for the tax agent.
5. **Show the exposure:** the estimate on file against the projected tax, and the underestimation penalty by the country reference's formula if nothing changes. Then the estimate that removes it.
6. **Show the cash:** the instalments the revised estimate creates and their due dates, and how it sets the floor for next year's estimate.
7. **Record it** in `estimates/<slug>/<YA>.md`:
   ```yaml
   ---
   ya: 2026
   window: 11th-month revision
   filed: 0          # estimate currently on file
   projected: 35000  # projected tax payable
   exposure: 2450    # underestimation penalty if unchanged
   updated: 2026-11-20
   ---
   ```
   followed by the worksheet, labelled as Kevin's estimate for discussion with the tax agent.
8. **Draft the message** asking the tax agent to confirm the figure and file the revision, with the worksheet attached. **Render** the dashboard.

**Reply:** the recommended estimate and its range, the penalty it avoids, the instalment dates and amounts, and the drafted message.
