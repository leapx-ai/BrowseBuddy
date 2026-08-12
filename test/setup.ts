// Global test setup: provide a `chrome` API mock so utils modules
// that reference chrome.* can be imported safely in Node.

const storageStore: Record<string, unknown> = {};

const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};

const chromeMock = {
  runtime: {
    getURL: (path: string) => `chrome-extension://test/${path}`,
    lastError: undefined,
    onMessage: { addListener: () => {} },
    onInstalled: { addListener: () => {} },
    openOptionsPage: () => {},
  },
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return { ...storageStore };
        const list = Array.isArray(keys) ? keys : [keys];
        const result: Record<string, unknown> = {};
        for (const k of list) {
          result[k] = storageStore[k];
        }
        return result;
      },
      set: async (items: Record<string, unknown>) => {
        Object.assign(storageStore, items);
      },
      getBytesInUse: async () => 1024,
    },
    onChanged: {
      addListener: (cb: (changes: unknown, area: string) => void) => {
        (listeners['storage.onChanged'] ||= []).push(cb);
      },
      removeListener: () => {},
    },
  },
  history: {
    search: () => Promise.resolve([]),
    deleteUrl: () => Promise.resolve(),
    deleteRange: () => Promise.resolve(),
    getVisits: () => Promise.resolve([]),
    onVisited: { addListener: () => {} },
    onVisitRemoved: { addListener: () => {} },
  },
  tabs: {
    create: () => Promise.resolve(),
    get: () => Promise.resolve({}),
    query: () => Promise.resolve([]),
    onActivated: { addListener: () => {} },
    onRemoved: { addListener: () => {} },
    onUpdated: { addListener: () => {} },
  },
  windows: {
    onFocusChanged: { addListener: () => {} },
    WINDOW_ID_NONE: -1,
  },
  alarms: {
    create: () => {},
    clear: () => Promise.resolve(true),
    onAlarm: { addListener: () => {} },
  },
  action: {
    setBadgeText: () => {},
    setBadgeBackgroundColor: () => {},
  },
  contextMenus: {
    create: () => {},
    onClicked: { addListener: () => {} },
  },
  i18n: {
    getMessage: (key: string) => key,
  },
};

declare global {
  // eslint-disable-next-line no-var
  var chrome: typeof chromeMock;
}

(globalThis as unknown as { chrome: typeof chromeMock }).chrome = chromeMock;

// jsdom-free environment: provide minimal window/document shims where needed
if (typeof (globalThis as unknown as { window?: unknown }).window === 'undefined') {
  (globalThis as unknown as { window: unknown }).window = globalThis;
}
