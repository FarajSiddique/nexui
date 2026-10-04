# Roadmap ideation handoff: next use cases and travel data

**Status:** working notes from a product-strategy conversation on 2026-10-04. Nothing here is
an approved spec. Use it to keep thinking about the roadmap with the founder: push back,
sharpen, and turn agreed points into specs.
**Read first:** `docs/superpowers/specs/2026-09-27-intent-graph-design.md` (the product model
and slice plan) and `docs/architecture/intent-graph.md` (what exists today).

## How to use this doc

You're picking up a back-and-forth about roadmap impact. Each point below is labeled:

- **Agreed:** the founder said yes. Build on it.
- **Leaning:** recommended and well received, but not confirmed. Re-check before relying on it.
- **Open:** still undecided. These are the most useful things to work through.

Challenge any reasoning that looks weak. The goal is a better roadmap, not defending these notes.

## 1. The core problem: Nexui only gets used when someone has a project

The vision is a general planning app: plan anything. Slice 1 is travel. The spec's slice 2 is
job search. The founder's worry is that both happen rarely, so neither gives people a reason to
come back often.

Key framing from the conversation:

- **How often the need comes up is a different thing from how often someone opens the app while it's going on.**
  Travel happens a few times a year, but you check a plan several times a day during a trip. A
  job search happens every few years, but you check it daily for 2–6 months.
- Today every intent is a one-off project. You set a goal, Nexui builds the graph, you edit it,
  and then it goes quiet. Nothing in the product brings people back when no project is active.
- Three ways to fix that, which work together:
  1. **A use case that repeats on a cycle** (weekly or daily).
  2. **Plans that stay alive longer.** Before, during and after a trip, plus outside events
     (the spec already plans an `ExternalEvent` input with Jev deciding what to surface).
  3. **Breadth as the habit.** Many occasional plans add up to frequent use. That depends
     on the `thing` fallback kind producing good results for arbitrary goals.

## 2. Candidate use cases considered

| Use case                          | How often               | AI value                                               | Reuse of current code                               | Main risk                                             |
| --------------------------------- | ----------------------- | ------------------------------------------------------ | --------------------------------------------------- | ----------------------------------------------------- |
| Weekly meal plan + grocery list   | Weekly, forever         | High: diet, budget, time and pantry constraints        | Good: groceries are derived from meals, like `derive.trip` | Busy market; needs checkboxes                         |
| Local outings / weekends          | Weekly-ish              | Medium-high                                            | Very high: place, leg, map and place photos         | Travel at a smaller scale; doesn't show the app is generic |
| "My week" planner                 | Daily                   | Medium                                                 | Low: needs calendar integration                     | Turns into the deleted Tasks/Calendar; Motion, Sunsama |
| Training plan (marathon, gym)     | Daily check-ins         | High at creation, then adapting                        | Medium                                              | Mostly logging; Runna and similar are strong          |
| Hosting / events                  | Monthly-ish             | Medium-high                                            | Medium                                              | Still a one-off project                               |
| Study / learning plan             | Daily                   | Medium-high                                            | Medium                                              | Mostly suits students                                 |
| Job search                        | Daily for 2–6 months    | High: tailoring, prep, follow-ups                      | Planned in spec (slice 2)                           | Becomes a manual tracker without automation; usage drops off once they're hired |

## 3. Decisions and leanings

### Agreed: weekly meal planning + grocery list is the next slice

Why it fits:

- It repeats every week with no end date. That's the property travel and job search lack.
- The AI has a real job: a constraint problem, not just generating text.
- The grocery list derived from meals mirrors the existing derive pattern (`derive.trip`, insights
  with actions, one changeset so Undo covers everything).
- It's an everyday need, so it shows Nexui isn't only a travel app.

It would force three gaps into the open. These are the real reasons it's a good architecture test:

1. **Repeating cycles.** An intent today is one goal with one graph. A weekly plan needs a
   rolling week, or a new instance each week that carries forward what worked.
2. **Preferences that span plans.** Diet, household size and dislikes shouldn't be re-entered
   per plan. The same layer helps travel ("I travel slow") and the general vision.
3. **Completion state.** The intent-graph spec says "No task or checkbox appears anywhere." A
   grocery list needs one. **Open:** is a done state on items acceptable, or does it go against the
   design principle? What's the smallest version that works?

### Agreed: job search stays as a fast follow

The founder liked the point that a job search means daily use for months. Shaping notes:

- The reason to open it daily is that the world changed. Without automation it turns into a manual
  tracker (Huntr and Teal already exist). In the first version the daily pull comes from Nexui itself:
  - Follow-up reminders based on dates, for example "applied 8 days ago with no reply". This
    becomes an insight with a drafted follow-up, using the same pattern as trip insights.
  - `web.search` turns up new matching roles.
  - Tailored materials and interview prep for each opportunity.
- Inbox and calendar integration is the bigger step up later. It brings OAuth, privacy work,
  and the approval rule for anything that leaves Nexui (sending email). Not in the first version.
- **Usage drops off once they're hired.** Shipping meal planning first means people are already in a
  recurring plan when their search ends.
- **Build order (leaning):** meal planning first builds preferences, done state and cycles.
  Job search reuses them as profile/resume, application stages and follow-up timing, and adds
  pipeline, outside events and `web.search`. Write the job search spec now so it shapes the shared
  pieces, and build it after meal planning lands.
- The spec's slice-2 rule still applies: new kinds, primitives, a template and
  capabilities, but **no new tables and no new screens**. Meal planning may test that rule too
  (cycles and preferences might need storage). **Open:** does either slice break it, and is that
  fine?

### Leaning: local outings as a cheap template variant of travel

Mostly a template and prompt change on top of the existing travel kinds, map and place photos.
A near-free boost to usage while meal planning is built. Not confirmed.

### Leaning: travel stays on deep links, no paid price APIs for now

Question asked: should we pay for live flight, hotel and activity data, or just deep link out to
other sites (free)? Recommendation, which the founder hasn't contradicted but also hasn't
explicitly confirmed:

- **Don't pay for live prices yet.** Nexui's edge is the plan that reasons about itself, not inventory.
  Price search is a game Google Flights, Kayak and Booking already win. Exact prices matter only
  when booking, which happens on their site anyway. Per-search cost and integration upkeep would
  pull effort away from the slices above.
- **Do (free):**
  - Pre-filled deep links: Google Flights, Skyscanner and Kayak for flights; Booking.com and
    Airbnb for stays.
  - Price estimates shown as labeled ranges ("Estimated $700–900 · check live prices →").
  - Price-range checks in `pnpm eval:travel`.
  - Weather (Open-Meteo), public holidays (Nager.Date) and exchange rates (Frankfurter).
  - Affiliate codes on deep links (Booking.com / Travelpayouts programs, no API needed), plus an FTC disclosure.
  - Logging deep-link taps.
- **Revisit paid APIs when:** many people tap the deep links, users keep asking for real prices or editing the AI's
  estimates, evals show estimates are badly off, or affiliate revenue becomes a real plan.
- **Architecture fit if/when built:** `flights.search` / `stays.search` / `activities.search`
  capabilities; results become `option` objects under a `decision` (max 12 `metrics`); store a
  checked-at timestamp and show "as of"; hand-off is a user-tapped link action, so it doesn't trigger
  the approval rule.

Provider landscape, checked 2026-10-04. Re-check before building:

| Provider                        | Status                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Duffel (flights)                | Self-serve and live. Built for booking: $0.005 per search beyond 1,500 searches per booking. Check display-only terms. |
| Travelpayouts (flights, hotels) | Affiliate model, cached prices, API free but approved case by case.                                     |
| SerpApi (Google Flights/Hotels) | Rich data quickly. Works by scraping Google, so a legal/terms risk at scale.                            |
| Booking.com affiliate           | Most realistic real hotel source; commission; reportedly no minimum booking volume.                     |
| Viator / GetYourGuide           | Activity affiliate APIs, content-only with booking redirected to them. Closest fit to the hand-off model. |
| Amadeus Self-Service            | Shut down 2026-07-17; enterprise-only now.                                                              |
| Kiwi Tequila                    | Invite-only since 2024.                                                                                 |
| Skyscanner Travel API           | Only for large established partners.                                                                    |
| Expedia Rapid                   | Requires a commercial agreement; aimed at travel agencies and booking platforms.                        |

## 4. Suggested sequence (leaning)

1. **Now, low cost:** travel deep links, weather, holidays, exchange rates, tap logging, price-range evals.
   Apply to the affiliate programs (approvals take time). Optionally the local-outings template.
2. **Meal planning slice:** cycles, preferences, done state, derived grocery list.
3. **Job search (fast follow):** pipeline, date-based follow-up insights, `web.search`, tailored
   materials. No inbox integration.
4. **Later:** inbox and calendar as the outside-events input. Also benefits travel (bookings, flight
   changes).

## 5. Open questions to work through

- **Validation before building:** log the goal text people type into + and how often it falls
  back to `thing`. Even a few friends using it for two weeks beats analysis. What's the
  cheapest way to start collecting this?
- **Cycles model:** one long-lived intent with a rolling window, or a new intent per week
  that copies forward? How do Home, Changes and Undo behave across weeks?
- **Preferences layer:** where does it live (per user, per kind of plan), how does the AI read it,
  and is it editable like the graph (changesets, Undo)?
- **Done state vs. the "no checkbox" principle** (see section 3).
- **Does the `thing` fallback deliver "plan anything"?** If breadth is the habit, the quality of a
  plan for an arbitrary goal may matter more than any one template.
- **What is the "Today" view?** If several plans are live, does Home need a cross-plan surface
  (today's meals, follow-ups due, trip tomorrow) to drive daily opens?
- **Monetization:** affiliate links on travel; does anything in meal planning (grocery delivery
  hand-off) or job search map to revenue?
- **Competitive check:** what makes Nexui's meal planning clearly better than Mealime or
  Paprika plus ChatGPT, and its job search better than Huntr or Teal?

## 6. Code pointers

- Product model and slice plan: `docs/superpowers/specs/2026-09-27-intent-graph-design.md`
  (section 0 decisions, "Slice 2: job search", section E capabilities).
- Kinds registry: `packages/types/src/kinds/registry.ts`; travel kinds in
  `packages/types/src/kinds/travel.ts` (`decision`, `option`, `insight` with actions).
- Derivation pattern: `apps/api/src/lib/kinds/trip.ts`, `apps/api/src/lib/templates/derive.ts`.
- Templates: `apps/api/src/lib/templates/`.
- Place photos and details spec (the Wikipedia-backed `place_media` cache):
  `docs/superpowers/specs/2026-10-04-place-photos-and-details-design.md`.
- Travel evals: `pnpm eval:travel`.

## Sources (provider landscape)

- Duffel excess search: https://help.duffel.com/hc/en-gb/articles/4412912264466-What-is-Excess-Search
- Amadeus Self-Service shutdown, Kiwi Tequila: https://teenvaai.com/blogs/amadeus-alternatives-travel-businesses-2026
- Skyscanner API access: https://supergood.ai/api-report-card/skyscanner-api
- Travelpayouts hotel API: https://support.travelpayouts.com/hc/en-us/articles/203956133-Hotel-search-API
- Booking.com affiliate / hotel APIs: https://www.oneclickitsolution.com/blog/top-hotel-booking-apis
- Expedia Rapid: https://www.zentrumhub.com/blog/expedia-rapid-hotel-api-integration/
- Viator affiliate: https://partnerresources.viator.com/travel-commerce/affiliate/
- GetYourGuide partner API: https://github.com/getyourguide/partner-api-spec
- SerpApi Google Flights: https://serpapi.com/blog/tag/google-flights-api
