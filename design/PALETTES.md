# Palettes

Every show picks a palette of 4 to 16 colors. The palette drives the three role accents (slots 1–3 become `midi`, `bpm`, `audio`) and is offered as quick picks in color pickers, such as when a mapping drives a color property in OpenSpace. A palette is saved inside the show's mapping file, so loading a show brings its look with it.

## Rules for any palette, built-in or custom

- **4 to 16 colors.** Slots 1–3 are the role accents; the rest are extras for color properties and decoration.
- **Contrast:** each color must reach 4.5:1 on `raised` (#1F231F). The palette editor rejects colors under 3:1 and marks colors between 3:1 and 4.5:1 as "fill only".
- **Roles never rely on color alone.** MIDI, BPM and audio are always also told apart by placement and label (the MIDI tab, the BPM readout, the EQ panel), because bright neons on black are all similarly light. The editor still warns when two of slots 1–3 are close in both hue and lightness.
- **No warn look-alikes:** a color too close to `warn` orange is flagged, because orange is reserved for danger.
- Users can reorder slots, which reassigns the roles.
- **The whole page follows the palette.** Besides the accents, a palette sets `ink` (text; 12:1+ on `raised`) and two neutrals: `panel` (panel and dialog fills, the outline around panels; no lighter than #333333) and `raised` (mapping rows, buttons, inputs; no lighter than #3A3A3A). Every accent slot must still reach 4.5:1 on the palette's own `raised`. `rule`, `line` and `ink-muted` are derived from `raised` blended toward `ink` (so they carry the palette's tint), at the lowest blend that meets their contrast minimums (`line` 3.5:1, `ink-muted` 6.8:1). Only `ground` (the page background stays near-black #0A0B0A) and `warn` stay fixed.

## Built-in palettes

### Acid (default, 8)

Page: panel #141714, raised #1F231F, ink #F0F2EA (green-tinted).

| Slot | Name | Hex | On raised |
| --- | --- | --- | --- |
| 1 · MIDI | Acid | #C8FF1A | 13.5:1 |
| 2 · BPM | Hot | #FF2E88 | 4.6:1 |
| 3 · Audio | Ice | #1FE5FF | 10.4:1 |
| 4 | Violet | #A47CFF | 5.2:1 |
| 5 | Sun | #FFD21A | 11.0:1 |
| 6 | Mint | #2BFFA8 | 12.1:1 |
| 7 | Blue | #5C9DFF | 5.9:1 |
| 8 | Bone | #E8E2D0 | 12.3:1 |

### Hazard (6)

Purple and green over black, alarm-panel energy. Page: panel #1C1426, raised #2A1F38, ink #F2EDF8 (purple-tinted).

| Slot | Name | Hex | On raised |
| --- | --- | --- | --- |
| 1 · MIDI | Unit Green | #7CFF4F | 12.3:1 |
| 2 · BPM | Violet | #A47CFF | 5.2:1 |
| 3 · Audio | Amber | #FFD21A | 11.0:1 |
| 4 | Pink | #FF4FD8 | 5.6:1 |
| 5 | Ice | #1FE5FF | 10.4:1 |
| 6 | Bone | #E8E2D0 | 12.3:1 |

### LED (5)

Hardware level-meter colors. Page: panel #1A1A1A, raised #262626, ink #F4F4F4 (neutral).

| Slot | Name | Hex | On raised |
| --- | --- | --- | --- |
| 1 · MIDI | Green | #3CFF3C | 11.8:1 |
| 2 · BPM | Yellow | #FFE01A | 12.1:1 |
| 3 · Audio | Blue | #5C9DFF | 5.9:1 |
| 4 | Magenta | #FF4FD8 | 5.6:1 |
| 5 | Silver | #B9B9B9 | 8.1:1 |

### Synthwave (6)

Hot pink and cyan over plum, retro-future. Page: panel #1A1020, raised #27182F, ink #F7EEF8 (plum-tinted).

| Slot | Name | Hex |
| --- | --- | --- |
| 1 · MIDI | Hot Pink | #FF4FD8 |
| 2 · BPM | Cyan | #2EE6FF |
| 3 · Audio | Yellow | #FFE14F |
| 4 | Lilac | #A98CFF |
| 5 | Mint | #4FFFB0 |
| 6 | Candy | #FF9CC8 |

### Deep Sea (6)

Aqua and gold over blue-black, bioluminescent. Page: panel #0F171C, raised #17242C, ink #EAF5F7 (teal-tinted).

| Slot | Name | Hex |
| --- | --- | --- |
| 1 · MIDI | Aqua | #2EF0D0 |
| 2 · BPM | Gold | #FFD23F |
| 3 · Audio | Ocean | #6AB4FF |
| 4 | Jelly | #C49CFF |
| 5 | Foam | #9CF5FF |
| 6 | Bone | #E8E2D0 |

### Mono (4)

White and soft tints on neutral grays, for restrained shows. Page: panel #161616, raised #232323, ink #FFFFFF (neutral).

| Slot | Name | Hex |
| --- | --- | --- |
| 1 · MIDI | White | #F2F2F2 |
| 2 · BPM | Ice | #8FD3FF |
| 3 · Audio | Cream | #FFE58F |
| 4 | Silver | #C4C4C4 |

Contrast for every built-in palette (accents 4.5:1+ on its `raised` and on the page, ink 12:1+) is checked by the unit tests in `src/presets/palettes.test.ts`.

## Saved format

```json
"palette": {
  "name": "Acid",
  "panel": "#141714",
  "raised": "#1F231F",
  "ink": "#F0F2EA",
  "colors": ["#C8FF1A", "#FF2E88", "#1FE5FF", "#A47CFF", "#FFD21A", "#2BFFA8", "#5C9DFF", "#E8E2D0"]
}
```
