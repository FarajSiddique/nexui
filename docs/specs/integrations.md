# Nexui integrations and device capabilities

**Status:** proposal for review, 26 September 2026. No code yet. This spec expands
[anchored-intelligence.md](anchored-intelligence.md) §5.11 and replaces its per-integration
table. The roadmap keeps the principle and the phase for each integration; this file holds the details.

> Nexui reimagines the mobile interface around human intent, using AI to surface the right
> action at the right moment—without making users navigate, prompt, or think like a computer.

Integrations are how Nexui learns about "the right moment". Its own data only covers what the
user typed. The phone knows where they are, who they know, what's already on their calendar,
and what they're looking at in another app.

## Selected set

| Capability                                           | What it unlocks                                                       | Where the data lives                         | Phase (proposed) |
| ---------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------- | ---------------- |
| **Place reminders** (background location)            | "Remind me to buy milk at the grocery store"                          | Device. Saved places on the server           | 2                |
| **Contacts**                                         | "Sam" resolves to a real person; person candidates for §5.10          | Device only                                  | 2                |
| **Apple Calendar and Reminders** (Android: Calendar) | Useful on day one; real free/busy for `FREE_WINDOW`                   | Device only                                  | 2 → 3            |
| **Share sheet**                                      | A screenshot, link or message becomes a draft without retyping        | Shared content is sent once to `/api/intent` | 3                |
| **Live Activities**                                  | The next event or the list for your current place, on the lock screen | Device                                       | 3                |
| Google Calendar                                      | The same as Apple Calendar for Google users; writes from the server   | Server, OAuth                                | 3                |
| Gmail, Slack                                         | "Waiting on you" signals and tier-3 drafts                            | Server, OAuth                                | 4                |

**Why the phases changed:** the roadmap put Contacts and EventKit in Phase 3 together with
Google Calendar. The reason for Phase 3 was Google verification, which needs a domain that
Nexui doesn't have. On-device capabilities have no such blocker. They need a development
build (`expo-dev-client` is already set up) and the platform permission prompts. That means
they can ship as soon as the core loop is ready for them. Google, Gmail and Slack keep their phases.

## Rules for every integration

These add to the cross-cutting rules in anchored-intelligence §3.

1. **Ask when the user's words need it.** Never ask for permissions during onboarding. The
   location prompt appears the first time someone types a place reminder, and the Contacts
   prompt the first time a name can't be resolved. The explanation shows the user's own
   sentence: "To remind you _at the grocery store_, Nexui needs your location."
2. **A refusal is never a dead end.** When a permission is denied, the action still saves in
   a weaker form, and the card says what's missing: "Saved. Nexui can't remind you there
   without location · Turn on". This is the §3.4 rule of showing less when confidence is low.
3. **Send signals, not raw data.** The model and the server get the smallest label that does
   the job: a place ID and `arrive`, a contact's display name, a free window. They never get
   coordinates, a location history, an address book, or calendar details they don't need.
4. **The model picks, the device gets the data.** Jev chooses among candidates (saved places,
   place categories, matching contacts) and never writes a coordinate, phone number or
   address. The pattern follows §5.11's Apple row: the phone sends only the candidates a
   request needs.
5. **Tiers still apply (§3.6).** Reading is tier 0, a reminder inside Nexui is tier 1, and
   writing to Apple Reminders or a calendar is tier 2.
6. **Every integration can be disconnected** from Profile → Connections, and disconnecting
   removes what Nexui cached from it.

## Place reminders

The goal: you type "get milk and eggs at the grocery store" once, and your phone tells you
when you walk into a grocery store. This is the clearest case of "the right action at the
right moment", and generic to-do apps rarely get it right.

### What the user sees

```text
+ sheet   "get milk and eggs at the ▌grocery store▐"
Card      Create task · Milk and eggs
          WHEN   Arriving at any grocery store
          [ Add task ]  Edit
Arrival   🔔 At Trader Joe's · Milk and eggs, batteries        [Done] [Open]
In app    Focus: "At Trader Joe's · 2 items"   ▌You're here▐
```

- **Arrive or leave.** "When I leave work, call mom" fires on exit.
- **Specific place or category.** "At Trader Joe's on Market" is one place. "At the grocery
  store" means any grocery store, and it's what people usually say.
- **One alert per place per visit.** Every open item linked to that place or category shows
  in one notification, so there's never a pile of separate ones. A place waits an hour after
  it fires before it can fire again.
- **Done from the notification.** The Done action completes every item in the alert, and
  Undo lives in the app.
- **When the app is open at the place**, the Focus card shows the `AT_PLACE` kind with the
  reason code `{ code: 'AT_PLACE'; place: string }`.

### What Jev decides

- **A new `place` entity on `CREATE_TASK`**, not a new intent. This follows §5.6: fewer
  intents keep the classifier accurate. Spans include "at the grocery store", "next time I'm
  at Target", "when I leave work" and "when I get home".
- **Candidates:** the user's saved places (Home, Work, Trader Joe's Market St), a fixed list
  of categories (`GROCERY`, `PHARMACY`, `HARDWARE`, `POST_OFFICE`, `GAS`, `GYM`, `OFFICE_SUPPLY`),
  and, when the phone ran a search, the names of up to five nearby matches. Jev picks one or
  `none`, and also picks `arrive` or `leave`.
- Jev never produces coordinates. Unknown places ("at Ana's") ask with the existing picker
  flow, where "Search places" and "Use current location" are the manual paths.

### How it runs on the phone

- **Regions are registered on the device.** iOS allows 20 monitored regions per app and
  Android about 100. The phone registers specific places first, then the nearest stores for
  each active category. It refreshes the set after a significant location change.
- **Current location never leaves the phone.** The server stores saved places (label,
  coordinates, radius), which the user chose deliberately, much like an event location. It
  never stores where the user is or has been. `activity_events` gets `PLACE_TRIGGERED` with
  the place ID only.
- **Delivery is a local notification** fired by the phone. No server push is needed, so this
  doesn't conflict with §6's deferral of push for AI suggestions: the user asked for these
  reminders.
- **Category matches** come from an on-device point-of-interest search (MapKit on iOS, which
  is free and needs no key). Android needs a Places provider; pick one in the spike.

### Permissions

| Step                 | iOS                                                                                                       | Android                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| First place reminder | While Using, then the Always upgrade prompt                                                               | Foreground location, then a separate background location request that takes the user to Settings               |
| Precise location off | Geofences become unreliable. The card says so and offers to turn precise location on                      | Same, with the approximate location setting                                                                    |
| Denied               | The task saves with the place as a label and no trigger. The card says "Won't remind you there · Turn on" | Same                                                                                                           |
| Store review         | Purpose strings for While Using and Always; App Review checks them                                        | Google Play's background location declaration: a form and a video showing the feature. Allow time for approval |

**To evaluate in the spike:** iOS `UNLocationNotificationTrigger` can deliver a location
notification without the Always permission. The cost is that the notification text is fixed
when it's scheduled, so the phone has to reschedule whenever the list for that place changes,
and category matching still needs background refreshes. `expo-notifications` doesn't expose
this trigger, so it would need a small native module.

**Considered and rejected:** writing location alarms into Apple Reminders so that iOS does
the monitoring. It makes Apple Reminders the owner of the item (tier 2 every time), doesn't
work on Android, and Nexui couldn't show the `AT_PLACE` Focus card.

### Data

```text
places(id, user_id, label, kind: 'specific' | 'category', category, latitude, longitude,
       radius_m, source: 'search' | 'current_location', created_at)   owner-only RLS
tasks  + trigger_place_id → places.id, trigger_on: 'arrive' | 'leave'
```

A category trigger points to a `places` row with `kind: 'category'` and no coordinates, so
"any grocery store" is saved once and reused.

### Limits to be honest about

- Arrival can be detected a minute or more late. The effective radius is about 100–150 m,
  so neighboring stores in a dense mall can be confused.
- iOS stops monitoring for an app the user force-quits from the app switcher, until it opens again.
- If Background App Refresh or Low Power Mode is on, category refreshes happen less often.
  Specific places keep working.

### Validation

- Eval fixtures for place spans, categories, `arrive` vs `leave`, and negatives ("I'm at the
  store, call me" is not a place reminder).
- Test the region-selection function in isolation: nearest first, specific places before
  categories, never more than the platform cap.
- `security-reviewer` checks that no coordinates or location history reach logs, the model or
  `intent_events.raw` beyond what the user typed.
- A manual smoke test on a physical device: arrive, leave, denied, precise off, force-quit.

## Contacts

- **Unlocks:** person resolution for §5.10 People and follow-ups, and person-triggered
  reminders ("ask Sam about the lease when I see him" fires before the next event with Sam).
- **Flow:** the phone finds contacts whose names match tokens in the text and sends only those
  display names as candidates. Jev picks one or `none`. When the user confirms, the draft
  stores the display name and the device-local contact ID.
- **Permission:** asked the first time a name doesn't resolve against §5.10's people list.
  iOS 18 lets the user share only some contacts, so a limited grant is the normal case. The
  card offers "Choose contact" when there's no match.
- **Server:** never gets the address book. It stores only names already on confirmed items,
  as it does today.
- **Library:** `expo-contacts`.

## Apple Calendar and Reminders (Android: Calendar)

- **Unlocks:** real free/busy, which makes `FREE_WINDOW` reasons with `source: 'calendar'`
  trustworthy (§3.3). Coming Up and the Calendar tab show the user's existing events. Existing
  reminders can be imported on day one, so the app is useful before the user types anything.
- **Reads first (Phase 2):** the phone reads events for the next 14 days and computes free
  windows locally. It sends only the windows or the matching event titles that a request needs.
- **Writes later (Phase 3):** create, move or complete through EventKit, always tier 2 with
  the destination on the card (§5.7).
- **Reminders import:** one-time and user-started ("Import 23 reminders from Apple
  Reminders?"). Nexui becomes the owner afterward, with no ongoing two-way sync (§5.11,
  "write through, read on demand").
- **Permissions:** iOS 17 splits calendar access into write-only and full access. Reading
  free/busy needs full access. Reminders is a separate prompt. Android reads calendars through
  `CalendarContract` and has no system reminders app.
- **Library:** `expo-calendar`, which covers events on both platforms and reminders on iOS.

## Share sheet

- **Unlocks:** capture from any app. Shared text, links and message threads go through the
  normal Magic Bar path. A shared restaurant link becomes "try this place", and a message
  saying "I'll send it Friday" becomes a task.
- **MVP:** the share extension opens Nexui's + sheet with the shared text already in it, so
  the user sees the usual draft card. This avoids running the API inside the extension, which
  would need the session shared across an App Group.
- **Later:** a compact draft card inside the extension itself, and images (flyers, tickets),
  using on-device OCR to turn them into text before the same `/api/intent` call.
- **Security:** shared content comes from another app and is untrusted. It reaches the model
  as user text inside the existing prompt boundary and is never treated as instructions. Cap
  its length as for typed input. `security-reviewer` should check this.
- **Library:** a share extension config plugin (for example `expo-share-intent`). Verify it
  supports Expo SDK 57 in the spike.

## Live Activities

- **Unlocks:** the right action on the lock screen without opening the app.
  - An event starting soon: "Design review · in 12 min · Room 4".
  - At a place: "Trader Joe's · 2 items", with a check button for each (interactive through
    App Intents, iOS 17+). It ends when the user leaves the region or after an hour.
- **Rules:** started only by an event the user saved or a place reminder they set, never by a
  suggestion (the §6 deferral). One activity at a time, and the user can turn each kind off
  in settings.
- **Platform:** iOS only in the MVP. Android 16 has a similar feature (Live Updates, built on
  ongoing notifications), to evaluate later.
- **Build:** needs a widget extension target written in Swift, added through a config plugin.
  This is the same target home-screen widgets would use later.

## Cloud accounts (unchanged from the roadmap)

| Integration     | Reads                                            | Writes                              | Blocker                                                                                                                        |
| --------------- | ------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Google Calendar | Events and free/busy for 14 days; meeting links  | Create or move events (tier 2)      | `calendar.events` is a sensitive scope: Google app verification, which needs a domain. Offline access needs a server auth code |
| Gmail           | Metadata for threads waiting on the user's reply | Drafts only (tier 3)                | Restricted scopes: verification plus an annual security assessment                                                             |
| Slack           | Direct messages and mentions waiting on a reply  | Draft or scheduled message (tier 3) | Slack app OAuth, user token                                                                                                    |
| Notes apps      | –                                                | –                                   | Apple Notes has no public API. Notion or Google Docs only if users ask                                                         |

External OAuth tokens are stored encrypted on the server and never reach the phone or a
public env variable.

## Later and not possible

**Later, when a feature needs them:** Siri and App Intents (say "tell Nexui…"; Shortcuts
automations such as "CarPlay connected" can call Nexui as a trigger), home-screen widgets
(reuse the Live Activities target), Core Motion (don't interrupt while driving), HealthKit
sleep (a coarse "short night" label only, strictly opt-in), and voice input.

**Not possible on iOS, so don't design around them:** reading SMS or iMessage, reading other
apps' notifications, and reading raw app usage (Screen Time doesn't expose it). Android allows
some of these; treat them as Android-only extras at most.

## Order of work

1. **A spike on a physical device:** region monitoring with `expo-location` and
   `expo-task-manager`, the region-selection function, a local notification on arrival, and
   the `UNLocationNotificationTrigger` comparison. It decides the Always-versus-While-Using
   question.
2. **Place reminders:** the `place` entity, the `places` table, permissions, notifications, and the `AT_PLACE` Focus kind.
3. **Contacts**, together with §5.10 People.
4. **Calendar read and the Reminders import.**
5. **Share sheet MVP.**
6. **Live Activities**, starting with the place list, which builds on step 2.

## Open questions

- Is a place trigger a field on `CREATE_TASK` (proposed), or should the Phase 2
  `CREATE_REMINDER` intent cover both time and place? Proposed: a trigger field on tasks
  handles both, and `CREATE_REMINDER` is dropped.
- Which Places provider on Android: Google Places (billed per call) or a free alternative?
- Should the category list be fixed as above, or grow from what users actually type (from `intent_events`)?
