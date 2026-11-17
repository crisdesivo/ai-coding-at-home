// Preloaded into every driver test (`node --import`). pi writes session files under
// `$PI_CODING_AGENT_DIR/sessions` (default `~/.pi/agent`), and a test that does not set
// its own agent dir would otherwise write into the developer's real pi home. The test
// runner process makes one temp dir; the test files it spawns inherit it through the env.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MARKER = "PI_GUI_DRIVER_TEST_AGENT_DIR";

if (!process.env[MARKER]) {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-driver-test-agent-"));
  process.env[MARKER] = agentDir;
  process.on("exit", () => {
    rmSync(agentDir, { recursive: true, force: true });
  });
}
process.env.PI_CODING_AGENT_DIR = process.env[MARKER];
delete process.env.PI_CODING_AGENT_SESSION_DIR;
