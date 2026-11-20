# Palettes

Every show picks a palette of 4 to 16 colors. The palette drives the three role accents (slots 1–3 become `midi`, `bpm`, `audio`) and is offered as quick picks in color pickers, such as when a mapping drives a color property in OpenSpace. A palette is saved inside the show's mapping file, so loading a show brings its look with it.

## Rules for any palette, built-in or custom

- **4 to 16 colors.** Slots 1–3 are the role accents; the rest are extras for color properties and decoration.
- **Contrast:** each color must reach 4.5:1 on `raised` (#1F231F). The palette editor rejects colors under 3:1 and marks colors between 3:1 and 4.5:1 as "fill only".
- **Roles never rely on color alone.** MIDI, BPM and audio are always also told apart by placement and label (the MIDI tab, the BPM readout, the EQ panel), because bright neons on black are all similarly light. The editor still warns when two of slots 1–3 are close in both hue and lightness.
- **No warn look-alikes:** a color too close to `warn` orange is flagged, because orange is reserved for danger.
- Users can reorder slots, which reassigns the roles.

## Built-in palettes

### Acid (default, 8)

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

Purple and green over black, alarm-panel energy.

| Slot | Name | Hex | On raised |
| --- | --- | --- | --- |
| 1 · MIDI | Unit Green | #7CFF4F | 12.3:1 |
| 2 · BPM | Violet | #A47CFF | 5.2:1 |
| 3 · Audio | Amber | #FFD21A | 11.0:1 |
| 4 | Pink | #FF4FD8 | 5.6:1 |
| 5 | Ice | #1FE5FF | 10.4:1 |
| 6 | Bone | #E8E2D0 | 12.3:1 |

### LED (5)

Hardware level-meter colors.

| Slot | Name | Hex | On raised |
| --- | --- | --- | --- |
| 1 · MIDI | Green | #3CFF3C | 11.8:1 |
| 2 · BPM | Yellow | #FFE01A | 12.1:1 |
| 3 · Audio | Blue | #5C9DFF | 5.9:1 |
| 4 | Magenta | #FF4FD8 | 5.6:1 |
| 5 | Silver | #B9B9B9 | 8.1:1 |

## Saved format

```json
"palette": {
  "name": "Acid",
  "colors": ["#C8FF1A", "#FF2E88", "#1FE5FF", "#A47CFF", "#FFD21A", "#2BFFA8", "#5C9DFF", "#E8E2D0"]
}
```
