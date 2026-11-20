<script lang="ts">
  /**
   * TEMPORARY MIDI monitor (milestone 1): shows every incoming message so the
   * APC40 profile's "verify" entries can be checked on real hardware.
   */
  import { onDestroy } from 'svelte';
  import { midi } from '../../inputs/midi/webmidi.svelte';
  import { toHex, type MidiEvent } from '../../core/midi/parse';
  import { findControl, findProfile, type ProfileControl } from '../../core/profile';
  import { builtInProfiles } from '../../profiles';

  const MAX_ROWS = 300;

  interface Row {
    seq: number;
    ev: MidiEvent;
    control: ProfileControl | undefined;
    profileName: string | undefined;
  }

  let rows: Row[] = $state.raw([]);
  let paused = $state(false);
  let hideClock = $state(true);
  let profileOnly = $state(false);
  let total = $state(0);
  let rate = $state(0);
  let unknownForProfile = $state(0);

  // Events arrive far faster than the screen updates; buffer them and render once per frame.
  let pending: Row[] = [];
  let seq = 0;
  let rateCount = 0;
  let frame = 0;
  const t0 = performance.now();

  const unlisten = midi.listen((ev) => {
    rateCount++;
    total++;
    if (hideClock && (ev.kind === 'clock' || ev.kind === 'activesensing')) return;
    const profile = findProfile(builtInProfiles, ev.device);
    if (profileOnly && !profile) return;
    const control = profile ? findControl(profile, ev) : undefined;
    if (profile && !control && (ev.kind === 'cc' || ev.kind === 'noteon' || ev.kind === 'noteoff')) {
      unknownForProfile++;
    }
    if (paused) return;
    pending.push({ seq: ++seq, ev, control, profileName: profile?.name });
    if (!frame) frame = requestAnimationFrame(flush);
  });

  function flush() {
    frame = 0;
    if (pending.length === 0) return;
    const incoming = pending.reverse();
    pending = [];
    rows = incoming.concat(rows).slice(0, MAX_ROWS);
  }

  const rateTimer = setInterval(() => {
    rate = rateCount;
    rateCount = 0;
  }, 1000);

  onDestroy(() => {
    unlisten();
    clearInterval(rateTimer);
    if (frame) cancelAnimationFrame(frame);
  });

  function clear() {
    rows = [];
    pending = [];
    total = 0;
    unknownForProfile = 0;
  }

  function fmtValue(ev: MidiEvent): string {
    if (ev.value === null) return '';
    return ev.value.toFixed(3);
  }

  function fmtTime(t: number): string {
    return ((t - t0) / 1000).toFixed(3);
  }

  const KIND_LABEL: Record<string, string> = {
    cc: 'CC',
    noteon: 'NOTE ON',
    noteoff: 'NOTE OFF',
    pitchbend: 'BEND',
    program: 'PROG',
    polyaftertouch: 'P.AFT',
    channelaftertouch: 'C.AFT',
    sysex: 'SYSEX',
  };
</script>

<section class="panel" aria-labelledby="midi-title">
  <div class="head">
    <span class="label" id="midi-title">EVERY INCOMING MESSAGE</span>
    <span class="readout muted">{rate} MSG/S · {total} TOTAL</span>
  </div>

  {#if midi.status === 'unsupported'}
    <p class="error"><strong class="label">NO WEB MIDI</strong> This browser has no Web MIDI. Use Chrome or Edge.</p>
  {:else if midi.status !== 'ready'}
    <div class="tools">
      <button type="button" class="primary" onclick={() => midi.request()} disabled={midi.status === 'requesting'}>
        ENABLE MIDI
      </button>
      {#if midi.error}
        <p class="error"><strong class="label">BLOCKED</strong> {midi.error}</p>
      {/if}
    </div>
  {:else}
    <div class="inputs">
      {#each midi.inputs as input (input.id)}
        {@const profile = findProfile(builtInProfiles, input.name)}
        <span class="input">
          <span class="light {input.state === 'connected' ? 'on-midi' : 'on-warn'}" aria-hidden="true"></span>
          <span class="readout">{input.name}</span>
          {#if profile}<span class="label profile">{profile.name}</span>{/if}
          {#if input.state !== 'connected'}<span class="label warn-text">UNPLUGGED</span>{/if}
        </span>
      {:else}
        <span class="muted">No MIDI inputs found. Plug in the APC40; it appears here without a reload.</span>
      {/each}
    </div>

    <div class="tools">
      <button type="button" aria-pressed={paused} onclick={() => (paused = !paused)}>PAUSE</button>
      <button type="button" onclick={clear}>CLEAR</button>
      <button type="button" aria-pressed={hideClock} onclick={() => (hideClock = !hideClock)}>HIDE CLOCK</button>
      <button type="button" aria-pressed={profileOnly} onclick={() => (profileOnly = !profileOnly)}>
        PROFILED DEVICES ONLY
      </button>
      {#if unknownForProfile > 0}
        <span class="readout warn-text" title="Messages from a profiled device that match no control in its profile">
          {unknownForProfile} NOT IN PROFILE
        </span>
      {/if}
    </div>

    <div class="table-wrap">
      <table class="readout">
        <thead>
          <tr class="label">
            <th>TIME S</th>
            <th>DEVICE</th>
            <th>CH</th>
            <th>KIND</th>
            <th>NUM</th>
            <th>RAW</th>
            <th>VALUE</th>
            <th>BYTES</th>
            <th>CONTROL</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as r (r.seq)}
            <tr class:unknown={r.profileName && !r.control && r.ev.channel !== null}>
              <td>{fmtTime(r.ev.t)}</td>
              <td class="dev">{r.ev.device}</td>
              <td>{r.ev.channel ?? ''}</td>
              <td class="kind">{KIND_LABEL[r.ev.kind] ?? r.ev.kind.toUpperCase()}</td>
              <td>{r.ev.number ?? ''}</td>
              <td>{r.ev.raw ?? ''}</td>
              <td>{fmtValue(r.ev)}</td>
              <td class="muted">{toHex(r.ev.bytes)}</td>
              <td>
                {#if r.control}
                  <span class="ctl">{r.control.label}</span>
                  <span class="muted">{r.control.type}</span>
                  {#if r.control.verify}<span class="verify" title={r.control.verify}>VERIFY</span>{/if}
                {:else if r.profileName}
                  <span class="warn-text">NOT IN PROFILE</span>
                {/if}
              </td>
            </tr>
          {:else}
            <tr><td colspan="9" class="muted empty">Move a fader or press a pad.</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<style>
  .head {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
    margin-bottom: var(--space-2);
  }
  .inputs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    margin-bottom: var(--space-3);
  }
  .input {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  .profile {
    color: var(--midi);
  }
  .tools {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
    align-items: center;
    margin-bottom: var(--space-2);
  }
  .table-wrap {
    max-height: 420px;
    overflow: auto;
    background: var(--raised);
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th {
    position: sticky;
    top: 0;
    background: var(--panel);
    text-align: left;
    font-weight: 600;
    padding: var(--space-1) var(--space-2);
    border-bottom: var(--stroke-hair) solid var(--line);
  }
  td {
    padding: var(--space-1) var(--space-2);
    border-bottom: var(--stroke-hair) solid var(--rule);
    white-space: nowrap;
  }
  .dev {
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .kind {
    color: var(--midi);
  }
  .ctl {
    margin-right: var(--space-2);
  }
  .verify {
    margin-left: var(--space-2);
    color: var(--on-accent);
    background: var(--palette-5);
    padding: 0 var(--space-1);
  }
  .warn-text {
    color: var(--warn);
  }
  tr.unknown td:first-child {
    border-left: var(--stroke-bold) solid var(--warn);
  }
  .empty {
    padding: var(--space-3) var(--space-2);
  }
  .error {
    border-left: var(--stroke-bold) solid var(--warn);
    padding-left: var(--space-2);
  }
  .error .label {
    color: var(--warn);
  }
</style>
