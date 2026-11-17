import { useEffect, useState, type Dispatch, type KeyboardEvent, type SetStateAction } from "react";
import type { RuntimeCommandRecord, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type {
  DesktopAppState,
  ExtensionCommandCompatibilityRecord,
} from "../../../../contracts/desktop-state";
import {
  isExactSlashCommand,
  buildSlashCommandSections,
  flattenSlashSections,
  slashOptionEmptyState,
  slashOptionsForCommand,
  type ComposerSlashCommand,
  type ComposerSlashCommandSection,
  type ComposerSlashOptionEmptyState,
  type ComposerSlashOption,
} from "../composer-commands";
import type { PiDesktopApi } from "../../../../contracts/ipc";

interface ActiveSlashFlow {
  readonly command: ComposerSlashCommand;
}

interface ActiveSlashQuery {
  readonly query: string;
  readonly start: number;
  readonly end: number;
  readonly isPrimary: boolean;
}

export function nextMenuIndex(current: number, delta: number, total: number): number {
  if (!total) {
    return 0;
  }
  return (current + delta + total) % total;
}

function extractActiveSlashQuery(text: string): ActiveSlashQuery | undefined {
  const match = /\/[^\s]*$/.exec(text);
  if (!match || match.index < 0) {
    return undefined;
  }

  const query = match[0];
  const start = match.index;
  const prefix = text.slice(0, start);
  return {
    query,
    start,
    end: start + query.length,
    isPrimary: prefix.trim().length === 0,
  };
}

interface UseSlashMenuParams {
  readonly composerDraft: string;
  readonly setComposerDraft: Dispatch<SetStateAction<string>>;
  readonly selectedRuntime: RuntimeSnapshot | undefined;
  readonly sessionCommands: readonly RuntimeCommandRecord[];
  readonly commandCompatibility: readonly ExtensionCommandCompatibilityRecord[];
  readonly selectedSessionKey: string;
  readonly isRunning: boolean;
  readonly api: PiDesktopApi | undefined;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly focusComposer: () => void;
  readonly updateSnapshot: (
    setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>,
    action: () => Promise<DesktopAppState>,
  ) => Promise<DesktopAppState>;
  readonly allowTreeCommand?: boolean;
  readonly allowClearCommand?: boolean;
  readonly immediateCommandMode?: "submit" | "prefill";
  readonly onRunTreeCommand?: () => void;
  readonly onRunClearCommand?: () => void;
}

export interface SlashMenuState {
  readonly slashSections: readonly ComposerSlashCommandSection[];
  readonly slashSuggestions: readonly ComposerSlashCommand[];
  readonly showSlashMenu: boolean;
  readonly showSlashOptionMenu: boolean;
  readonly selectedSlashCommand: ComposerSlashCommand | undefined;
  readonly selectedSlashOption: ComposerSlashOption | undefined;
  readonly slashOptions: readonly ComposerSlashOption[];
  readonly slashOptionEmptyState: ComposerSlashOptionEmptyState | undefined;
  readonly activeSlashFlow: ActiveSlashFlow | undefined;
  readonly activeSlashOptionCommand: ComposerSlashCommand | undefined;
  readonly resetSlashUi: () => void;
  readonly applySlashCommandSelection: (
    command: ComposerSlashCommand,
    mode: "click" | "tab" | "enter",
  ) => void;
  readonly applySlashOptionSelection: (option: ComposerSlashOption) => void;
  readonly handleSlashKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  readonly fillComposerFromSlash: (draft: string, options?: { suppressMenu?: boolean }) => void;
}

export function useSlashMenu(params: UseSlashMenuParams): SlashMenuState {
  const {
    composerDraft,
    setComposerDraft,
    selectedRuntime,
    sessionCommands,
    commandCompatibility,
    selectedSessionKey,
    isRunning,
    api,
    setSnapshot,
    focusComposer,
    updateSnapshot,
    allowTreeCommand = true,
    allowClearCommand = true,
    immediateCommandMode = "submit",
    onRunTreeCommand,
    onRunClearCommand,
  } = params;

  const [slashIndex, setSlashIndex] = useState(0);
  const [slashOptionIndex, setSlashOptionIndex] = useState(0);
  const [activeSlashFlow, setActiveSlashFlow] = useState<ActiveSlashFlow | undefined>();
  const [slashMenuSuppressedDraft, setSlashMenuSuppressedDraft] = useState("");

  const activeSlashQuery = extractActiveSlashQuery(composerDraft);
  const slashQuery = activeSlashQuery?.query ?? "";
  const slashSections = activeSlashQuery
    ? buildSlashCommandSections(
        slashQuery,
        selectedRuntime,
        sessionCommands,
        commandCompatibility,
        {
          allowTreeCommand,
          allowClearCommand,
        },
      )
    : [];
  const slashSuggestions = flattenSlashSections(slashSections);
  const exactSlashCommand = slashSuggestions.find((cmd) => isExactSlashCommand(slashQuery, cmd));
  const activeSlashOptionCommand =
    activeSlashFlow?.command ??
    (exactSlashCommand?.submitMode === "pick-option" ? exactSlashCommand : undefined);
  const showSlashMenu =
    !isRunning &&
    Boolean(activeSlashQuery) &&
    !activeSlashOptionCommand &&
    composerDraft !== slashMenuSuppressedDraft &&
    slashSuggestions.length > 0;
  const selectedSlashCommand = showSlashMenu
    ? slashSuggestions[slashIndex % slashSuggestions.length]
    : undefined;
  const slashOptions = slashOptionsForCommand(activeSlashOptionCommand, selectedRuntime);
  const activeSlashOptionEmptyState = slashOptionEmptyState(
    activeSlashOptionCommand,
    selectedRuntime,
  );
  const showSlashOptionMenu =
    !isRunning &&
    Boolean(activeSlashOptionCommand) &&
    (slashOptions.length > 0 || Boolean(activeSlashOptionEmptyState));
  const selectedSlashOption = showSlashOptionMenu
    ? slashOptions[slashOptionIndex % slashOptions.length]
    : undefined;

  useEffect(() => {
    setSlashIndex(0);
  }, [slashQuery]);

  useEffect(() => {
    if (slashMenuSuppressedDraft && composerDraft !== slashMenuSuppressedDraft) {
      setSlashMenuSuppressedDraft("");
    }
  }, [composerDraft, slashMenuSuppressedDraft]);

  useEffect(() => {
    if (!activeSlashQuery) {
      if (!composerDraft.trim() && activeSlashFlow) {
        return;
      }
      setActiveSlashFlow(undefined);
      setSlashOptionIndex(0);
      return;
    }

    if (
      activeSlashFlow?.command &&
      slashQuery.trim().length > activeSlashFlow.command.command.length
    ) {
      setActiveSlashFlow(undefined);
      setSlashOptionIndex(0);
    }
  }, [activeSlashFlow, activeSlashQuery, slashQuery]);

  useEffect(() => {
    setActiveSlashFlow(undefined);
    setSlashOptionIndex(0);
    setSlashMenuSuppressedDraft("");
  }, [selectedSessionKey]);

  const closeSlashOptionMenu = () => {
    setActiveSlashFlow(undefined);
    setSlashOptionIndex(0);
  };

  const resetSlashUi = () => {
    closeSlashOptionMenu();
    setSlashMenuSuppressedDraft("");
  };

  const fillComposerFromSlash = (draft: string, options?: { suppressMenu?: boolean }) => {
    const nextDraft = activeSlashQuery
      ? `${composerDraft.slice(0, activeSlashQuery.start)}${draft}${composerDraft.slice(activeSlashQuery.end)}`
      : draft;
    setComposerDraft(nextDraft);
    setSlashMenuSuppressedDraft(options?.suppressMenu ? nextDraft : "");
    focusComposer();
  };

  const openSlashOptionMenu = (command: ComposerSlashCommand) => {
    if (!activeSlashQuery?.isPrimary) {
      closeSlashOptionMenu();
      fillComposerFromSlash(command.command);
      return;
    }
    setSlashMenuSuppressedDraft("");
    setActiveSlashFlow({ command });
    setSlashOptionIndex(0);
    setComposerDraft("");
    focusComposer();
  };

  const applySlashCommandSelection = (
    command: ComposerSlashCommand,
    mode: "click" | "tab" | "enter",
  ) => {
    const submitMode = command.submitMode ?? "prefill";
    if (submitMode === "pick-option") {
      openSlashOptionMenu(command);
      return;
    }

    if (!activeSlashQuery?.isPrimary) {
      closeSlashOptionMenu();
      fillComposerFromSlash(submitMode === "prefill" ? command.template : command.command, {
        suppressMenu: true,
      });
      return;
    }

    if (command.kind === "tree") {
      resetSlashUi();
      setComposerDraft("");
      onRunTreeCommand?.();
      return;
    }

    // Tab only completes `/clear`, so a slip of the Tab key never clears the conversation.
    if (command.kind === "clear" && mode !== "tab") {
      resetSlashUi();
      setComposerDraft("");
      onRunClearCommand?.();
      return;
    }

    if (submitMode === "immediate") {
      if (mode === "enter" && immediateCommandMode === "submit") {
        if (!api) {
          return;
        }
        resetSlashUi();
        setComposerDraft(command.command);
        void updateSnapshot(setSnapshot, () => api.submitComposer(command.command))
          .then((state) => {
            setComposerDraft(state.composerDraft);
          })
          .catch((error: unknown) => {
            console.error("[renderer] submitComposer failed", error);
          });
        return;
      }

      closeSlashOptionMenu();
      fillComposerFromSlash(command.command, { suppressMenu: true });
      return;
    }

    closeSlashOptionMenu();
    fillComposerFromSlash(command.template, { suppressMenu: true });
  };

  const applySlashOptionSelection = (option: ComposerSlashOption) => {
    if (!activeSlashOptionCommand) {
      return;
    }

    if (!activeSlashQuery?.isPrimary) {
      closeSlashOptionMenu();
      fillComposerFromSlash(`${activeSlashOptionCommand.command} ${option.value}`, {
        suppressMenu: true,
      });
      return;
    }

    closeSlashOptionMenu();
    fillComposerFromSlash(`${activeSlashOptionCommand.command} ${option.value}`);
  };

  const handleSlashKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if ((showSlashMenu || showSlashOptionMenu) && event.key === "Escape") {
      event.preventDefault();
      resetSlashUi();
      return true;
    }

    if (showSlashOptionMenu && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setSlashOptionIndex((current) =>
        nextMenuIndex(current, event.key === "ArrowDown" ? 1 : -1, slashOptions.length),
      );
      return true;
    }

    if (
      showSlashOptionMenu &&
      (event.key === "Tab" || event.key === "Enter") &&
      selectedSlashOption
    ) {
      event.preventDefault();
      applySlashOptionSelection(selectedSlashOption);
      return true;
    }

    if (showSlashMenu && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setSlashIndex((current) =>
        nextMenuIndex(current, event.key === "ArrowDown" ? 1 : -1, slashSuggestions.length),
      );
      return true;
    }

    if (showSlashMenu && event.key === "Tab" && selectedSlashCommand) {
      event.preventDefault();
      applySlashCommandSelection(selectedSlashCommand, "tab");
      return true;
    }

    if (
      showSlashMenu &&
      event.key === "Enter" &&
      selectedSlashCommand &&
      !slashQuery.includes(" ")
    ) {
      event.preventDefault();
      applySlashCommandSelection(selectedSlashCommand, "enter");
      return true;
    }

    return false;
  };

  return {
    slashSections,
    slashSuggestions,
    showSlashMenu,
    showSlashOptionMenu,
    selectedSlashCommand,
    selectedSlashOption,
    slashOptions,
    slashOptionEmptyState: activeSlashOptionEmptyState,
    activeSlashFlow,
    activeSlashOptionCommand,
    resetSlashUi,
    applySlashCommandSelection,
    applySlashOptionSelection,
    handleSlashKeyDown,
    fillComposerFromSlash,
  };
}
