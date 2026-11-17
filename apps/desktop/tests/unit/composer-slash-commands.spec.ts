import { expect, test } from "@playwright/test";
import {
  buildSlashCommandSections,
  flattenSlashSections,
  parseClearComposerCommand,
  slashOptionsForCommand,
} from "../../src/features/conversation/composer-commands";

function commands(query: string, options?: Parameters<typeof buildSlashCommandSections>[4]) {
  return flattenSlashSections(buildSlashCommandSections(query, undefined, [], [], options));
}

test("/clear is a host action that starts a fresh conversation in this folder", () => {
  const clear = commands("/").find((command) => command.command === "/clear");
  expect(clear).toMatchObject({
    kind: "clear",
    title: "Clear",
    description: "Start a fresh conversation in this folder",
    section: "host",
    submitMode: "immediate",
  });
  expect(commands("/cle")[0]?.command).toBe("/clear");
  expect(commands("/clear").map((command) => command.command)).toEqual(["/clear"]);
  // It has no picker of options.
  expect(slashOptionsForCommand(clear)).toEqual([]);
});

test("the New thread surface leaves /clear out, since nothing is open to clear", () => {
  expect(
    commands("/", { allowTreeCommand: false, allowClearCommand: false }).some(
      (command) => command.kind === "clear" || command.kind === "tree",
    ),
  ).toBe(false);
  expect(commands("/cle", { allowClearCommand: false })).toEqual([]);
});

test("parses /clear and rejects arguments", () => {
  expect(parseClearComposerCommand("/clear")).toEqual({ type: "clear" });
  expect(parseClearComposerCommand("  /clear \n")).toEqual({ type: "clear" });
  expect(parseClearComposerCommand("/clear everything")).toEqual({
    type: "error",
    message: "/clear does not take arguments.",
  });
  expect(parseClearComposerCommand("/clearance")).toBeUndefined();
  expect(parseClearComposerCommand("please /clear")).toBeUndefined();
  expect(parseClearComposerCommand("clear")).toBeUndefined();
});
