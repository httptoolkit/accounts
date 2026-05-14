/**
 * Storage backing for auth state. In a browser this is the real localStorage;
 * in Node we use an in-memory map.
 *
 * The gate is "are we in Node" rather than "does localStorage exist". Node
 * (since v26) ships its own localStorage that persists to disk - fine for
 * a Node app that wants it, but not something this library should silently
 * opt into for short-lived scripts, tests, SSR, etc.
 */

const isNode = typeof process !== 'undefined'
    && typeof process.versions === 'object'
    && typeof process.versions.node === 'string';

function createInMemoryStorage() {
    const data = new Map<string, string>();
    return {
        getItem: (key: string): string | null => data.get(key) ?? null,
        setItem: (key: string, value: string): void => { data.set(key, value); },
        removeItem: (key: string): void => { data.delete(key); },
        clear: (): void => { data.clear(); }
    };
}

export const storage = isNode || typeof globalThis.localStorage === 'undefined'
    ? createInMemoryStorage()
    : globalThis.localStorage;
