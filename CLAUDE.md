# OpenSpace VJ Controls

Browser app (Chrome, Windows show PC) that reads MIDI controllers and audio and drives a live OpenSpace (master branch) over its WebSocket API (port 4682) using openspace-api-js.

## Read first
- docs/SPEC.md — the full design spec. It is the source of truth; follow its decisions.
- profiles/akai-apc40-mk2.json — controller profile. Entries marked "verify" must be checked on real hardware.
- design/NEON-FLAT.md, design/neon-flat-tokens.json, design/PALETTES.md — the visual style. Use these tokens; no gradients, glow or shadows; square corners.

## Stack
Svelte + Vite + TypeScript, Vitest. No backend.

## Architecture rules
- src/core/ has no DOM or browser APIs (testable in Node): mapping engine, transforms, send scheduler, tempo clock.
- Send scheduler has two modes (spec: "Send mode"): message queue (tick N ms, events FIFO then latest-value-wins targets) and direct with throttling (per-target leading + trailing edge). Timer runs in a Web Worker, never requestAnimationFrame.
- Mapping files carry schemaVersion and go through a migration function on load.
- Custom scripts in a loaded file require user confirmation before the file is applied.

## Build order (spec: Milestones)
1. Skeleton + OpenSpace connection + property/action discovery.
2. Web MIDI input, APC40 profile, MIDI learn, direct property control.
3. Send scheduler (both modes) + debug panel metrics.
4. Mappings list (device tabs), save/load JSON, autosave.
5. Audio input, BPM detection, BPM mappings; then EQ mappings.
