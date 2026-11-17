import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { DesktopAppState } from "../../../contracts/desktop-state";
import type { PiDesktopApi } from "../../../contracts/ipc";
import {
  checkProjectName,
  pathHasSpaces,
  previewProjectPath,
  PROJECT_NAME_MAX_LENGTH,
  type ProjectNameProblem,
} from "../../../contracts/projects";
import { useTranslation, type MessageKey } from "../../i18n";
import { trapDialogFocus } from "../../ui/dialog-focus";

interface CreateProjectDialogProps {
  readonly api: PiDesktopApi;
  readonly onClose: () => void;
  /** The project folder is now a workspace and New thread is open on it. */
  readonly onOpened: (state: DesktopAppState) => void;
}

const PROBLEM_MESSAGES: Record<Exclude<ProjectNameProblem, "empty">, MessageKey> = {
  noLetters: "createProject.problem.noLetters",
  reserved: "createProject.problem.reserved",
  tooLong: "createProject.problem.tooLong",
};

export function CreateProjectDialog({ api, onClose, onOpened }: CreateProjectDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [parentDir, setParentDir] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  /** The folder that already has the typed name, offered to open instead. */
  const [existingPath, setExistingPath] = useState<string | undefined>();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    let cancelled = false;
    api
      .getProjectLocation()
      .then((location) => {
        if (!cancelled) setParentDir(location);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const check = checkProjectName(name);
  const problem =
    !check.ok && check.problem !== "empty"
      ? t(PROBLEM_MESSAGES[check.problem], { max: PROJECT_NAME_MAX_LENGTH })
      : undefined;
  const targetPath =
    check.ok && parentDir ? previewProjectPath(parentDir, check.name, api.platform) : undefined;
  const canCreate = Boolean(targetPath) && !busy && !existingPath;
  // A gentle nudge only: the user may keep a location with spaces.
  const locationHasSpaces = parentDir ? pathHasSpaces(parentDir) : false;

  const reportError = (reason: unknown) => {
    setError(reason instanceof Error ? reason.message : String(reason));
    setBusy(false);
  };

  const run = (openExisting: boolean) => {
    if (!parentDir || !check.ok) return;
    setBusy(true);
    setError(undefined);
    api
      .createProject({ name, parentDir, ...(openExisting ? { openExisting: true } : {}) })
      .then((result) => {
        if (result.kind === "exists") {
          setExistingPath(result.path);
          setBusy(false);
          return;
        }
        onOpened(result.state);
      })
      .catch(reportError);
  };

  const changeLocation = () => {
    setError(undefined);
    api
      .pickProjectLocation()
      .then((picked) => {
        if (picked) {
          setParentDir(picked);
          setExistingPath(undefined);
        }
      })
      .catch(reportError)
      .finally(() => inputRef.current?.focus());
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (canCreate) run(false);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      trapDialogFocus(event, dialogRef.current);
      return;
    }
    if (event.key === "Escape" && !busy) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      className="tree-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        aria-modal="true"
        aria-labelledby="create-project-title"
        className="tree-modal tree-modal--compact"
        data-testid="create-project-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="tree-modal__header">
          <div>
            <h2 className="tree-modal__title" id="create-project-title">
              {t("createProject.title")}
            </h2>
            <p className="tree-modal__summary-copy create-project__intro">
              {t("createProject.description")}
            </p>
          </div>
          <button
            aria-label={t("createProject.close")}
            className="tree-modal__close"
            disabled={busy}
            type="button"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <form className="create-project__form" onSubmit={handleSubmit}>
          <label className="create-project__field">
            <span className="create-project__label">{t("createProject.nameLabel")}</span>
            <input
              ref={inputRef}
              className="tree-modal__search"
              data-testid="create-project-name"
              placeholder={t("createProject.namePlaceholder")}
              spellCheck={false}
              value={name}
              aria-invalid={problem ? true : undefined}
              onChange={(event) => {
                setName(event.target.value);
                setExistingPath(undefined);
                setError(undefined);
              }}
            />
          </label>

          <div className="create-project__location">
            <span className="create-project__label">{t("createProject.locationLabel")}</span>
            <span className="create-project__location-path" data-testid="create-project-location">
              {parentDir ?? t("createProject.loadingLocation")}
            </span>
            <button
              className="button button--secondary"
              disabled={busy}
              type="button"
              onClick={changeLocation}
            >
              {t("createProject.change")}
            </button>
          </div>

          {locationHasSpaces ? (
            <div
              className="tree-modal__hint create-project__spaces-warning"
              data-testid="create-project-spaces-warning"
            >
              {t("createProject.spacesWarning")}
            </div>
          ) : null}

          {problem ? (
            <div className="create-project__problem" role="alert">
              {problem}
            </div>
          ) : targetPath ? (
            <div className="tree-modal__hint create-project__path">
              <div data-testid="create-project-folder-name">
                {t("createProject.folderName", { name: name.trim(), folder: check.name })}
              </div>
              <div data-testid="create-project-path">
                {t("createProject.willCreate", { path: targetPath })}
              </div>
            </div>
          ) : null}

          {existingPath ? (
            <div
              className="tree-modal__error error-banner create-project__exists"
              data-testid="create-project-exists"
              role="alert"
            >
              <span>{t("createProject.exists")}</span>
              <button
                className="button button--secondary"
                disabled={busy}
                type="button"
                onClick={() => run(true)}
              >
                {t("createProject.openInstead")}
              </button>
            </div>
          ) : null}

          {error ? (
            <div className="tree-modal__error error-banner" data-testid="create-project-error">
              {error}
            </div>
          ) : null}

          <div className="tree-modal__actions create-project__actions">
            <button
              className="button button--secondary"
              disabled={busy}
              type="button"
              onClick={onClose}
            >
              {t("createProject.cancel")}
            </button>
            <button
              className="button button--primary"
              data-testid="create-project-confirm"
              disabled={!canCreate}
              type="submit"
            >
              {busy ? t("createProject.creating") : t("createProject.create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
