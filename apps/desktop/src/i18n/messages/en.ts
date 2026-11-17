/*
 * English copy is the source of truth and the fallback: `MessageKey` is derived
 * from this object, so `t()` accepts only these keys, and any key another catalog
 * leaves out renders this copy. Keys are dotted and flat (no nesting) so
 * `t("settings.nav.general")` stays a checked literal.
 */
import type { PluralCategory, PluralVariantKey } from "../plural";

export const en = {
  "settings.workspace.label": "Workspace",
  "windowControls.label": "Window controls",
  "windowControls.minimize": "Minimize window",
  "windowControls.maximize": "Maximize or restore window",
  "windowControls.close": "Close window",
  "secondarySurface.backToApp": "Back to app",
  "secondarySurface.sectionsLabel": "{title} sections",
  "secondarySurface.searchLabel": "Search {title}",
  "secondarySurface.searchPlaceholder": "Search",
  "secondarySurface.noMatches": "No matches for “{query}”",
  "settings.title": "Settings",
  "settings.thisWorkspace": "this workspace",
  "settings.selectWorkspace.title": "Select a workspace",
  "settings.selectWorkspace.body":
    "Providers and models are set per workspace. Choose one, or open a folder first.",
  "settings.nav.general": "General",
  "settings.nav.appearance": "Appearance",
  "settings.nav.notifications": "Notifications",
  "settings.nav.shortcuts": "Keyboard shortcuts",
  "settings.nav.customize": "Skills and extensions",
  "settings.group.app": "App",
  "settings.group.customize": "Customize",
  "settings.section.general.description": "App and runtime defaults.",
  "settings.section.appearance.description":
    "Choose light, dark or system mode and a color preset.",
  "settings.section.notifications.description": "Choose which background events alert you.",
  "settings.section.shortcuts.description": "Shortcuts available across the app.",
  "settings.general.groupAgent": "Agent",
  "settings.general.skillCommands.title": "Skill slash commands",
  "settings.general.skillCommands.description":
    "Offer each skill as a slash command in the composer.",
  "settings.general.skillCommands.label": "Enable skill slash commands",
  "settings.general.groupTerminal": "Terminal",
  "settings.general.shell.title": "Shell",
  "settings.general.shell.description":
    "The shell the integrated terminal starts. Leave blank to use your login shell.",
  "settings.general.shell.label": "Shell of integrated terminal",
  "settings.engine.group": "AI engine",
  "settings.engine.model.title": "Model",
  "settings.engine.status.title": "Status",
  "settings.engine.status.running": "Running",
  "settings.engine.status.starting": "Starting…",
  "settings.engine.status.crashed": "Stopped",
  "settings.engine.status.stopped": "Stopped",
  "settings.engine.backend.title": "Engine",
  "settings.engine.backend.vulkan": "Vulkan (standard)",
  "settings.engine.backend.cuda": "CUDA (NVIDIA)",
  "settings.engine.backend.metal": "Metal (Apple)",
  "settings.engine.backend.cpu": "Processor only",
  "settings.engine.port.title": "Port",
  "settings.engine.nvidia.title": "Faster NVIDIA engine",
  "settings.engine.nvidia.downloading": "Downloading",
  "settings.engine.nvidia.ready": "Downloaded",
  "settings.engine.nvidia.inUse": "In use",
  "settings.engine.nvidia.failed": "Not used",
  "settings.engine.nvidia.skipped": "Skipped",
  "settings.engine.recheck.title": "Re-check my computer",
  "settings.engine.recheck.description":
    "Checks the graphics card, memory and free disk space again, and offers a better model if one fits.",
  "settings.engine.recheck.button": "Re-check",
  "settings.engine.log.title": "Engine log",
  "settings.engine.log.description": "The AI engine's messages, useful when something goes wrong.",
  "settings.engine.log.button": "Show engine log",
  "settings.engine.restart.button": "Restart",
  "settings.engine.external.title": "Your own AI server",
  "settings.engine.external.description":
    "This app uses an AI server you started yourself, as set in local-model.json.",
  "engine.notice.restart": "Restart",
  "engine.notice.restarting": "Restarting…",
  "engine.notice.showLog": "Show log",
  "engine.notice.hideLog": "Hide log",
  "settings.appearance.groupTheme": "Theme",
  "settings.appearance.themeLabel": "Theme",
  "settings.appearance.mode.system": "System",
  "settings.appearance.mode.light": "Light",
  "settings.appearance.mode.dark": "Dark",
  "settings.appearance.language.title": "Language",
  "settings.appearance.language.description":
    "Follow the system language, or pick the language AI Coding at Home shows.",
  "settings.appearance.language.label": "Language",
  "settings.appearance.language.system": "Follow system",
  "settings.appearance.colorPreset.title": "Color preset",
  "settings.appearance.colorPreset.label": "Color preset",
  "settings.appearance.transparency.title": "Window transparency",
  "settings.appearance.transparency.description":
    "Let desktop colors show through supported surfaces.",
  "settings.appearance.transparency.label": "Window transparency",
  "settings.appearance.preset.default": "The default AI Coding at Home palette.",
  "settings.appearance.preset.catppuccin": "Soft pastel Latte and Mocha variants.",
  "settings.appearance.preset.tokyo-night": "A cool editor palette with a bright Day variant.",
  "settings.appearance.preset.nord": "Low-contrast arctic neutrals and blue accents.",
  "settings.appearance.preset.dracula": "Dracula and its official Alucard light variant.",
  "settings.appearance.preset.gruvbox": "Warm retro contrast.",
  "settings.appearance.preset.github": "GitHub-style light and dark surfaces.",
  "settings.appearance.preset.vscode": "Familiar editor colours with blue accents.",
  "settings.notifications.groupSystem": "System",
  "settings.notifications.groupSystem.description":
    "macOS decides whether AI Coding at Home can show desktop notifications at all.",
  "settings.notifications.access.title": "macOS notification access",
  "settings.notifications.access.enabled": "Enabled",
  "settings.notifications.access.turnedOff": "Turned off",
  "settings.notifications.access.notEnabled": "Not enabled yet",
  "settings.notifications.access.unavailable": "Unavailable",
  "settings.notifications.access.checking": "Checking…",
  "settings.notifications.access.descriptionGranted":
    "macOS will allow AI Coding at Home to show desktop notifications for background thread updates.",
  "settings.notifications.access.descriptionDenied":
    "macOS notifications are turned off for AI Coding at Home. Enable them in System Settings to receive background completion alerts.",
  "settings.notifications.access.descriptionDefault":
    "AI Coding at Home has not asked macOS for desktop notification access yet.",
  "settings.notifications.access.descriptionUnsupported":
    "Desktop notifications are unavailable on this system.",
  "settings.notifications.access.descriptionChecking":
    "Checking whether macOS notifications are available for AI Coding at Home.",
  "settings.notifications.turnOn.title": "Turn on notifications",
  "settings.notifications.turnOn.descriptionAsk":
    "AI Coding at Home asks macOS when active work first moves into the background. You can also ask now.",
  "settings.notifications.turnOn.descriptionOpen":
    "macOS notifications are already turned off for AI Coding at Home. Open System Settings to enable them again.",
  "settings.notifications.turnOn.ask": "Ask macOS",
  "settings.notifications.turnOn.openSettings": "Open System Settings",
  "settings.notifications.groupInApp": "In-app alerts",
  "settings.notifications.groupInApp.description":
    "Choose which background events should try to notify once macOS access is enabled.",
  "settings.notifications.completion.title": "Background completion",
  "settings.notifications.completion.description": "Notify when a background session finishes.",
  "settings.notifications.failures.title": "Background failures",
  "settings.notifications.failures.description": "Notify when a background session fails.",
  "settings.notifications.attention.title": "Needs input or approval",
  "settings.notifications.attention.description": "Notify when input is needed to continue.",
  "settings.shortcuts.groupApp": "App",
  "settings.shortcuts.groupThreads": "Threads",
  "settings.shortcuts.groupComposer": "Composer",
  "settings.shortcuts.groupWorkbench": "Workbench",
  "settings.shortcuts.commandPalette": "Command palette",
  "settings.shortcuts.goToFile": "Go to file",
  "settings.shortcuts.openSettings": "Open settings",
  "settings.shortcuts.toggleSidebar": "Toggle sidebar",
  "settings.shortcuts.toggleSidePanel": "Toggle side panel",
  "settings.shortcuts.newWindow": "New window",
  "settings.shortcuts.newThread": "New thread",
  "settings.shortcuts.switchRecent": "Switch to recent thread",
  "settings.shortcuts.cycleThreads": "Cycle through threads",
  "settings.shortcuts.findInThread": "Find in thread",
  "settings.shortcuts.clearConversation": "Clear conversation",
  "settings.shortcuts.send": "Send message, or queue it during a run",
  "settings.shortcuts.steer": "Steer the running agent",
  "settings.shortcuts.newLine": "New line",
  "settings.shortcuts.toggleTerminal": "Toggle terminal",
  "settings.shortcuts.newTerminalTab": "New terminal tab",
  "settings.shortcuts.toggleReview": "Toggle review",
  "settings.shortcuts.switchSidePanelTab": "Switch to side panel tab",
  "settings.shortcuts.closeWorkbenchTab": "Close workbench tab",
  "settings.controls.choose": "Choose…",
  "conversation.cleared.message": "Conversation cleared",
  "conversation.cleared.undo": "Undo",
  "conversation.cleared.dismiss": "Dismiss",
  "runFailure.outOfRoom.title":
    "The local AI ran out of room in this conversation before it could answer.",
  "runFailure.outOfRoom.body":
    "Summarize the earlier messages to make room and try again, or start a fresh conversation.",
  "runFailure.compactionFailed.title":
    "The local AI couldn’t summarize this conversation to make room.",
  "runFailure.compactionFailed.body":
    "Start a fresh conversation to keep going. This one stays under Archived, so nothing is lost.",
  "runFailure.noReply.title": "The local AI stopped without writing an answer.",
  "runFailure.noReply.body":
    "Try again. If it keeps happening, summarize the earlier messages to make room, or start a fresh conversation.",
  "runFailure.unreachable.title": "Couldn’t reach the local AI.",
  "runFailure.unreachable.body": "Make sure the local AI is running, then try again.",
  "runFailure.modelError.title": "The local AI ran into a problem and couldn’t answer.",
  "runFailure.modelError.body": "Try again, or start a fresh conversation if it keeps happening.",
  "runFailure.details": "Details: {message}",
  "runFailure.summarizeAndRetry": "Summarize and try again",
  "runFailure.retry": "Try again",
  "runFailure.startFresh": "Start fresh",
  "timeline.compacting": "Summarizing earlier messages to make room…",
  "timeline.compacted": "Summarized earlier messages to make room",
  "timeline.compactionSummary": "Summary of earlier messages",
  "runProgress.waiting": "Reading the conversation…",
  "runProgress.thinking": "Thinking…",
  "runProgress.replying": "Writing a reply…",
  "runProgress.writingCommand": "Writing a command…",
  "runProgress.writingFile": "Writing {file}…",
  "runProgress.runningCommand": "Running {command}…",
  "runProgress.runningTool": "Running {tool}…",
  "runProgress.savingFile": "Saving {file}…",
  "runProgress.readingFile": "Reading {file}…",
  "runProgress.tokens": "{count} tokens",
  "runProgress.tokens_one": "{count} token",
  "runProgress.tokens_other": "{count} tokens",
  "runProgress.speed": "{speed} tokens/s",
  "runProgress.stepElapsed": "this step {duration}",
  "runProgress.turnElapsed": "Working for {duration}",
  "runProgress.working": "Working…",
  "runProgress.quiet": "The local AI hasn't produced anything for {count} min",
  "runProgress.quietHint": "It may still be reading a long conversation. You can wait, or stop it.",
  "runProgress.stop": "Stop",
  "duration.seconds": "{seconds}s",
  "duration.minutes": "{minutes}m {seconds}s",
  "duration.hours": "{hours}h {minutes}m",
  "createProject.title": "Create project",
  "createProject.description":
    "Makes a new folder for your work and opens it, ready for your first thread.",
  "createProject.close": "Close",
  "createProject.nameLabel": "Project name",
  "createProject.namePlaceholder": "My project",
  "createProject.locationLabel": "Location",
  "createProject.loadingLocation": "Finding a location…",
  "createProject.change": "Change…",
  "createProject.folderName": "“{name}” becomes the folder “{folder}”",
  "createProject.willCreate": "Will create {path}",
  "createProject.spacesWarning":
    "Paths with spaces can confuse the AI; consider a folder without spaces.",
  "createProject.exists": "A folder with this name already exists",
  "createProject.openInstead": "Open it instead",
  "createProject.cancel": "Cancel",
  "createProject.create": "Create project",
  "createProject.creating": "Creating…",
  "createProject.problem.noLetters": "Use at least one letter or number.",
  "createProject.problem.reserved": "Windows reserves this name. Choose another one.",
  "createProject.problem.tooLong": "Use {max} characters or fewer.",
  "createProject.sidebarButton": "New project",
  "createProject.emptyStateButton": "Create a new project",
  "createProject.paletteAction": "Create project…",
  "createProject.pickerOption": "Create a new project…",
} as const;

export type MessageKey = keyof typeof en;

/** The plain messages, without plural variants. */
export type RequiredMessageKey = Exclude<MessageKey, PluralVariantKey>;

/** Keys English gives plural forms to, e.g. `models.count` for `models.count_one`. */
type PluralBaseKey = MessageKey extends infer Key
  ? Key extends `${infer Base}_${PluralCategory}`
    ? Base
    : never
  : never;

/**
 * A plural form of one of those keys in any CLDR category, so a language with
 * `few` or `many` (Russian, Polish, Arabic) can add forms English does not have.
 */
export type PluralFormKey = `${PluralBaseKey}_${PluralCategory}`;

/**
 * Every plain key, values widened to `string`. Plural variants (`key_one`,
 * `key_few`, …) are optional because a language only defines the categories its
 * grammar has; `translate.ts` reuses the plain key for the ones it leaves out.
 * Other locales are typed `Partial<Messages>` and fall back to English.
 */
export type Messages = Record<RequiredMessageKey, string> &
  Partial<Record<MessageKey | PluralFormKey, string>>;
