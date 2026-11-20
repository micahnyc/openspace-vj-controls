/**
 * Turns OpenSpace's property-owner tree and action list into flat, searchable
 * entries for the discovery cache. Pure: takes plain JSON, no socket.
 */

export interface RawProperty {
  uri: string;
  value?: unknown;
  metaData: {
    type: string;
    guiName: string;
    identifier: string;
    description?: string;
    isReadOnly?: boolean;
    visibility?: string;
    additionalData?: { min?: number | number[]; max?: number | number[]; step?: number | number[]; options?: unknown };
  };
}

export interface RawPropertyOwner {
  uri: string;
  identifier: string;
  guiName?: string;
  properties?: RawProperty[];
  subowners?: RawPropertyOwner[];
}

export interface PropertyEntry {
  uri: string;
  /** Property type without the "Property" suffix: Float, Bool, Vec3, Option... */
  type: string;
  name: string;
  /** guiName of the owner, for "Saturn > Rings > Opacity" style display. */
  ownerPath: string;
  readOnly: boolean;
  visibility: string;
  min?: number | number[];
  max?: number | number[];
  /** Allowed names for Selection properties (e.g. constellation names). */
  options?: string[];
}

export interface RawAction {
  identifier: string;
  name: string;
  guiPath?: string;
  documentation?: string;
  isLocal?: boolean;
}

export interface ActionEntry {
  identifier: string;
  name: string;
  guiPath: string;
  documentation: string;
}

/** Depth-first walk of the owner tree. Iterative so a deep scene can't blow the stack. */
export function flattenProperties(root: RawPropertyOwner): PropertyEntry[] {
  const out: PropertyEntry[] = [];
  const stack: { owner: RawPropertyOwner; path: string[] }[] = [{ owner: root, path: [] }];
  while (stack.length > 0) {
    const { owner, path } = stack.pop()!;
    const label = owner.guiName || owner.identifier;
    const here = label ? [...path, label] : path;
    for (const p of owner.properties ?? []) {
      const md = p.metaData;
      const entry: PropertyEntry = {
        uri: p.uri,
        type: md.type.replace(/Property$/, ''),
        name: md.guiName || md.identifier,
        ownerPath: here.join(' › '),
        readOnly: md.isReadOnly ?? false,
        visibility: md.visibility ?? 'User',
      };
      const extra = md.additionalData;
      if (extra?.min !== undefined) entry.min = extra.min;
      if (extra?.max !== undefined) entry.max = extra.max;
      if (Array.isArray(extra?.options) && extra.options.every((o) => typeof o === "string")) entry.options = extra.options as string[];
      out.push(entry);
    }
    const subs = owner.subowners ?? [];
    // Push in reverse so output keeps the tree's order.
    for (let i = subs.length - 1; i >= 0; i--) stack.push({ owner: subs[i]!, path: here });
  }
  return out;
}

export function normalizeActions(actions: readonly RawAction[]): ActionEntry[] {
  return actions
    .map((a) => ({
      identifier: a.identifier,
      name: a.name || a.identifier,
      guiPath: a.guiPath ?? '/',
      documentation: a.documentation ?? '',
    }))
    .sort((a, b) => a.guiPath.localeCompare(b.guiPath) || a.name.localeCompare(b.name));
}

/**
 * Case-insensitive match where every whitespace-separated term must appear
 * somewhere in the haystack ("saturn opac" finds Scene.SaturnRings...Opacity).
 */
export function matchesQuery(haystack: string, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const h = haystack.toLowerCase();
  return terms.every((t) => h.includes(t));
}
