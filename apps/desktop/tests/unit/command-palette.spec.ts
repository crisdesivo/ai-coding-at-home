import { expect, test } from "@playwright/test";
import {
  desktopCommands,
  getDesktopCommandFromShortcut,
  isPaletteCommand,
} from "../../contracts/ipc";
import {
  fuzzyMatch,
  normalizeQuery,
  rankByFuzzy,
  rankPaths,
} from "../../src/features/command-palette/fuzzy-match";
import {
  buildPaletteActions,
  type PaletteActionContext,
} from "../../src/features/command-palette/palette-actions";
import { buildThreadActions } from "../../src/features/threads/thread-actions";
import type { SessionRecord } from "../../contracts/desktop-state";
import {
  buildCommandSections,
  buildFileSections,
  type PaletteCandidate,
} from "../../src/features/command-palette/palette-sections";

function candidate(id: string, title: string): PaletteCandidate {
  return { id, title, icon: null, run: () => undefined };
}

function titles(sections: ReturnType<typeof buildCommandSections>) {
  return sections.map((section) => [section.label, section.items.map((item) => item.title)]);
}

test("maps Cmd/Ctrl+K and Cmd/Ctrl+P to the palettes", () => {
  expect(getDesktopCommandFromShortcut({ modifier: true, shift: false, key: "k" })).toBe(
    desktopCommands.openCommandPalette,
  );
  expect(
    getDesktopCommandFromShortcut({ modifier: true, shift: false, key: "π", code: "KeyP" }),
  ).toBe(desktopCommands.openFilePalette);
  // Shift+Cmd/Ctrl+K is Clear conversation, not the palette.
  expect(getDesktopCommandFromShortcut({ modifier: true, shift: true, key: "K" })).toBe(
    desktopCommands.clearConversation,
  );
  expect(
    getDesktopCommandFromShortcut({ modifier: false, shift: false, key: "p" }),
  ).toBeUndefined();
  expect(
    getDesktopCommandFromShortcut({ modifier: true, shift: false, key: "Tab", code: "Tab" }),
  ).toBeUndefined();
  expect(isPaletteCommand(desktopCommands.openFilePalette)).toBe(true);
  expect(isPaletteCommand(desktopCommands.toggleTerminal)).toBe(false);
});

test("fuzzy match requires every query character in order", () => {
  expect(fuzzyMatch("abc", "a-b-c")?.positions).toEqual([0, 2, 4]);
  expect(fuzzyMatch("acb", "abc")).toBeNull();
  expect(fuzzyMatch("", "anything")).toEqual({ score: 0, positions: [] });
  expect(normalizeQuery(" App TSX ")).toBe("apptsx");
});

test("fuzzy match prefers word starts and consecutive runs", () => {
  // "fb" should land on the word starts of "Foo Bar", not the "b" in "foob".
  expect(fuzzyMatch("fb", "foob Bar")?.positions).toEqual([0, 5]);
  const wordStart = fuzzyMatch("set", "Open settings");
  const scattered = fuzzyMatch("set", "Some extra text");
  expect(wordStart && scattered && wordStart.score > scattered.score).toBe(true);
});

test("ranks titles by match quality", () => {
  const ranked = rankByFuzzy(
    ["Refactor settings view", "Fix login bug", "Settings sync"],
    "settings",
    (title) => title,
  );
  expect(ranked.map((entry) => entry.item)).toEqual(["Settings sync", "Refactor settings view"]);
});

test("ranks file names above scattered directory matches", () => {
  const paths = [
    "src/app/app-shell-utils.ts",
    "src/app/App.tsx",
    "apps/desktop/package.json",
    "docs/architecture.md",
  ];
  const ranked = rankPaths(paths, "app.tsx", 10);
  expect(ranked[0]?.item).toBe("src/app/App.tsx");
  // Positions index the full path and cover the file name.
  expect(ranked[0]?.match.positions).toEqual([8, 9, 10, 11, 12, 13, 14]);
  expect(rankPaths(paths, "zzz", 10)).toEqual([]);
  expect(rankPaths(paths, "", 2).map((entry) => entry.item)).toEqual(paths.slice(0, 2));
});

test("command palette shows recents and actions until a query", () => {
  const chats = ["One", "Two", "Three", "Four", "Five", "Six"].map((title) =>
    candidate(`chat:${title}`, title),
  );
  const workspaces = [candidate("workspace:pi", "pi-gui")];
  const actions = [candidate("action:settings", "Settings"), candidate("action:new", "New thread")];

  expect(
    titles(buildCommandSections({ query: "", filter: "all", chats, workspaces, actions })),
  ).toEqual([
    ["Recents", ["One", "Two", "Three", "Four", "Five"]],
    ["Actions", ["Settings", "New thread"]],
  ]);
  expect(
    titles(buildCommandSections({ query: "", filter: "workspaces", chats, workspaces, actions })),
  ).toEqual([["Workspaces", ["pi-gui"]]]);
});

test("a query puts the strongest kind first and drops empty kinds", () => {
  const chats = [candidate("chat:a", "Renew the thread pool")];
  const workspaces = [candidate("workspace:pi", "pi-gui")];
  const actions = [candidate("action:new", "New thread")];
  const sections = buildCommandSections({
    query: "new thread",
    filter: "all",
    chats,
    workspaces,
    actions,
  });
  expect(sections.map((section) => section.label)).toEqual(["Actions", "Chats"]);
  expect(sections[0]?.items[0]?.titleMatches).toEqual([0, 1, 2, 4, 5, 6, 7, 8, 9]);

  expect(
    buildCommandSections({ query: "new", filter: "workspaces", chats, workspaces, actions }),
  ).toEqual([]);
});

test("file palette lists open tabs until a query, then splits name and directory", () => {
  const toCandidate = (path: string) => candidate(`file:${path}`, path.split("/").at(-1) ?? path);
  const openTabs = ["README.md", "src/app/App.tsx"];
  expect(
    buildFileSections({ query: "", ranked: [], openTabs, toCandidate })[0]?.items.map(
      (item) => item.id,
    ),
  ).toEqual(["file:src/app/App.tsx", "file:README.md"]);

  const [section] = buildFileSections({
    query: "srcapp",
    ranked: rankPaths(["src/app/App.tsx"], "srcapp", 10),
    openTabs,
    toCandidate,
  });
  const [item] = section?.items ?? [];
  expect(item?.detailMatches).toEqual([0, 1, 2, 4, 5, 6]);
  expect(item?.titleMatches).toEqual([]);
});

function paletteContext(thread: PaletteActionContext["thread"]): PaletteActionContext {
  const noop = () => undefined;
  return {
    platform: "linux",
    hasWorkspace: true,
    thread,
    canToggleSidebar: true,
    newThread: noop,
    openFolder: noop,
    createProject: { title: "Create project…", run: noop },
    openSettings: noop,
    openSkills: noop,
    openExtensions: noop,
    openScheduledTasks: noop,
    toggleSidebar: noop,
    toggleTool: noop,
    toggleSidePanel: noop,
    extensionViews: [],
    findInThread: noop,
    openPaletteMode: noop,
  };
}

function openThreadActions(busy: boolean, run: () => void) {
  const session: SessionRecord = {
    id: "session-1",
    title: "Thread",
    updatedAt: "2026-09-23T00:00:00.000Z",
    preview: "hello",
    status: busy ? "running" : "idle",
    hasUnseenUpdate: false,
  };
  const noop = () => undefined;
  return buildThreadActions(
    { workspaceId: "ws", session },
    {
      platform: "linux",
      hasScheduledTask: () => false,
      startRename: noop,
      setPinned: noop,
      archive: noop,
      restore: noop,
      markRead: noop,
      openScheduledTask: noop,
      copySessionId: noop,
    },
    { clearConversation: { busy, run } },
  );
}

test("the palette offers Clear conversation for the open thread, but not during a reply", () => {
  let cleared = 0;
  const idle = buildPaletteActions(
    paletteContext({ actions: openThreadActions(false, () => (cleared += 1)) }),
  );
  const clear = idle.find((action) => action.id === "clear-conversation");
  expect(clear?.title).toBe("Clear conversation");
  expect(clear?.hint).toBe("Ctrl+Shift+K");
  clear?.run();
  expect(cleared).toBe(1);

  const running = buildPaletteActions(
    paletteContext({ actions: openThreadActions(true, () => (cleared += 1)) }),
  );
  expect(running.some((action) => action.id === "clear-conversation")).toBe(false);
  expect(running.some((action) => action.id === "archive-thread")).toBe(true);

  expect(
    buildPaletteActions(paletteContext(undefined)).some(
      (action) => action.id === "clear-conversation",
    ),
  ).toBe(false);
});
