# Seasonbook — Brand & Design Brief v0.1

The full rendered system (open it): **`design/seasonbook-design-system.html`**
Canonical values: `design/tokens.css` · Primary mark: `design/logo-mark.svg`

## Story
A bookend on a night shelf. The user's watch history is a **library** they own — not a feed they rent. Ember (the matured TV Time yellow) marks the page where they stopped reading. Everything in the interface asks one question: *what's next in my book?*

## Positioning vs the clone field (census, Oct 23 2026)
75 new trackers, 74 free with no revenue plan, only 2 kept spoiler-safety, none sells the refugee trio. Seasonbook's design IS the differentiator while the data layer is a commodity:

| Law | Design surface |
|---|---|
| The shelf is yours | ICS/JSON/CSV export is a *core nav item*, not an account setting; TV Time import is the empty-state CTA |
| Spoiler-safe by default | Synopsis/poster blur + lock chip until `watched` flips; emoji rule: 🔒 only ever means "watch it first" |
| Notifications that arrive | FCM topic-per-show + device reschedule; notification = `show · SxxEyy` + one fact + time offset; actions: Open / Watched / Mute |
| No ads, ever | Zero dark-pattern surfaces: no streak urgency, no confetti, no countdown-to-purchase. Priced plainly next to the export |

## Voice
Librarian, not barker. Short sentences, concrete numbers ("in 20 min", "8 episodes left"). No exclamation marks in product copy. Never: "🔥 FINALLY!!", "you won't believe", "LIMITED", "BINGE MODE". Show the next fact, not the next hook.

## System rules (design QA gate per weekend)
1. **One ember focal per screen** — the eye lands on exactly one warm thing.
2. **Blur = unwatched** — the same visual code everywhere (PWA, Android, widget).
3. **Destructive is outlined, never filled.**
4. **Numbers never jump.** Countdowns tick; nothing teleports.
5. **Silence after 22:00** — motion and badges respect quiet hours.
6. **Two-line blur rule** — no more than 2 lines of any promise-text; details live one tap away.

## Type
- **Fraunces** (serif, display) — h1, show titles, empty-state art. The "book" voice.
- **Inter** — all UI text, 16/13 body-meta.
- **JetBrains Mono** — airtimes, countdowns, codes, badges. If it can be measured, it's mono.

## Shape & motion
Radii 8/12/16/24. Durations: 120 ms taps, 240 ms sheets, `cubic-bezier(.22,1,.36,1)`. Signature gestures: ribbon-drop on "watched", page-curl pull-to-refresh, counting countdowns. Nothing else moves.

## Light mode
Deferred (v2). Dark-first ships because the emotional slot is 21:00-on-the-sofa; tokens are prepared for a paper-based light theme (`--paper-*` values exist without usage rules yet).

## Do / don't (asset-level)
- ✅ Self-drawn SVG only; no stock, no screenshots of other apps, no real network logos.
- ✅ "TV Time import" wording is fine (nominative fair use), implies no affiliation — never the wordmark next to theirs or in a logo.
- ❌ No gambling/betting adjacent palettes (gold coins, playing cards, spinning things) — instantly reads "scores app".
- ❌ No poster images from TMDB in the design-system page; only in the real product with attribution.

## Weekend mapping
- **W2 (Android):** Material You maps `ember-500` → accent (dynamic color off by default for brand discipline); widget mockup above = Glance layout target.
- **W3 (accounts):** empty-state and export surfaces already designed; onboarding = 3 slides, one minute, no email wall.
- **W4:** where-to-watch chips use `sky-400` + network dot; poster row gains TMDB art behind the same frames.
