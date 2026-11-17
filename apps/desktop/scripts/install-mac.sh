#!/bin/bash
# Installs AI Coding at Home on a Mac with an Apple chip (M1 or newer):
#
#   curl -fsSL <site>/install-mac.sh | bash
#
# The app is downloaded with curl, so macOS does not mark it as "downloaded from the internet"
# and opens it without the "unidentified developer" prompt. It goes into /Applications, or into
# ~/Applications when /Applications is not writable (no administrator password needed).
set -euo pipefail

# Where the app's zip is published (hosting not decided yet: replace before publishing).
DOWNLOAD_URL="https://github.com/crisdesivo/ai-coding-at-home/releases/latest/download/AI-Coding-at-Home-arm64-mac.zip"

APP_NAME="AI Coding at Home"

say() { printf '%s\n' "$*"; }
die() {
  printf '\nCould not install %s: %s\n' "$APP_NAME" "$*" >&2
  exit 1
}

if [ "$(uname -s)" != "Darwin" ]; then
  die "this installer is for macOS. Download the Windows or Linux version from the website instead."
fi

# Under Rosetta, uname -m says x86_64 even on an Apple chip; ask the hardware instead.
if [ "$(uname -m)" != "arm64" ] && [ "$(sysctl -in hw.optional.arm64 2>/dev/null || true)" != "1" ]; then
  die "this Mac has an Intel processor. $APP_NAME needs a Mac with an Apple chip (M1 or newer); Intel Macs are not supported."
fi

for tool in curl ditto; do
  command -v "$tool" >/dev/null 2>&1 || die "the '$tool' command is missing from this Mac."
done

if [ -w /Applications ]; then
  DEST_DIR="/Applications"
else
  DEST_DIR="$HOME/Applications"
  mkdir -p "$DEST_DIR" || die "could not create $DEST_DIR."
fi
DEST="$DEST_DIR/$APP_NAME.app"

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ai-coding-at-home.XXXXXX")" || die "could not create a temporary folder."
trap 'rm -rf "$WORK_DIR"' EXIT

say "Downloading $APP_NAME…"
if ! curl -fL --progress-bar --retry 3 --connect-timeout 20 -o "$WORK_DIR/app.zip" "$DOWNLOAD_URL"; then
  die "the download failed. Check your internet connection and run the command again."
fi

say "Unpacking…"
if ! ditto -x -k "$WORK_DIR/app.zip" "$WORK_DIR/unpacked"; then
  die "the downloaded file is damaged. Run the command again to download it again."
fi
[ -d "$WORK_DIR/unpacked/$APP_NAME.app" ] || die "the downloaded file does not contain $APP_NAME.app."

if pgrep -xq "$APP_NAME" 2>/dev/null; then
  say "Closing the running $APP_NAME…"
  osascript -e "tell application \"$APP_NAME\" to quit" >/dev/null 2>&1 || true
  sleep 2
fi

say "Installing into $DEST_DIR…"
if [ -e "$DEST" ]; then
  rm -rf "$DEST" || die "could not replace the existing $DEST. Quit the app and run the command again."
fi
ditto "$WORK_DIR/unpacked/$APP_NAME.app" "$DEST" || die "could not copy the app into $DEST_DIR."

# curl does not set the quarantine flag, but remove it in case something else did.
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

say "Opening $APP_NAME…"
open "$DEST" || die "the app was installed in $DEST but could not be opened. Try opening it from Finder."

say ""
say "$APP_NAME is installed in $DEST_DIR."
say "The first launch checks your Mac and downloads the AI model that fits it; this can take a while."
