# OpenSpace VJ Controls

A browser app that turns MIDI controllers and live audio into a visual instrument for [OpenSpace](https://www.openspaceproject.com/). It reads MIDI (Web MIDI) and audio (Web Audio) in Chrome and drives a running OpenSpace over its WebSocket API (port 4682) with [openspace-api-js](https://github.com/OpenSpace/openspace-api-js). No backend.

- **MIDI mappings:** faders and knobs set properties, pads toggle or cycle values, trigger actions or run Lua; delta time; MIDI learn.
- **BPM mappings:** glide a property between min and max with OpenSpace easing, step through a list of values, or fire actions and scripts every ½–16 beats.
- **EQ mappings:** audio level or low/mid/high bands drive properties.
- **Show safety:** auto-reconnect with fader pickup, send scheduler (message queue or direct + throttle), panic, autosave, save/load JSON show files.
- **Controllers:** built-in profile for the Akai APC40 mkII (Mode 2, LED and knob-ring feedback); other controllers work raw.

The design spec is in [`docs/`](docs/), the visual style in [`design/`](design/), controller profiles in [`profiles/`](profiles/).

## Run

Requires Node 20.19+ (22+ recommended) and Chrome.

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests (src/core runs in plain Node)
npm run check    # type check
npm run build    # static build in dist/
```

Start OpenSpace with its WebSocket server on (default port 4682). If the app runs on a different computer than OpenSpace, add that computer's IP to `Server.AllowAddresses` in `openspace.cfg`.

**Windows note:** run `npm test` from a path with an uppercase drive letter (`C:\...`). With a lowercase one (`c:\...`, as VS Code sometimes opens folders) Vitest loads twice and every test fails.

## Privacy

The app makes no third-party requests: fonts (Barlow, Barlow Condensed, Big Shoulders Display, JetBrains Mono, all SIL Open Font License) are bundled from [Fontsource](https://fontsource.org/), and there is no analytics. It talks only to the OpenSpace instance you point it at. Settings and autosaved mappings stay in your browser's local storage.

## Audio input

Pick an input under **Tempo & EQ**. Options on Windows, best first for shows:

1. **Stereo Mix** (Realtek): copies what plays on the speakers, no latency, reopened automatically. On some drivers it only follows the *Speakers* output, not *Headphones*.
2. **System audio (share dialog)**: works with any output; Chrome asks each session.
3. **Voicemeeter** or a hardware **line-in** from the mixer.
