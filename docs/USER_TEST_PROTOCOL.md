# Real-user validation protocol

**Status: pending real participant evidence.** No participant counts, completions, preferences, or retention outcomes may be inferred from automated tests, developer walkthroughs, simulated users, or the existence of this protocol. No recruitment or participant contact is authorized by this document.

The intended participant is a self-directed investor holding US-listed ETFs who considers allocation changes at a monthly or quarterly review. Participation must be voluntary. Use participant IDs in notes; do not collect brokerage credentials or account numbers. Recording or retaining personal data requires explicit participant consent. Participants may use rounded amounts or weights when those suffice.

## Stage 0: five-person own-data entry gate

Prerequisite: a functioning import-to-result prototype, sample file-format instructions, clear rights declarations, and a way to preserve holdings while market data are missing. A clickable mockup cannot satisfy this gate.

Task: starting from the homepage and their own holdings, obtain suitable permitted market data, enter portfolio A, create proposed B, and produce a valid labeled comparison. The timer starts before data acquisition or provider setup; do not start only after a researcher has prepared clean CSV files. A trial passes only if the participant reaches a valid result within 15 minutes **without developer assistance**. Record acquisition time separately but include it in total time.

For each participant record ID, device/browser, input method, data source and rights basis, number of noncash positions, missing/unsupported positions, start/end times, assistance given, validation failures, result validity, and abandonment reason. Do not retain raw holdings unless separately permitted. Invalid output, silently dropped holdings, or misunderstanding a synthetic result as real data is not successful completion.

Gate: at least 4 of 5 participants pass. Preserve all trials, including failures and repeated attempts; report first-attempt results separately. Missing evidence is pending, not zero participants and not a failed gate.

## Stage 4: twelve-person competitor comparison

Prerequisite: stages 1–3 engineering and recovery checks have passed with versioned evidence. Choose a real accessible comparison tool whose features match the task; archive the exact public methodology URL and access date. Avoid comparing a free task with a competitor feature that was unavailable to that participant.

Use a counterbalanced order: six participants use this product first and six use the comparator first. Alternate portfolio scenarios or randomize within a documented schedule to limit learning effects. Give both tools equivalent instructions, data access, and time limits. Do not coach one tool more than the other.

Tasks: make an A/B allocation comparison, identify the changed risk contributor and a historical tradeoff, explain fee and date assumptions, and save a reason for the decision. Ask the participant to explain whether the chart represents their actual account performance or a hypothetical replay. Record their own words before prompting.

Record completion, time including setup, errors, assistance, comprehension, severe misconceptions, stated preference, and the participant's reason. Predefine what constitutes a correct answer and a severe misconception. Do not change scoring after seeing results.

Gate: at least 10/12 complete, at least 10/12 correctly explain hypothetical versus actual returns, and at least 8/12 prefer this product with recorded reasons; no severe misconception remains unresolved. Report denominators, missing observations, and counterbalance groups. This is a small usability study, not statistical proof of superiority.

The [testfolio methodology](https://testfol.io/guides/portfolio-backtester/) uses its documented rebalance-close convention. This product's next-session-close convention may differ. Record such differences instead of treating unequal numerical results as an implementation defect without checking timing, prices, cash, and fees.

## Stage 6: four-week repeat-review signal

After a participant completes an initial review, observe whether they voluntarily return to perform a second review with a concrete reason and save the new rationale. Opening a page or responding to a reminder alone is not a repeat review. Identify whether their normal review frequency is monthly or quarterly before evaluating return behavior.

Initial signal: at least 4 of the 12 participants perform a reasoned repeat review within four weeks. Preserve the dates, reason, and enough consented evidence to distinguish an actual review from an intention. Report quarterly-review participants separately; four weeks of non-return may not mean rejection for them. User reminders, if later explicitly authorized, must be recorded because they affect interpretation.

No expansion claim should precede 25–50 real trial feedback records. A future 500-concurrent-user infrastructure exercise is a separate authorized load test and cannot substitute for any participant gate.

## Evidence table template

| Participant ID | Stage/version | Start/end | Own data and rights | Device/browser | Assistance | Outcome | Comprehension/reason | Evidence and consent |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| _Pending_ | | | | | | | | |

Keep the template empty until real evidence exists. Redact personal information from any publicly shared study summary.
