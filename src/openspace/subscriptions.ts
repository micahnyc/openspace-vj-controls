/**
 * Property subscriptions for mapped properties only (spec: "Subscriptions are
 * created only for properties that are mapped"). Subscriptions report changes;
 * current values are read with getProperty because OpenSpace sends only
 * metadata until a value changes.
 */
import type { OpenSpaceApi } from 'openspace-api-js/api';
import { withTimeout } from './sender';

/** The untyped overload of subscribeToProperty: yields metaData first, then values on change. */
interface Topic {
  cancel(): void;
  [Symbol.asyncIterator](): AsyncGenerator<{ type: 'value'; value: unknown } | { type: 'metaData' }, void, void>;
}

export class PropertySubscriptions {
  #api: OpenSpaceApi | null = null;
  #topics = new Map<string, Topic>();
  #onValue: (uri: string, value: unknown) => void;

  constructor(onValue: (uri: string, value: unknown) => void) {
    this.#onValue = onValue;
  }

  /** New connection: drop old topics (they died with the socket). */
  attach(api: OpenSpaceApi | null): void {
    for (const t of this.#topics.values()) {
      try {
        if (this.#api) t.cancel();
      } catch {
        // Socket already gone.
      }
    }
    this.#topics.clear();
    this.#api = api;
  }

  /** Make the subscribed set equal `uris`. */
  sync(uris: Iterable<string>): void {
    const api = this.#api;
    if (!api) return;
    const want = new Set(uris);
    for (const [uri, t] of this.#topics) {
      if (want.has(uri)) continue;
      try {
        t.cancel();
      } catch {
        // ignore
      }
      this.#topics.delete(uri);
    }
    for (const uri of want) {
      if (this.#topics.has(uri)) continue;
      let topic: Topic;
      try {
        topic = api.subscribeToProperty(uri) as unknown as Topic;
      } catch {
        continue;
      }
      this.#topics.set(uri, topic);
      void (async () => {
        try {
          for await (const data of topic) {
            if (this.#topics.get(uri) !== topic) return;
            if (data.type === 'value') this.#onValue(uri, data.value);
          }
        } catch {
          // Topic ended (disconnect or cancel).
        }
      })();
    }
  }

  /** Read current values of `uris` (reconnect re-read). Missing ones are skipped. */
  async readAll(uris: Iterable<string>, timeoutMs = 3000): Promise<Map<string, unknown>> {
    const api = this.#api;
    const out = new Map<string, unknown>();
    if (!api) return out;
    await Promise.all(
      [...uris].map(async (uri) => {
        try {
          const data = await withTimeout(api.getProperty(uri), timeoutMs);
          if (data.type === 'property') out.set(uri, data.value.value);
        } catch {
          // Missing property or timeout: the mapping shows as missing elsewhere.
        }
      }),
    );
    return out;
  }
}
