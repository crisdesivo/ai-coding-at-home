import { useTranslation } from "../../i18n";
import { CloseIcon } from "../../ui/icons";

interface ClearConversationNoticeProps {
  readonly onUndo: () => void;
  readonly onDismiss: () => void;
}

/** The toast after Clear conversation, with Undo while the old thread can come back. */
export function ClearConversationNotice({ onUndo, onDismiss }: ClearConversationNoticeProps) {
  const { t } = useTranslation();
  return (
    <div
      className="clear-conversation-notice"
      data-testid="clear-conversation-notice"
      role="status"
    >
      <span className="clear-conversation-notice__text">{t("conversation.cleared.message")}</span>
      <button className="clear-conversation-notice__undo" type="button" onClick={onUndo}>
        {t("conversation.cleared.undo")}
      </button>
      <button
        aria-label={t("conversation.cleared.dismiss")}
        className="clear-conversation-notice__dismiss"
        type="button"
        onClick={onDismiss}
      >
        <CloseIcon />
      </button>
    </div>
  );
}
