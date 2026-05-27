// fma.ts — Free Music Archive: intentionally NOT implemented.
//
// FMA was on the build list, but it has no usable public API. Per their own
// "App developers" page (freemusicarchive.org/app-developers, verified
// 2026-05): they shut down their API due to server load, they forbid
// hotlinking their hosted audio, AND they forbid forwarding user searches to
// their search engine + scraping the HTML results without explicit approval
// ("we will block those requests").
//
// So there is no legitimate programmatic path without a partnership + self-
// hosting the audio. We deliberately do NOT ship a scraping adapter — it
// would violate their terms and get blocked. This module exists so the next
// person doesn't re-investigate, and so the UI can show *why* FMA is greyed
// out instead of silently dropping it.
//
// If we get FMA approval (or pivot the 4th slot to ccMixter / Pixabay), this
// is where the adapter goes.

export const FMA_UNAVAILABLE_REASON =
  'Free Music Archive has no public API — they shut it down and prohibit '
  + 'hotlinking and search scraping without partnership approval.';
