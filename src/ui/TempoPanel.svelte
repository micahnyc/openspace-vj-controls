<script lang="ts">
  /** BPM / EQ display (spec: v1 screen part 3). */
  import { show } from '../app/show.svelte';
  import { audio, SYSTEM_AUDIO } from '../inputs/audio/audio.svelte';
  import { settings, saveSettings } from '../settings.svelte';
  import Meter from './components/Meter.svelte';

  let editing = $state(false);
  let bpmText = $state('');

  const beat = $derived.by(() => {
    void show.uiClock;
    const b = show.engine.tempo.beatsAt(performance.now());
    return { inBar: ((Math.floor(b) % 4) + 4) % 4, frac: b - Math.floor(b), bar: Math.floor(b / 4) + 1 };
  });
  const onsetLit = $derived(show.uiClock - audio.lastOnset < 90);
  const lockedAt = $derived.by(() => {
    void show.uiClock;
    return show.bpmLock.current;
  });

  function commitBpm() {
    const n = Number(bpmText);
    if (Number.isFinite(n) && n > 0) show.setBpm(n);
    editing = false;
  }

  /** Name of the input used last time, if Chrome still lists it (or the name is hidden pending permission). */
  const lastInput = $derived.by(() => {
    const id = settings.audioSource;
    if (!id) return null;
    if (audio.needsPermission) return 'last input';
    return audio.devices.find((d) => d.id === id)?.label ?? null;
  });

  async function useLast() {
    if (audio.needsPermission) await audio.requestPermission();
    if (audio.devices.some((d) => d.id === settings.audioSource)) void audio.start(settings.audioSource);
  }

  function stopAudio() {
    audio.stop();
    audio.source = '';
  }

  function onSource(e: Event & { currentTarget: HTMLSelectElement }) {
    const source = e.currentTarget.value;
    // Remember device inputs; the system-audio share always needs a fresh click.
    settings.audioSource = source === SYSTEM_AUDIO ? '' : source;
    saveSettings();
    void audio.start(source);
  }

  $effect(() => {
    void audio.refreshDevices();
  });
</script>

<section class="panel" aria-labelledby="tempo-title">
  <div class="head">
    <span class="label" id="tempo-title">02 / TEMPO &amp; EQ</span>
    <span class="readout muted">{show.tempoSource.toUpperCase()}</span>
  </div>

  <div class="grid">
    <div class="tempo">
      {#if editing}
        <input
          class="bpm-input readout"
          type="number"
          step="0.1"
          min="20"
          max="300"
          bind:value={bpmText}
          onblur={commitBpm}
          onkeydown={(e) => {
            if (e.key === 'Enter') commitBpm();
            if (e.key === 'Escape') editing = false;
          }}
          aria-label="BPM"
        />
      {:else}
        <button
          type="button"
          class="bpm"
          title="Click to type a BPM"
          onclick={() => {
            bpmText = show.bpm.toFixed(1);
            editing = true;
          }}
        >
          {show.bpm.toFixed(1)}
        </button>
      {/if}
      <span class="label">BPM · BAR <span class="readout">{beat.bar}</span></span>

      <div class="dots" aria-label="Beat {beat.inBar + 1} of 4">
        {#each [0, 1, 2, 3] as i}
          <span class="dot" class:lit={i === beat.inBar && beat.frac < 0.5} class:down={i === 0}></span>
        {/each}
      </div>

      <div class="buttons">
        <button type="button" onclick={() => show.appCommand('tap')}>TAP</button>
        <button type="button" onclick={() => show.appCommand('resync')} title="Beat 1 is now">RESYNC</button>
        <button type="button" onclick={() => show.setBpm(show.bpm / 2)} title="Half time">÷2</button>
        <button type="button" onclick={() => show.setBpm(show.bpm * 2)} title="Double time">×2</button>
      </div>
    </div>

    <div class="audio">
      <label class="field">
        <span class="label">AUDIO IN</span>
        <select value={audio.source} onchange={onSource}>
          <option value="">Off</option>
          <option value={SYSTEM_AUDIO}>System audio (share dialog)</option>
          {#each audio.devices as d, i (d.id + i)}
            <option value={d.id}>{d.label}</option>
          {/each}
        </select>
      </label>
      {#if audio.running}
        <div class="perm">
          <button type="button" onclick={stopAudio}>STOP AUDIO</button>
          <span class="muted small">Capturing now. Nothing is recorded or sent anywhere.</span>
        </div>
      {:else if lastInput}
        <div class="perm">
          <button type="button" class="primary" onclick={useLast}>USE {lastInput.toUpperCase()} AGAIN</button>
          <span class="muted small">Audio only starts when you click.</span>
        </div>
      {:else if audio.needsPermission}
        <div class="perm">
          <button type="button" class="primary" onclick={() => audio.requestPermission()}>ALLOW AUDIO INPUTS</button>
          <span class="muted small">Chrome hides your inputs (Stereo Mix, line-in…) until you allow audio for this site. This only asks; nothing starts.</span>
        </div>
      {/if}
      {#if audio.error}<p class="warn-text small">{audio.error}</p>{/if}

      <div class="meters">
        {#each ['level', 'low', 'mid', 'high'] as const as band}
          <div class="meter-col">
            <Meter value={audio.levels[band]} segments={14} role="audio" label={band} />
            <span class="label">{band === 'level' ? 'LVL' : band.toUpperCase()}</span>
          </div>
        {/each}
        <div class="meter-col onset">
          <span class="light {onsetLit ? 'on-audio' : ''}" aria-hidden="true"></span>
          <span class="label">HIT</span>
        </div>
      </div>

      <div class="detect">
        <label class="check">
          <input type="checkbox" bind:checked={settings.autoBpm} onchange={saveSettings} />
          AUTO BPM
        </label>
        <span class="readout muted">
          {#if !audio.running}NO INPUT{:else if audio.estimate}DETECTED {audio.estimate.bpm.toFixed(1)} · {Math.round(audio.estimate.confidence * 100)}%{audio.beatSource === 'analyser' ? ' · FALLBACK' : ''}{:else}LISTENING… (NEEDS ~6 S){/if}
        </span>
      </div>
      {#if settings.autoBpm && audio.running}
        <p class="muted small">
          {#if lockedAt !== null && show.tempoSource === 'audio'}
            Locked at {lockedAt.toFixed(1)}. Changes only when several readings agree.
          {:else if audio.estimate && audio.estimate.confidence < settings.bpmConfidence}
            Confidence below {Math.round(settings.bpmConfidence * 100)}%; tempo not changed. Tap tempo always works.
          {:else if audio.estimate}
            Waiting for readings to agree…
          {/if}
        </p>
        <label class="conf">
          <span class="label">MIN CONFIDENCE {Math.round(settings.bpmConfidence * 100)}%</span>
          <input type="range" min="0.1" max="0.8" step="0.05" bind:value={settings.bpmConfidence} onchange={saveSettings} />
        </label>
      {/if}
    </div>
  </div>
</section>

<style>
  .head {
    display: flex;
    justify-content: space-between;
    margin-bottom: var(--space-2);
  }
  .grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-4);
  }
  .tempo {
    display: grid;
    gap: var(--space-2);
    align-content: start;
  }
  .bpm,
  .bpm-input {
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: 48px;
    line-height: 1;
    height: auto;
    padding: 0;
    background: transparent;
    border: 0;
    color: var(--bpm);
    text-align: left;
    letter-spacing: 0;
    font-variant-numeric: tabular-nums;
    width: 5.2ch;
  }
  .bpm-input {
    height: 56px;
    background: var(--raised);
    border: var(--stroke-hair) solid var(--line);
    font-size: 40px;
  }
  .dots {
    display: flex;
    gap: var(--space-2);
  }
  .dot {
    width: 14px;
    height: 14px;
    border-radius: var(--radius-pill);
    background: var(--raised);
    border: var(--stroke-hair) solid var(--line);
  }
  .dot.down {
    border-color: var(--bpm);
  }
  .dot.lit {
    background: var(--bpm);
    border-color: var(--bpm);
  }
  .buttons {
    display: flex;
    gap: var(--space-1);
    flex-wrap: wrap;
  }
  .buttons button {
    padding: 0 var(--space-2);
  }
  .audio {
    display: grid;
    gap: var(--space-2);
    align-content: start;
    min-width: 0;
  }
  .field {
    display: grid;
    gap: var(--space-1);
  }
  .field select {
    min-width: 0;
    width: 100%;
  }
  .meters {
    display: flex;
    gap: var(--space-3);
    height: 96px;
  }
  .meter-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
  }
  .meter-col.onset {
    justify-content: flex-end;
    padding-bottom: 2px;
  }
  .detect {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    flex-wrap: wrap;
  }
  .check {
    display: inline-flex;
    gap: var(--space-2);
    align-items: center;
    font-family: var(--font-condensed);
    font-weight: 700;
    letter-spacing: 0.06em;
  }
  .small {
    font-size: 13px;
    margin: 0;
  }
  .perm {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    flex-wrap: wrap;
  }
  .conf {
    display: grid;
    gap: var(--space-1);
    max-width: 260px;
  }
  .warn-text {
    color: var(--warn);
  }
  @media (max-width: 600px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
