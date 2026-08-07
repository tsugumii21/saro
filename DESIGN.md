# Design

<!-- impeccable:design-schema 1 -->

Recorded from the built system, not from intention. Where this file and the code
disagree, the code is right and this file is stale.

## Direction

**One incident is one card. SARO is the rack.**

Emergency services ran on dispatch run cards before they ran on software: one
card held one incident, carried one serial, was stamped as it moved between
racks, and was filed by a notch cut into its edge — notch position *was* the
routing. That is SARO's mechanism, already solved in card stock, and it is why
this system looks the way it does.

Seed key `129e431f`, grounded candidate 3 of 7. The contract is embedded as an
HTML comment in each app's `index.html` body and survives the production build.

**What it refuses.** The look this replaced was the civic-tech default: white
cards, a teal accent, generous rounding, a stock shield mark, eight equal-weight
tiles per screen. Also refused, deliberately, is that world's softest rendition
— manila card stock and warm cream — which is what every design tool reaches for
when handed a paper metaphor. The real system was cool card under EOC
fluorescent light.

## Tokens

All tokens live in `packages/shared/src/styles/tokens.css` and are consumed by
both apps through `@saro/shared/styles/tokens.css`. Nothing in either app
declares a colour, a font size, or a spacing value of its own.

### Colour

| Role | Token | Value |
|---|---|---|
| Canvas | `--color-canvas` | `#EDF1F6` |
| Surface | `--color-surface` | `#FFFFFF` |
| Ink | `--color-ink` | `#101725` |
| Ink muted | `--color-ink-muted` | `#4E596E` |
| Ink faint | `--color-ink-faint` | `#7C879B` |
| Printed rule | `--color-rule` | `#A9CFE3` |
| Hairline | `--color-line` | `#C6D2E0` |
| Brand (press ink) | `--color-brand` | `#1B2E6B` |
| Interactive | `--color-brand-bright` | `#3462D6` |
| **Panic** | `--color-panic` | `#E2231A` |
| Alert | `--color-alert` | `#B4460F` |

**The Panic reservation is a rule, not a preference.** `--color-panic` appears in
three places and nowhere else:

1. the Panic control
2. an active emergency
3. the leading edge of an emergency category in the Describe flow

Not on destructive buttons, not on form validation, not on overdue SLA, not on a
delete icon. Ordinary failure uses `--color-alert`, a visibly different ink.
Reuse the vermilion once for something ordinary and it stops meaning *someone is
in danger*; the Panic button then has no way to say what it is for. Any PR that
introduces `--color-panic` outside those three places is wrong.

The third place is the same meaning through a slower door — see below.

### The access edge

Category cards in the Describe flow carry a 4px leading edge that is **a
functional signal, not decoration**. It states the one rule that decides whether
the form can be submitted at all:

| Edge | Meaning | Enforced by |
|---|---|---|
| `--color-panic` + open-door icon + "No account needed" | Emergency category. Files immediately, anonymously, no login prompt ever. | `needsAccount`, the describe-flow keyword check, the anon insert policy |
| `--color-line-strong` + padlock icon + "Sign in to file" | Standard category. Requires a resident account. | the same three |

Three carriers — colour, icon shape, words — so the rule survives greyscale, a
sunlit phone and deuteranopia. The access clause is shown to guests only; a
signed-in resident can file anything, so telling them to sign in would be false.

This distinction may be restyled. It may not be removed or reduced to a single
carrier. It is the only place a resident can learn the rule before hitting it.

### Status

Six states, each anchored on the Okabe-Ito colourblind-safe set and darkened
where needed to clear 4.5:1 on white. Every state ships **colour + a distinct
icon shape + the written word** — remove colour and the icons still separate
them; remove icons and the words still do.

| State | Tab | Icon |
|---|---|---|
| Received | `#6B7684` | dashed circle |
| Assigned | `#C77700` | arrow-in-circle |
| In Progress | `#0060A9` | activity pulse |
| Resolved | `#007F5F` | check |
| Closed | `#3A4454` | archive |
| Reopened | `#9A4C86` | rotate |

Rendered only through `<StatusTag>` in `@saro/ui`. Do not hand-roll a status pill.

### Type

- **Public Sans** — UI, body, headings, labels. Drawn for the US Web Design
  System, so civic by origin rather than by association, and it holds at 13px in
  dense staff tables.
- **Atkinson Hyperlegible Mono** — every tracking code, timestamp, serial and
  numeric column. Drawn by the Braille Institute to make `1/l/I`, `0/O`, `5/S`
  and `8/B` unmistakable. This is the one typeface choice doing safety work: a
  frightened person reads a code aloud down a phone line, and an official scans
  two hundred of them.
- **Atkinson Hyperlegible** — the wordmark only.

Both families ship `latin` + `latin-ext`, verified against the served subsets:
ñ, â, á, é, í, ó, ú, à, è, ò render, so Bikol and Tagalog copy is not
second-class. Loaded via `<link>` in each `index.html`, not a nested CSS import.

Fixed scale — nothing sets an ad-hoc size: `t-display` 40/44 · `t-title` 28/34 ·
`t-heading` 20/26 · `t-subhead` 16/22 · `t-body` 15/22 · `t-body-sm` 13/19 ·
`t-label` 11 uppercase · `t-micro` 10 uppercase · `t-code-xl` 34 · `t-code` 14 ·
`t-data` 13 · `t-data-sm` 11.

### Spacing and shape

4px base grid, `--spacing-1` through `--spacing-20`. Radii are 2–4px only: a run
card has square corners and one clipped index corner. `.saro-clip` /
`.saro-clip-lg` cut that corner and recur on the report card, the Panic receipt,
the Track result and the staff login — the same object across both apps.

## Patterns

Shared components live in `packages/ui`: `Logo`, `Wordmark`, `StatusTag`,
`TrackingCode`. Shared CSS patterns live in tokens.css: `.saro-card`,
`.saro-card-tabbed`, `.saro-btn` (+ `-primary` `-secondary` `-ghost` `-sm` `-lg`
`-block`), `.saro-field`, `.saro-field-code`, `.saro-status`, `.saro-stamp`,
`.saro-ruled`.

## The mark

A filed run card with one door cut through it. The clipped top-left corner is
the index cut; the aperture is the one front door that replaced twenty hotline
numbers; because the aperture is a single tall slot it also reads as the numeral
1 — *saro* — without spelling it. One `evenodd` path, so the door is cut rather
than drawn and the mark works on any ground.

Not a shield, siren, warning triangle, exclamation mark, location pin or speech
bubble. Those are the stock parts every civic-safety product is assembled from.

**Two app icons, one family.** Resident is white-on-press-ink; Operations is
non-photo-blue on graphite. They install to different places — a phone home
screen and a pinned desktop tab — and a dispatcher confusing the two at a glance
is a real operational risk.

## Screen rules

- **The most important thing on a screen is the biggest thing on it.** Panic is
  ~half the resident home and the only saturated colour there. The queue's most
  urgent row is its first row.
- **Panic never asks anything.** Hold to fire, no category, no form, no login,
  ever. The receipt asks for detail afterwards, while help is already routing.
- **Triage order is not configurable.** The queue sorts by time-to-SLA-breach,
  unresolved first. The old sort control is how the most urgent report reached
  page three.
- **One layout per screen.** The old dashboard's split/table/map switcher meant
  no layout had been designed. The map is a detail panel, not a rival view.
- **Density is a feature on the staff side** — 44px rows, tabular numerals,
  hairline rules, no zebra striping (the printed ruling does that job).
- **Calm on success.** No celebration, no green-tick theatre. Someone is still
  in trouble.

## Light only

There is no dark theme, and that is a decision rather than an omission. Write
the scene: a resident outdoors in Legazpi daylight or rain, and an official
under office fluorescents. Neither is a dark-room scene.

## Known gaps

- Screens converted to the system and re-hierarchised, but not individually
  re-composed from scratch: `ReportFormScreen`, `PublicMapScreen`,
  `AssistantScreen`, `LandingPage`, `AdminDashboard`. They are consistent and
  correct; they are not as considered as the Panic screen, Track, the queue and
  the shells. `ReportFormScreen`'s category list is the exception — it was
  rebuilt when the access edge was formalised. The rest of that file (search
  field, filter pills, location and photo sections) still carries `text-xs`,
  `rounded-full` and its original three-section stack.
- 10 ESLint warnings remain, all `react-hooks/set-state-in-effect` or
  `react-refresh/only-export-components`. Zero errors.
- No screenshot pass was run: this environment has no browser, so the build was
  verified by compilation, lint, and a static token audit rather than by looking
  at it.
