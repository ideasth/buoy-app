# Email priority cron audit — 2026-05-08 (Item 5)

Read-only sanity check of the email priority cron (`c751741f` Email Status pull,
script in `crontracking/f04511c0/`). Source of truth for criteria: CONTEXT.md
"Email priority criteria" section.

## Method

Fetched `GET /api/email-status?limit=50` from live anchor-jod.pplx.app and
re-applied the documented criteria locally.

## Results

6 of 6 visible entries audited. **5 of 6 meet the priority criteria but are
stored with `isFlagged=0`.**

| id | sender                                                     | match reason                          | stored isFlagged |
| --:| ---------------------------------------------------------- | ------------------------------------- | ----------------:|
| 1  | tanya.hodgkinson@safercare.vic.gov.au                      | domain:safercare.vic.gov.au           | 0                |
| 2  | Hannah.Silby@monashhealth.org                              | domain:monashhealth.org               | 0                |
| 3  | medneg@medicolegalassessmentsgroup.com.au                  | no-match (see "domain edge case")     | 0                |
| 4  | Justin.Daly@monashhealth.org                               | domain:monashhealth.org, kw:ranzcog   | 0                |
| 5  | Kristen.Giersch@monashhealth.org                           | domain:monashhealth.org               | 0                |
| 6  | EpworthChiefMedicalOfficer@epworth.org.au                  | domain:epworth.org.au, kw:epworth     | 0                |

All entries received in a 4-hour window on 2026-05-07 04:00–07:00 UTC. All
updated at 2026-05-07T06:16Z (16:16 AEST) — i.e. the cron *did* run an upsert
but did **not** set `isFlagged=1` on any row that matched the criteria.

## Findings

1. **`isFlagged` is not being set on priority hits.** The cron is upserting
   email rows (timestamps prove it ran) but every priority criterion match
   results in `isFlagged=0`. Possible causes, ranked by likelihood:
   - The cron script (`crontracking/f04511c0/email_status_pull.py`) was
     updated on 2026-05-08 to remove Outlook flag/importance filtering, and
     in that edit the `isFlagged=1` write path may have been deleted along
     with the unwanted Outlook-flag dependency.
   - `is_flagged` may now be mapped to a Outlook-side boolean
     (`message.flag.flagStatus === "flagged"`) rather than to the local
     priority criteria — which is the exact behaviour CONTEXT.md says to
     stop doing.
   - Schema drift between `shared/schema.ts` (`isFlagged` integer 0/1) and
     what the cron writes (a string, an `importance` field, or a different
     column).

2. **Domain edge case.** Sender id 3 (`medicolegalassessmentsgroup.com.au`)
   contains the substring "medicolegal" in the domain itself but neither the
   subject nor body preview contains the keyword. The current criteria
   require the keyword to appear in subject or body — so the domain hit was
   missed. This is by design per CONTEXT.md, but worth noting because the
   user has an active medicolegal booking from this sender (the body
   preview includes "Booking CM: Karinna Evans, Specialist: Dr Justin Daly").
   If desired, add `medicolegalassessmentsgroup.com.au` to PRIORITY_DOMAINS
   or extend the keyword check to sender domain.

3. **No false-positives.** Zero rows had `isFlagged=1` that didn't match the
   criteria. So if the cron ever set the flag correctly, it doesn't
   over-flag.

## Recommendation (no action taken — read-only audit)

User should:
1. Open `crontracking/f04511c0/email_status_pull.py` in a fresh thread and
   confirm the `isFlagged=1` write happens on priority match.
2. If yes but rows are still 0, check that the upsert path doesn't
   `INSERT … ON CONFLICT DO NOTHING` (overwriting `isFlagged` to 0 on every
   tick).
3. Decide whether to add `medicolegalassessmentsgroup.com.au` to the priority
   domains list given the user's active medicolegal work.

I did **not** modify the cron script (standing rule: do not retune crons
without explicit approval, and that applies to script bodies too).

## Cost

Audit consumed: one curl to /api/email-status, one local Python script. No
LLM calls, no subagents. Total cost: trivial.
