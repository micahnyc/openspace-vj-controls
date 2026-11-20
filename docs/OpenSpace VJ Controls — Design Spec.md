# OpenSpace VJ Controls — Design Spec

Nov 19, 2026 · @Micah OpenSpace

## Overview and goals

OpenSpace VJ Controls is a browser app that reads MIDI hardware and drives a live OpenSpace session, so a performer can play the universe like a visual instrument. The web UI is both the MIDI receiver and the control surface: no separate bridge process.

**Who uses it:** a VJ or show operator running OpenSpace on a dome, flat screen, or projector wall, alongside music or a live presenter.

**Goals**

- Any MIDI control (knob, fader, pad, encoder) can be bound to any OpenSpace action in under 10 seconds via MIDI learn.
- Continuous controls feel smooth: no visible stepping, end-to-end latency low enough to play on the beat.
- Discrete cues (fly-tos, scene changes, scripts) fire like clips in a VJ app.
- Mappings save as portable JSON presets per show and per controller.
- The rig survives a show: reconnects on its own, never sends runaway values, and has a panic button.

**Non-goals for v1:** OSC input and multi-operator sync. The architecture leaves room for them as extra input sources.

## v1 interface and use case

v1 is a single screen with five parts: a MIDI device selector, Save/Load buttons, a BPM/EQ display, a New mapping button, and a list of existing mappings. Everything else in this spec builds on top of it later.

&#91;embedded content: v1 screen wireframe · example mappings\]

**Flow**

1. Select one or more MIDI devices from the selector.
2. Press **New mapping** and choose **MIDI mapping**, BPM mapping or EQ **mapping**.
3. A dialog opens; its fields differ by type (below).
4. Save; the mapping appears in the list, where it can be edited, muted or deleted.

**Save / Load:** Save writes every mapping (MIDI and BPM, with their options and the device alias) to a `.json` file in the mapping-model format below. Load opens a `.json` file, checks its schema version, migrates older files, and replaces the current mappings after a confirm. In Chrome, Save can overwrite the file you loaded instead of downloading a new copy each time. If the file was made for a different controller, Load asks which connected device to use. The current mappings also autosave in the browser, so a page reload doesn't lose them.

**Multiple devices:** several MIDI devices can be connected at once. Every MIDI mapping belongs to the device it was learned on, so the same CC on two controllers never collides. The mappings list has one tab per connected device plus a **BPM & EQ** tab for mappings with no device. A saved file keeps each device's mappings under its alias.

**EQ mapping dialog:** pick a source (level, low, mid or high), a property, and a min/max. Optional gain and attack/release smoothing keep it from flickering. Bool properties switch on above a threshold you set.

**Conflicts:** if two mappings drive the same property, the last value sent wins. The mappings list marks such pairs with a small shared-target icon.

**Missing targets:** if a mapping points to a property or action that isn't in the current scene (common after Load), the app shows a warning and draws that mapping with a dashed border. It reactivates on its own when the asset loads.

**MIDI mapping dialog:** first choose **Direct property control**, **Affect BPM mapping**, **Trigger action, Custom script** or **Delta time**.

*Direct property control:* pick the property, then the MIDI control (press Learn and move it, or pick channel/CC/note by hand).

| Property type | MIDI control | Behavior |
| --- | --- | --- |
| Bool | Note (pad, button) | Dialog option: Instant (note on sets true, note off sets false) or Toggle (each press flips the value). Default Instant |
| Number | CC (slider, knob) | 0–127 maps across the supplied min/max |

Buttons that send CC instead of notes count as on above 63, off at or below. If the control type doesn't match the property (a slider on a bool), the dialog warns before saving.

*Affect BPM mapping:* pick an existing BPM mapping, then the MIDI control.

| MIDI control | Adjusts | Behavior |
| --- | --- | --- |
| Note (pad, button) | Mute | Dialog option: Instant (mutes while held, note off unmutes) or Toggle (each press flips mute on/off). Default Instant |
| Slider (CC) | Range | Expands/narrows the min/max around its midpoint: bottom = collapsed to the midpoint, top = the full min/max set in the BPM mapping |
| Knob (CC) | Beat interval | Steps through every 1, 2, 4, 8, 16 beats across the knob's travel |

Sliders and knobs both send CC, so MIDI can't tell them apart. When Learn captures a CC, the dialog asks **Range** or **Beat interval**, defaulting to Range for absolute CCs and Beat interval for endless encoders. A muted BPM mapping holds its property at its last value.

*Trigger action:* pick an OpenSpace action from the list fetched on connect (any action defined in the loaded profile or assets, e.g. fly to Earth, toggle trails, take a screenshot), then the pad or button. Note on fires the action once through the event queue; note off does nothing. The pad LED flashes on fire. Intended for pads and buttons; the dialog warns if a slider or knob is learned.

*Custom script:* like Trigger action, but the dialog has a text box to paste any OpenSpace Lua script into (e.g. `openspace.setPropertyValueSingle("Scene.Earth.Renderable.Enabled", false)`). Note on runs it once through the event queue; note off does nothing. The dialog has a **Test** button that runs it now and shows OpenSpace's error if it fails. Scripts are saved in the mapping file, so **Load** warns before loading a file that contains scripts ("This file runs 3 custom scripts") and lists them, since a shared file could run anything.

*Delta time:* a knob or slider calls `openspace.time.setDeltaTime(value)`, with 0–127 mapped across a min and max you supply (simulated seconds per real second; negatives run time backwards). Example: min −86400, max 86400 gives ±1 day per second.

- Goes through the latest-value lane like any slider, so a sweep sends at most one call per timer interval.
- **Curve option:** linear (default) or exponential. With a wide range like ±1 year/s, linear leaves almost no control near real time; exponential spends more of the knob's travel near zero.
- Endless encoders (like the APC40 tempo knob) step the value up or down from where it is, clamped to the range.
- Built on a generic "Lua call with a value" mapping, so other single-value Lua functions can be added the same way later.

**BPM mapping dialog:** choose what it drives (properties, OpenSpace actions or a custom script), then how often it fires (every 1, 2, 4, 8 or 16 beats). Behavior depends on the property type:

| Property type | Behavior | Example |
| --- | --- | --- |
| Bool | Flips true/false every N beats | Every 4th beat: Earth trail blinks on, then off |
| Number (float/int) | Interpolates between a min and max you supply, over N beats. A Ping-pong checkbox picks min to max to min (checked) or a ramp that snaps back to min (unchecked) | Every 2 beats: opacity moves between 0.2 and 1.0 |
| Vector (color, position) | Same as number, per component | Every 8 beats: ring color moves between two colors |
| Option/enum | Steps to the next option every N beats (later) | Every 16 beats: cycle colormaps |

**BPM → action:** fires an OpenSpace action every N beats, counted from the downbeat, through the event queue. Pick one action (fires the same one each time) or an ordered list that advances one step per firing and loops, e.g. fly to Earth → Mars → Jupiter → Saturn every 16 beats. Mute and beat-interval MIDI controls work on these mappings like any BPM mapping; the range slider doesn't apply. Slow actions such as fly-tos should use an interval longer than their duration, and the dialog shows a warning if a fly-to's duration exceeds the beat interval at the current BPM.

**BPM → custom script:** runs a pasted Lua script every N beats, counted from the downbeat, through the event queue. Like BPM → action, it can hold one script or an ordered list that advances one step per firing and loops. Same Test button, and the same Load warning as MIDI scripts. Mute and beat-interval MIDI controls work on it; the range slider doesn't apply.

```json
{ "source": { "kind": "beat", "every": 16 },
  "action": { "type": "beat.actions", "actions": ["os.flyToEarth", "os.flyToMars", "os.flyToSaturn"], "loop": true } }
```

## Architecture

Everything runs in one browser page: inputs feed a mapping engine, which writes target values that a frame-paced send loop pushes to OpenSpace over WebSocket.

&#91;embedded content: system architecture · inputs to OpenSpace\]

The two-way link to OpenSpace carries commands out and subscribed property state back, which drives UI readouts and controller LEDs. The mapping engine is the one piece with no browser dependencies, so it is built and tested first.

## OpenSpace integration

The app talks to OpenSpace through its built-in WebSocket server (default port 4682) using [openspace-api-js](https://github.com/OpenSpace/openspace-api-js), the same library the official Web GUI uses. No OpenSpace C++ changes are needed for v1.

**Three ways to send commands, in order of preference**

| Path | Use for | Why |
| --- | --- | --- |
| `setProperty(uri, value)` | Faders and knobs on a single property (opacity, scale, color) | Cheapest message; no Lua parse per tick |
| Lua via `library()` / `executeLuaScript` | Interpolated sets, time, navigation, path fly-tos, actions | Full API; `setPropertyValueSingle` takes an interpolation time and easing, so OpenSpace smooths it |
| `flightcontroller` topic | Continuous camera input from encoders and joysticks | Joystick-style axis stream the Web GUI's touch controls use; avoids a Lua call per frame |

**Reading state back:** `subscribeToProperty` keeps UI widgets and controller LEDs in sync when someone changes a value in the main GUI. Subscriptions are created only for properties that are mapped, to keep socket traffic small.

**Connection handling**

- Connect on load to the host and port set on the page (localhost by default, or the OpenSpace machine's IP when running on a separate laptop), show status in the header, auto-reconnect with backoff (0.5 s, 1 s, 2 s, capped at 5 s).
- On reconnect, re-subscribe and re-read every mapped property before accepting MIDI again, so a fader that moved while disconnected doesn't jump the scene.
- Discovery: on connect, fetch the property tree and action list once and cache it; the mapping editor searches that cache.

**Setup on the OpenSpace machine:** if the UI runs on another computer, add both IPs to `Server.AllowAddresses` in openspace.cfg ([remote-control docs](https://docs.openspaceproject.com/latest/using-openspace/installers/remote-control.html)).

**To verify at the computer:** the exact `flightcontroller` payload in the current OpenSpace release, and which `openspace.navigation` functions exist for incremental orbit/zoom in the version AMNH runs.

## MIDI input layer

MIDI comes in through the browser's Web MIDI API (`navigator.requestMIDIAccess`), which works in Chrome and Edge on localhost or HTTPS. Plan on Chrome as the show browser; Safari has no Web MIDI and Firefox support is gated behind a permission prompt.

**Input pipeline:** raw bytes → parser → normalized event → mapping engine. Every event is normalized to one shape so the rest of the app never touches MIDI bytes:

```json
{ "device": "Launch Control XL", "channel": 1, "kind": "cc", "number": 21, "value": 0.63, "raw": 80, "t": 1234.5 }
```

**Message types to support**

| Kind | Typical control | Handling |
| --- | --- | --- |
| CC absolute (7-bit) | Faders, pots | Value 0–127 → 0.0–1.0 |
| CC relative | Endless encoders | Decode by mode (two's complement, binary offset, sign-magnitude), set per control |
| CC 14-bit / NRPN | High-res faders | Pair MSB/LSB → 16,384 steps; worth it for slow camera zooms |
| Note on/off | Pads, buttons | Trigger, toggle or momentary (hold) |
| Pitch bend | Wheels, touch strips | 14-bit, center = 0 |
| Program change | Preset footswitch | Switch mapping bank |

**MIDI learn:** click a target in the UI, move a control, done. Learn captures device, channel, kind and number, and guesses absolute vs relative from the first few values.

**Device profiles:** optional JSON per controller naming its controls ("Knob 3, row 2") and declaring encoder modes and LED feedback notes. Unknown devices still work raw.

**Built-in controller profiles** ship as JSON in `profiles/`, one per popular controller, built from each manufacturer's MIDI protocol doc. A profile lists every control with its MIDI address and physical type (slider, knob, encoder, pad, button). When Learn captures a message, the app looks it up in the active profile, so it knows a CC is a slider (default: Range) or a knob (default: Beat interval) without asking. Unknown devices fall back to asking.

First profile: **Akai APC40 mkII** (114 controls), from Akai's [communications protocol v1.2](https://cdn.inmusicbrands.com/akai/attachments/apc40II/APC40Mk2_Communications_Protocol_v1.2.pdf):

| Group | Type | MIDI |
| --- | --- | --- |
| Track faders 1–8 | slider | CC 7, channels 1–8 |
| Master fader, crossfader | slider | CC 14, CC 15 |
| Track knobs 1–8 (top row) | knob, LED ring | CC 48–55 |
| Device knobs 1–8 (right side) | knob, LED ring | CC 16–23 |
| Tempo, cue level | endless encoder (relative) | CC 13, CC 47 |
| Clip grid 5×8 | RGB pad | Notes 0–39 |
| Scene launch 1–5 | button | Notes 82–86 |
| Track buttons (arm, solo, activator, select, stop) | button | Notes 48–52, channels 1–8 |

The APC40 mkII powers up in Generic mode, where the device knobs change MIDI channel with the selected track. On connect the profile sends a sysex to switch it to Mode 2: knobs stay on one channel, buttons are momentary, and the app controls all LEDs. That needs Web MIDI's sysex permission. Items marked `verify` in the file (some channels, grid row order, the sysex bytes) get checked with the hardware.

Next profiles to add: APC mini mk2, Novation Launch Control XL, Korg nanoKONTROL2, Midi Fighter Twister.

**MIDI out (feedback):** the same layer sends notes/CCs back to light pads for active cues and sync motorized or LED-ring controls with OpenSpace state.

## Audio input

The page can listen to audio and turn it into control signals, treated as just another source next to MIDI. Analysis runs in the Web Audio API (`AnalyserNode` for FFT, an `AudioWorklet` for onset detection) with no server.

**Where the audio comes from**

| Source | How | Notes |
| --- | --- | --- |
| Mic or line-in | `getUserMedia({audio})`, pick the device | Most reliable for shows: feed a mixer aux or interface input. Turn off echo cancellation, noise suppression and auto gain, or the levels lie |
| Computer audio, Windows/ChromeOS | `getDisplayMedia` with "share system audio" | Chrome can capture the whole system mix; user picks it in a share dialog each session. For shows, a virtual cable (e.g. VB-Audio Cable) avoids the dialog and appears as a normal input. This is the target platform |
| Computer audio, macOS | Loopback driver (e.g. BlackHole) shown as an input device | Browser system-audio capture on Mac is limited; a loopback device is the dependable path |
| A browser tab | `getDisplayMedia`, share a tab with audio | Handy if music plays from a web player in Chrome |

**Signals exposed as sources** (all 0–1, bindable like a fader or pad)

- `audio.level`: overall RMS loudness, with attack/release smoothing.
- `audio.band.low / mid / high`: energy per band, ranges adjustable.
- `audio.onset`: a trigger on kicks/transients, usable to fire cues or step a `property.cycle`.
- `audio.bpm`: estimated tempo plus a beat phase (where we are in the beat and bar), feeding the tempo clock. Detected from onset intervals with autocorrelation, constrained to a 70–180 BPM range with half/double-time correction; a confidence value gates it, and tap tempo or MIDI Clock can override or nudge it when detection drifts.

**Mixing with manual control:** each audio binding gets a gain and a depth knob (itself MIDI-mappable), so the performer decides how much the music moves the scene. Audio modulates around the manual value rather than replacing it.

## Control targets

Every target is an **action type** with a fixed input contract, so new targets plug in without touching the MIDI layer. Continuous types take a 0–1 or −1…+1 value; trigger types take a press.

| Action type | Input | Sends | Examples |
| --- | --- | --- | --- |
| `property.set` | continuous | `setProperty` (or interpolated Lua set) | Opacity, scale, color channels, line width, star size |
| `property.toggle` | trigger | `setProperty` bool | Enable a renderable, trails on/off |
| `property.cycle` | trigger | option/int property step | Switch colormap, layer, label mode |
| `camera.axis` | continuous, centered | flightcontroller / navigation Lua | Orbit X/Y, zoom, roll, truck, pan |
| `camera.flyTo` | trigger | path navigation Lua | Fly to Earth, Saturn, Milky Way, a saved camera |
| `camera.focus` | trigger | set anchor/aim | Retarget without moving |
| `time.rate` | continuous | delta time (interpolated) | Scrub speed from −1 yr/s to +1 yr/s on a curve |
| `time.control` | trigger | pause, jump to date, reverse | Jump to 2044 eclipse |
| `action.trigger` | trigger | OpenSpace action by identifier | Any action already defined in a profile |
| `lua.script` | trigger or continuous | Lua with `{value}` substituted | Escape hatch for anything else |
| `cue.fire` | trigger | an ordered list of the above | A "scene": fly-to + fade layers + set time |
| `app.*` | trigger | local only | Bank switch, panic, tap tempo, blackout |

**"And more" stays cheap:** `lua.script` covers anything OpenSpace can do on day one; once a pattern repeats, it graduates to a named type with its own UI. Candidates: exposure/fade-to-black, dome tilt, session-recording playback, and SkyBrowser image fades.

**Tempo-aware actions:** the tempo clock (audio BPM detection, tap tempo, or MIDI Clock) lets `cue.fire` quantize to the next beat or bar and lets continuous targets run LFOs synced to BPM.

## Mapping model

A binding connects one **source** to one **action** through a **transform**. Lock this schema early; it is the part most expensive to change later because presets on disk depend on it.

```json
{
  "schemaVersion": 1,
  "name": "Hayden dome set",
  "devices": { "lcxl": { "match": "Launch Control XL" } },
  "banks": [
    {
      "id": "solar-system",
      "bindings": [
        {
          "id": "b1",
          "source": { "device": "lcxl", "channel": 1, "kind": "cc", "number": 13, "mode": "absolute" },
          "transform": { "curve": "exp", "amount": 2, "min": 0, "max": 1, "invert": false, "deadzone": 0, "smoothingMs": 80, "takeover": "pickup" },
          "action": { "type": "property.set", "uri": "Scene.SaturnRings.Renderable.Opacity" },
          "feedback": { "subscribe": true }
        }
      ]
    }
  ],
  "cues": [
    { "id": "saturn", "label": "Saturn reveal", "quantize": "none", "steps": [
      { "type": "camera.flyTo", "node": "Saturn", "duration": 6 },
      { "type": "property.set", "uri": "Scene.SaturnRings.Renderable.Opacity", "value": 1, "fadeSeconds": 3, "delay": 2 }
    ] }
  ]
}
```

**Design rules**

- **Device aliases** (`lcxl`) decouple bindings from the OS device name, which differs on Mac, Windows, and with two identical units.
- **Banks** let one 24-knob controller hold many layouts; a global bank stays active underneath for panic, master fade and time.
- **Transforms** are pure functions (value in, value out) so they can be unit-tested and previewed as a curve in the editor. Curves: linear, exp, log, s-curve, stepped.
- **Takeover** for non-motorized faders: `jump`, `pickup` (ignore until the fader crosses the current value), or `scale`.
- **Cues are data, not code:** a list of action steps with delays, so they can be edited in the UI and fired from a pad, a keyboard key, or a click.
- Presets save to `localStorage` for quick recall and export/import as `.json` files for version control.
- `schemaVersion` plus a migration function per version, from day one.

**BPM bindings** use the same shape with a beat source instead of a MIDI source, so both kinds live in one mappings list:

```json
[
  {
    "id": "b2",
    "source": { "kind": "beat", "every": 4 },
    "action": { "type": "beat.toggle", "uri": "Scene.EarthTrail.Renderable.Enabled" }
  },
  {
    "id": "b3",
    "source": { "kind": "beat", "every": 2, "phaseOffset": 0 },
    "transform": { "min": 0.2, "max": 1.0, "shape": "pingpong", "easing": "linear" },
    "action": { "type": "property.set", "uri": "Scene.SaturnRings.Renderable.Opacity" }
  }
]
```

The shape field is pingpong or ramp, set by the dialog checkbox. The tempo clock outputs a beat phase (0 to 1 across N beats) counted from the bar's downbeat; a resync button resets beat 1 to now. Bool targets flip at each boundary; numeric targets read the phase through the transform every frame, via the same coalescing send loop as MIDI, so a fast BPM never floods OpenSpace.

## Performance UI

The UI has two modes: **Perform**, dark and glanceable from a meter away, and **Edit**, for building mappings. One toggle, and Perform locks out accidental edits.

**Visual style:** the app uses its own design system, [Neon Flat](https://claude.ai/artifact/BUThycbgzPSBJygrn7tvTM): flat black surfaces, square edges, condensed display type, mono readouts, segmented meters, hazard stripes for warnings. Accents come from a **show palette** of 4 to 16 colors. Built-in palettes (Acid, Hazard, LED) are included, users can build their own, and the palette is saved in the show's mapping file. Palette slots 1–3 color the MIDI, BPM and audio roles; warning orange is fixed and never part of a palette.

**Perform layout**

- **Header:** connection status for OpenSpace and each MIDI/audio input, sim time, delta time, current bank, panic button.
- **Cue grid:** pads in a grid like a clip launcher; armed, playing and done states; mirrors pad LEDs on the controller.
- **Channel strips:** one strip per mapped continuous control, showing the live value, the target's actual value from OpenSpace, and a takeover indicator.
- **Camera pad:** an on-screen XY pad and zoom strip for mouse/touch backup when hardware fails.
- **Audio meters:** level and bands with the onset light, when audio is enabled.

**Edit mode**

- Property browser searching the cached scene tree; actions list; drag a target onto a control or use MIDI learn.
- Binding inspector: curve preview, range, smoothing, takeover, live input monitor.
- Cue editor: ordered steps with delays, test-fire button.
- Preset manager: save, duplicate, import/export JSON.

**Second screen:** the UI runs in Chrome on the operator laptop the controller plugs into, while OpenSpace runs full-screen on the dome. A tablet can mirror the cue grid as a secondary view (v2).

## Show reliability

The rule: MIDI and audio can produce hundreds of events a second, but OpenSpace should receive at most one message per bound target per frame.

**Send rate policy**

Everything goes out in one batch per tick. Each tick sends two lanes: first the ordered event list (notes, toggles, BPM flips) in the order they happened, then one value per dirty continuous target (latest wins). The event lane is a true FIFO queue because every edge matters; the value lane is not, so fast sweeps never build a backlog. The batch goes out as back-to-back messages in one JS task; if measurement shows per-message overhead, the batch can instead become a single Lua chunk so OpenSpace applies it in one frame. That switch lives behind one function. The timer is a setting on the page ("Send every N ms", default 10 ms, range 1–100 ms), saved with the other app settings, not tied to OpenSpace's frame rate. A fast fader sweep on the APC40 can emit 100+ CC messages a second, but OpenSpace only applies property changes once per rendered frame, so anything above its frame rate is wasted traffic.

**Send mode (page setting, switchable live):** two strategies, so they can be compared on real hardware.

| Mode | Setting | How continuous values go out | How button presses go out |
| --- | --- | --- | --- |
| Message queue (default) | Tick, ms (default 10) | Every tick sends one batch: queued events first, then the latest value of each changed target | On the next tick, in order |
| Direct with throttling | Throttle, ms (default 10) | Each target sends immediately unless it sent within the last T ms; inside the window the newest value waits and goes out when the window ends (leading + trailing edge, per target) | Immediately, never throttled |

Both modes share the latest-value-wins rule and the trailing-edge guarantee, so a fader always lands on its final value. Only the timing differs: the queue mode syncs all targets to one clock; direct mode reacts the instant a control moves.

**Comparing them:** the debug panel shows, per mode, messages per second, values coalesced, input-to-send delay (median and worst), and round-trip time (from sending a value to OpenSpace's subscription echoing it back). Switching modes mid-performance is safe: pending values flush first.

| Input | Policy | Why |
| --- | --- | --- |
| Slider / knob to a number property | Latest-value-wins per target, flushed on the message timer (page setting, default 10 ms) | A sweep becomes at most one message per timer interval per target, independent of OpenSpace's frame rate |
| BPM-driven number | Same tick | Phase is computed at flush time, so motion stays smooth at any BPM |
| Note / button / BPM bool flip | Appended to an ordered event list, never coalesced; sent on the next tick | Every edge matters and order matters; at most one timer interval (10 ms) of added delay |
| Mute, interval, range changes | Applied locally at once; no OpenSpace message of their own | They only change how the next tick computes values |

**Throttle details**

- **Not a queue:** each target holds one pending value; a newer value overwrites it. Nothing builds up, so there's no lag after a fast sweep.
- **Leading edge:** dropped. With a 10 ms timer, waiting for the next tick adds no noticeable delay, and one send path is simpler.
- **Trailing edge:** the final value of a gesture is always sent, so a fader pushed to the top lands exactly at max.
- **Change threshold:** skip a send if the value moved less than a tiny epsilon since the last one sent.
- **Backpressure:** if the socket's outgoing buffer is backing up, skip ticks until it drains, rather than piling on. The status bar shows the effective send rate.
- **Echo guard:** while a target is being driven, ignore its own subscription updates for about 250 ms so the UI doesn't fight the fader.
- **Smoothing option per mapping:** at lower tick rates, a mapping can ask OpenSpace to interpolate over one tick interval (Lua set with a duration) instead of snapping. Off by default because it costs a Lua call per message.

The tick runs on a Web Worker timer, not requestAnimationFrame: Chrome pauses animation frames when the tab is hidden, which would freeze the show if the operator switches windows. Tick rate and per-target send counts show in a debug panel, so the right default can be measured on the dome cluster rather than guessed.

- **Coalescing send loop:** see Send rate policy above. In short, inputs only write the latest value into a target table; a `Web Worker timer` loop (the message timer, default 10 ms) sends what changed. Prevents socket floods when a fader is swept.
- **Smoothing in two places:** short client-side smoothing for feel, plus OpenSpace interpolation (`setPropertyValueSingle` with a duration) for slow fades, so the render stays smooth even if the network stutters.
- **Limits on every target:** clamp to the property's min/max from OpenSpace metadata; cap camera speed and delta time so a bad mapping can't throw the camera to infinity.
- **Panic button (MIDI-mappable):** stop camera motion, set delta time to real time, cancel running cues.
- **Blackout / fade-to-black** as a dedicated, always-available control.
- **Reconnect safety:** after any reconnect, re-sync values and require pickup before faders take effect (see OpenSpace integration).
- **Device hot-plug:** Web MIDI fires `statechange`; rebind by alias automatically when a controller is unplugged and plugged back in.
- **Cluster/dome setups:** commands go to the OpenSpace master node only; SGCT handles sync to render nodes. Measure latency on the actual dome cluster, not just a laptop.
- **Tablet caveat:** Web MIDI and audio capture don't work in iPad Safari, so the computer the controller plugs into must run the UI in Chrome; a tablet can only be a secondary view.

## Tech stack and repo structure

A static single-page app: TypeScript, Vite, and a light UI framework (Svelte, with its own visual design rather than the OpenSpace Web GUI's). No backend; it can be served from `localhost` by Vite or dropped into OpenSpace's own web server folder.

| Layer | Choice |
| --- | --- |
| OpenSpace client | `openspace-api-js` |
| MIDI | Native Web MIDI API, thin wrapper (no WebMidi.js dependency unless parsing gets hairy) |
| Audio | Web Audio API, `AudioWorklet` for onset/BPM |
| State | One store for bindings/presets, separate high-frequency value table outside the UI framework |
| Tests | Vitest for transforms, MIDI parser and mapping engine; a mock OpenSpace socket |

```
openspace-vj/
  src/
    core/        # engine, send loop, transforms (no DOM)
    inputs/      # midi/, audio/, (osc/ later)
    actions/     # one file per action type
    openspace/   # connection, discovery cache, subscriptions
    presets/     # schema, migrations, storage
    ui/          # perform/, edit/, components/
  profiles/      # controller profiles (JSON)
  presets/       # example show presets
```

`core/` never imports from `ui/` or browser APIs, so the engine is testable in Node and could later run headless or in a desktop wrapper.

## Milestones

Each phase ends with something playable, and the schema plus core engine land first so later phases add files rather than rewrite them.

**v1 target** = phases 1 to 3 plus the BPM half of phase 6: device selector, BPM/EQ display, MIDI and BPM mappings on properties, mappings list with save/load. Camera, cues and the full Perform/Edit UI follow once that is playable.

1. **Skeleton:** Vite app, OpenSpace connect/reconnect, property discovery cache, schema v1 with migrations stub. *Done when:* the app lists Scene properties from a live OpenSpace.
2. **First knob:** Web MIDI input, normalized events, MIDI learn, `property.set` through the coalescing send loop. *Done when:* a fader smoothly fades Saturn's rings.
3. **Mapping engine:** transforms, takeover, banks, presets save/export. Unit tests for transforms and parser.
4. **Camera and time:** `camera.axis`, `camera.flyTo`, `time.rate`, panic. *Done when:* you can fly the solar system from the controller alone.
5. **Cues:** `cue.fire`, cue grid, cue editor, LED feedback to pads.
6. **Audio:** input picker, level/bands/onset sources, BPM detection and tempo clock, beat-quantized cues, depth controls. Done when: a cue lands on the downbeat of a playing track.
7. **Show hardening:** test on the dome cluster, latency check, hot-plug, Perform-mode lock.
8. **v2:** BPM-synced LFOs, tablet view, OSC input.

## Open questions

- [ ] Decided: first controller is the Akai APC40 mkII; its profile is drafted.
- [ ] Decided: target OpenSpace master.
- [ ] Decided: both. The OpenSpace host and port are a page setting (localhost by default).
- [ ] Decided: both AMNH shows and personal VJ sets, so the show-safety features stay in scope.
- [ ] Decided: Svelte, with its own look and feel rather than the OpenSpace Web GUI's.
- [ ] Decided: the show machine is a Windows PC. Computer audio comes in through Chrome's system-audio share, or through a virtual audio cable as a fixed input.

* [ ] Decided: numeric BPM mappings have a checkbox in the dialog. Checked = ping-pong (min to max to min); unchecked = ramp min to max, then snap back. Default checked.
* [ ] Decided: BPM mappings count from the bar's downbeat, and the BPM/EQ display has a resync-to-downbeat button (also MIDI-mappable).

- [ ] Decided: Affect BPM mapping uses notes for mute, sliders for range width, knobs for beat interval. Mute notes have an Instant/Toggle option in the dialog.

* [ ] Decided: EQ level and bands are mapping sources in v1 (EQ mapping type).
* [ ] Decided: when two mappings drive one property, the last value sent wins.
* [ ] Decided: several devices at once; each MIDI mapping belongs to one device, and the mappings list has a tab per device.
* [ ] Decided: missing properties or actions show a warning, and the mapping gets a dashed border until its target exists.
