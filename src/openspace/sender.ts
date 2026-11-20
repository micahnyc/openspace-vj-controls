/**
 * Turns scheduler messages into OpenSpace calls. This is the one function the
 * spec says the batch strategy lives behind ("That switch lives behind one function").
 */
import type { OpenSpaceApi } from 'openspace-api-js/api';
import type { OutMsg, Sink } from '../core/scheduler';

/** Lua string literal. */
export function luaString(s: string): string {
  return JSON.stringify(s);
}

/** Lua literal for a property value (number, bool, vector as table). */
export function luaValue(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '0';
  if (Array.isArray(v)) return `{${v.map(luaValue).join(', ')}}`;
  if (typeof v === 'string') return luaString(v);
  return 'nil';
}

/** Interpolated set: OpenSpace animates to `value` over `seconds` with an easing function. */
export function setPropertyLua(uri: string, value: unknown, seconds: number, easing = 'Linear'): string {
  return `openspace.setPropertyValueSingle(${luaString(uri)}, ${luaValue(value)}, ${seconds}, ${luaString(easing)})`;
}

/**
 * Wrap a user script so OpenSpace reports errors back. A bare failing script
 * returns {} with no message; load + pcall returns (false, message) instead.
 */
export function wrapForErrors(script: string): string {
  return `local f, e = load(${luaString(script)}); if not f then return false, e end; local ok, r = pcall(f); return ok, r`;
}

/** Outgoing socket buffer above which we skip ticks (backpressure). */
const MAX_BUFFERED = 64 * 1024;

export class OpenSpaceSink implements Sink {
  api: OpenSpaceApi | null = null;
  /** Called when a script or action fails to send, for the UI log. */
  onError: ((message: string) => void) | null = null;

  canSend(): boolean {
    if (!this.api) return false;
    return bufferedAmount(this.api) < MAX_BUFFERED;
  }

  send(msg: OutMsg): void {
    const api = this.api;
    if (!api) return;
    try {
      switch (msg.kind) {
        case 'set':
          if (msg.interpolateSeconds && msg.interpolateSeconds > 0) {
            void api.executeLuaScript(setPropertyLua(msg.uri, msg.value, msg.interpolateSeconds, msg.easing), false);
          } else {
            api.setProperty(msg.uri, msg.value as never);
          }
          return;
        case 'luaValue':
          void api.executeLuaScript(`${msg.fn}(${luaValue(msg.value)})`, false);
          return;
        case 'action':
          void api.executeLuaScript(`openspace.action.triggerAction(${luaString(msg.id)})`, false);
          return;
        case 'lua':
          // Fire-and-forget through the event queue; use runScriptChecked for the Test button.
          void api.executeLuaScript(msg.script, false);
          return;
      }
    } catch (e) {
      this.onError?.(`Send failed: ${String(e)}`);
    }
  }
}

/**
 * openspace-api-js doesn't expose the WebSocket, so read its buffer through
 * the private fields. Isolated here; returns 0 if the shape ever changes.
 */
function bufferedAmount(api: OpenSpaceApi): number {
  const sock = (api as unknown as { _socket?: { _client?: { bufferedAmount?: number } | null } })._socket;
  return sock?._client?.bufferedAmount ?? 0;
}

/** Run a script now and report OpenSpace's error, if any (the dialog's Test button). */
export async function runScriptChecked(api: OpenSpaceApi, script: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const reply = (await withTimeout(api.executeLuaScript(wrapForErrors(script), true), 5000)) as Record<string, unknown> | undefined;
  if (reply && reply['1'] === false) return { ok: false, error: String(reply['2'] ?? 'Unknown Lua error') };
  return { ok: true };
}

/** Read a Lua expression's value, e.g. the current delta time. */
export async function readLua(api: OpenSpaceApi, expr: string): Promise<unknown> {
  const reply = (await withTimeout(api.executeLuaScript(`return ${expr}`, true), 5000)) as Record<string, unknown> | undefined;
  return reply?.['1'];
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`OpenSpace didn't reply within ${ms / 1000} s.`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}
