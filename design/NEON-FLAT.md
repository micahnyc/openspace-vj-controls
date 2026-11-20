# Neon Flat

Neon Flat is the visual language of OpenSpace VJ Controls: flat black panels, square edges, and a few loud colors that each mean one thing. It should feel like show hardware: an instrument rack in a dark room, readable at a glance from a meter away.

## Influences, and the line we don't cross

Neon Flat borrows *traits*, never assets:

- **Late-90s / Y2K graphic design and current "graphic realism" game UI:** flat fills, acid accents on black, strong type statements, index numbers and technical micro-labels.
- **Anime mecha command-center screens:** tall condensed display type, hazard stripes, warning panels that read as alarms, orange as the color of danger.
- **Classic desktop media-player skins:** segmented LED meters, spectrum bars, monospaced readouts, dense compact controls.

We never copy logos, wordmarks, characters, proprietary fonts or recognisable screens from any of these. If a screen could be mistaken for a specific game, show or app, it's wrong.

## Principles

1. **Flat.** No gradients, no glow, no drop shadows, no blur. Depth comes only from the three surface steps: `ground`, `panel`, `raised`.
2. **Square.** `radius-0` everywhere. `radius-1` only on meter segments and pads; `radius-pill` only on status lights and beat dots.
3. **Color is a signal.** Each accent has one job. `midi` (palette slot 1) marks MIDI and selection, `bpm` (slot 2) marks beat and tempo, `audio` (slot 3) marks EQ and level. `warn` is orange and only ever means "something is wrong".
4. **Black, then ink, then color.** Most of the screen is `ground` and `panel`; text is `ink`; accents cover well under 10% of any view.
5. **Numbers are instruments.** Values, BPM and MIDI addresses are always in `mono` with tabular figures, never in the sans.

## Color

Neutrals are fixed. The accents come from the **show palette**: 4 to 16 colors, chosen per show (see the Palettes section). The default palette is Acid.

| Token | Use |
| --- | --- |
| `ground` #0A0B0A | Page background |
| `panel` #141714 | Panels, grouped areas |
| `raised` #1F231F | Inputs, rows, buttons at rest |
| `rule` #2A2F2A | Decorative dividers only |
| `line` #6F796F | Control borders (3.5:1+ on every surface) |
| `ink` / `ink-muted` | Text, secondary text |
| `midi` / `bpm` / `audio` | Role accents, aliased to palette slots 1–3 |
| `warn` #FF6A1A | Fixed danger color, outside every palette |
| `on-accent` | Text on any accent fill: always `ground` |

Rules:
- Text on an accent fill is always `on-accent` (black), never white.
- Accent-colored text is allowed on `ground`, `panel` and `raised` because every palette slot must reach 4.5:1 on `raised`.
- `warn` never appears without a label, an icon or hazard stripes, so it reads without color vision.

## Type

All faces are free Google Fonts.

- **Display**, Big Shoulders Display 800, uppercase: screen and panel titles. Tight leading (0.92).
- **Condensed**, Barlow Condensed 600–700, uppercase with wide tracking: micro-labels, buttons, tabs.
- **Sans**, Barlow 400: dialog text, property names, help.
- **Mono**, JetBrains Mono: every number, MIDI address, URI and timer.

Micro-labels carry an index: `01 / MIDI DEVICES`, `02 / TEMPO`, `03 / MAPPINGS`. They are `label` style in `ink-muted`.

## Shapes and motifs

- **Segmented meters**: columns of `radius-1` blocks with a `space-1` gap. Unlit segments are `raised`, lit segments take the role color (`audio` for EQ, `bpm` for the beat).
- **Hazard stripes**: 45° stripes of `warn` and `ground` at an 8px pitch, used on warning banners, the panic button, and borders of mappings whose target is missing (with the dashed border).
- **Corner ticks**: 8px L-shaped marks in `line` at the corners of the active panel instead of a full outline.
- **Selected state**: a `stroke-bold` underline or a full `midi` fill, never a glow.
- **Status lights**: `radius-pill` dots, 8px, in role colors: connected (`midi`), beat (`bpm`), signal present (`audio`), error (`warn`).

## Voice

Labels are short, uppercase and technical: `LEARN`, `SEND 10 MS`, `RESYNC`, `PANIC`. Dialog text is plain sentence case and specific: "Saturn rings opacity follows CC 48 between 0.2 and 1.0." Errors say what happened and what to do: "Action 'Fly to Saturn' isn't in this scene. The mapping will turn on when the asset loads."

## Iconography

Line icons on a 16px grid, `stroke-hair` weight, square caps, no fills except status lights. No emoji, no illustrated icons. Until an icon set is chosen, use text labels.

## Spacing

A 4px base: `space-1` 4, `space-2` 8, `space-3` 16, `space-4` 24, `space-5` 48, `space-6` 96. Dense by default: rows are 40px, buttons 36px.
