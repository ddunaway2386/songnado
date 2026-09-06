# App privacy nutrition label — SUPERSEDED

**Do not fill the App Store Connect form from this file.**

The previous contents of this document answered *"Does this app collect
data?"* with **No**, and listed crash reporting as a hypothetical that
*would* force a change. Sentry was added after it was written, so that
answer became false while the document still read as authoritative — and
it was the document that said "mirror this into App Store Connect".

**The correct answers live in [`app-store-checklist.md`](app-store-checklist.md)
under "Privacy nutrition label".** In short:

- **Diagnostics → Crash Data** — collected, not linked to identity, not used
  for tracking
- **Diagnostics → Performance Data** — collected, same treatment
- Everything else (teams, scores, pack choices, custom playlist URLs) is
  local-only AsyncStorage and is **not** collected
- No tracking, no ad identifiers, no analytics beyond Sentry

The published policy at
<https://ddunaway2386.github.io/songnado/privacy/> was corrected to match
on September 6, 2026. The form, the policy and the reviewer notes must all
agree — an inaccurate label is a rejection before launch and a removal
path after it.
