/**
 * Discovery cache (spec: "on connect, fetch the property tree and action list
 * once and cache it; the mapping editor searches that cache").
 */
import type { OpenSpaceApi } from 'openspace-api-js/api';
import {
  flattenProperties,
  normalizeActions,
  type ActionEntry,
  type PropertyEntry,
  type RawAction,
  type RawPropertyOwner,
} from '../core/discovery';

/** openspace-api-js never rejects a request if the socket drops, so every call gets a timeout. */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000} s.`)), ms);
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

export async function fetchSceneProperties(api: OpenSpaceApi): Promise<PropertyEntry[]> {
  const data = await withTimeout(api.getProperty('Scene'), 30_000, 'Reading the Scene property tree');
  if (data.type !== 'propertyOwner') {
    throw new Error(`Expected 'Scene' to be a property owner, got a ${data.type}.`);
  }
  return flattenProperties(data.value as unknown as RawPropertyOwner);
}

export async function fetchActions(api: OpenSpaceApi): Promise<ActionEntry[]> {
  const topic = api.startTopic('actionsKeybinds', { event: 'get_all' });
  try {
    const data = await withTimeout(topic.next(), 15_000, 'Reading the action list');
    if (data.type !== 'combined') throw new Error(`Unexpected actions reply of type '${data.type}'.`);
    return normalizeActions(data.actions as RawAction[]);
  } finally {
    topic.cancel();
  }
}

type LoadState = 'empty' | 'loading' | 'ready' | 'error';

class DiscoveryCache {
  properties: PropertyEntry[] = $state.raw([]);
  actions: ActionEntry[] = $state.raw([]);
  propertiesState: LoadState = $state('empty');
  actionsState: LoadState = $state('empty');
  propertiesError: string | null = $state(null);
  actionsError: string | null = $state(null);
  fetchedAt: number | null = $state(null);
  #run = 0;

  /** Fetch both lists. Results from an older run (e.g. before a reconnect) are dropped. */
  async refresh(api: OpenSpaceApi): Promise<void> {
    const run = ++this.#run;
    this.propertiesState = 'loading';
    this.actionsState = 'loading';
    this.propertiesError = null;
    this.actionsError = null;

    const props = fetchSceneProperties(api).then(
      (list) => {
        if (run !== this.#run) return;
        this.properties = list;
        this.propertiesState = 'ready';
      },
      (e: Error) => {
        if (run !== this.#run) return;
        this.propertiesState = 'error';
        this.propertiesError = e.message;
      },
    );
    const acts = fetchActions(api).then(
      (list) => {
        if (run !== this.#run) return;
        this.actions = list;
        this.actionsState = 'ready';
      },
      (e: Error) => {
        if (run !== this.#run) return;
        this.actionsState = 'error';
        this.actionsError = e.message;
      },
    );
    await Promise.all([props, acts]);
    if (run === this.#run) this.fetchedAt = Date.now();
  }

  /** Keep the cached lists (useful while reconnecting) but abandon in-flight fetches. */
  cancel(): void {
    this.#run++;
    if (this.propertiesState === 'loading') this.propertiesState = this.properties.length ? 'ready' : 'empty';
    if (this.actionsState === 'loading') this.actionsState = this.actions.length ? 'ready' : 'empty';
  }
}

export const discovery = new DiscoveryCache();
