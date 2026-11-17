import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  EngineServer,
  EngineStartError,
  LogRing,
  explainEngineFailure,
  findFreePort,
  serverArgs,
  type ServerPhase,
} from "../../electron/engine/server";
import { findServerBinary } from "../../electron/engine/locate";
import { engineManagerEnabled } from "../../electron/engine/manager";

test("starts llama-server with the 100k-context coding settings", () => {
  expect(serverArgs({ modelPath: "/m/model.gguf", modelId: "qwen3.5-9b", port: 41234 })).toEqual([
    "--jinja",
    "-c",
    "102400",
    "-np",
    "1",
    "-ctk",
    "q8_0",
    "-ctv",
    "q8_0",
    "-fa",
    "on",
    "--fit",
    "on",
    "--host",
    "127.0.0.1",
    "--port",
    "41234",
    "--alias",
    "qwen3.5-9b",
    "-m",
    "/m/model.gguf",
  ]);
});

test("keeps the last lines of the log, split across chunks", () => {
  const ring = new LogRing(3);
  ring.push("one\ntw");
  ring.push("o\nthree\n\x1b[31mfour\x1b[0m\n");
  ring.push("fi");
  expect(ring.tail()).toEqual(["three", "four", "fi"]);
});

test("explains common failures in plain words", () => {
  const exit = { code: 1, signal: null };
  expect(
    explainEngineFailure(
      ["ggml_backend_cuda_buffer_type_alloc_buffer: cudaMalloc failed: out of memory"],
      exit,
    ),
  ).toContain("ran out of memory");
  expect(
    explainEngineFailure(["error while loading shared libraries: libvulkan.so.1"], exit),
  ).toContain("missing some of its files");
  expect(
    explainEngineFailure(
      ["couldn't bind HTTP server socket, hostname: 127.0.0.1, port: 8080"],
      exit,
    ),
  ).toContain("port");
  expect(
    explainEngineFailure(["llama_model_load: error loading model: invalid magic"], exit),
  ).toContain("damaged");
  expect(explainEngineFailure(["something"], { code: null, signal: "SIGKILL" })).toContain(
    "SIGKILL",
  );
  expect(explainEngineFailure(["something"], { code: 3, signal: null })).toContain("exit code 3");
  // Under the POSIX watchdog a signal shows up as 128 + its number, and a missing binary as 127.
  expect(explainEngineFailure(["something"], { code: 137, signal: null })).toContain("SIGKILL");
  expect(
    explainEngineFailure(["sh: 1: llama-server: not found"], { code: 127, signal: null }),
  ).toContain("missing");
});

test("finds a free port, and the preferred one when free", async () => {
  const port = await findFreePort();
  expect(port).toBeGreaterThan(0);
  expect(await findFreePort(port)).toBe(port);
});

test("the engine manager stays out of dev setups and automated tests", () => {
  expect(engineManagerEnabled({})).toBe(true);
  expect(engineManagerEnabled({ PI_AT_HOME_MODEL_CONFIG: "/x/local-model.json" })).toBe(false);
  expect(engineManagerEnabled({ PI_AT_HOME_ENGINE: "off" })).toBe(false);
  expect(engineManagerEnabled({ PI_APP_TEST_MODE: "background" })).toBe(false);
  expect(engineManagerEnabled({ PI_APP_TEST_MODE: "background", PI_AT_HOME_ENGINE: "on" })).toBe(
    true,
  );
});

test("finds llama-server inside a release archive's nested folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "engine-locate-"));
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(root, "linux", "llama-b12445"), { recursive: true });
  await writeFile(join(root, "linux", "llama-b12445", "llama-server"), "");
  await mkdir(join(root, "win", "llama-b12445"), { recursive: true });
  await writeFile(join(root, "win", "llama-b12445", "llama-server.exe"), "");
  expect(findServerBinary(root, "linux")).toBe(join(root, "linux", "llama-b12445", "llama-server"));
  expect(findServerBinary(root, "win32")).toBe(
    join(root, "win", "llama-b12445", "llama-server.exe"),
  );
  expect(findServerBinary(join(root, "missing"), "linux")).toBeUndefined();
});

/** A stand-in llama-server: answers /health; FAKE_MODE picks how it misbehaves. */
async function fakeServer(mode: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "engine-fake-"));
  const script = join(dir, "llama-server");
  await writeFile(
    script,
    `#!${process.execPath}
const http = require("node:http");
const fs = require("node:fs");
const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]);
const mode = ${JSON.stringify(mode)};
const countFile = __filename + ".count";
const count = (fs.existsSync(countFile) ? Number(fs.readFileSync(countFile, "utf8")) : 0) + 1;
fs.writeFileSync(countFile, String(count));
console.log("fake llama-server start " + count);
if (mode === "fail") { console.error("llama_model_load: error loading model: invalid magic"); process.exit(1); }
http.createServer((req, res) => { res.writeHead(200); res.end("{}"); }).listen(port, "127.0.0.1", () => {
  console.log("server is listening on http://127.0.0.1:" + port);
  if (mode === "crash-always" || (mode === "crash-once" && count === 1)) {
    setTimeout(() => { console.error("ggml: out of memory"); process.exit(2); }, 2000);
  }
});
`,
  );
  await chmod(script, 0o755);
  return script;
}

const unixOnly = process.platform === "win32";

test("starts, waits for /health and stops", async () => {
  test.skip(unixOnly, "uses a shebang script as the server");
  const serverPath = await fakeServer("ok");
  const phases: ServerPhase[] = [];
  const server = new EngineServer({ onPhase: (phase) => phases.push(phase) });
  const port = await findFreePort();
  await server.start({ serverPath, modelPath: "/m.gguf", modelId: "m", port });
  expect(server.currentPhase).toBe("running");
  expect(server.pid).toBeGreaterThan(0);
  await server.stop();
  expect(phases).toEqual(["starting", "running", "stopped"]);
  expect(server.logTail().join("\n")).toContain("fake llama-server start 1");
});

test("a start failure rejects with the reason and the log", async () => {
  test.skip(unixOnly, "uses a shebang script as the server");
  const serverPath = await fakeServer("fail");
  const server = new EngineServer();
  const error = await server
    .start({ serverPath, modelPath: "/m.gguf", modelId: "m", port: await findFreePort() })
    .catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(EngineStartError);
  expect((error as EngineStartError).message).toContain("damaged");
  expect((error as EngineStartError).logTail.join("\n")).toContain("invalid magic");
  expect(server.currentPhase).toBe("crashed");
});

test("a crash after starting restarts once, a second crash stays down with the reason", async () => {
  test.skip(unixOnly, "uses a shebang script as the server");
  const once = await fakeServer("crash-once");
  const recovered = new EngineServer();
  await recovered.start({
    serverPath: once,
    modelPath: "/m.gguf",
    modelId: "m",
    port: await findFreePort(),
  });
  await expect.poll(async () => readFile(`${once}.count`, "utf8"), { timeout: 10_000 }).toBe("2");
  await expect.poll(() => recovered.currentPhase, { timeout: 10_000 }).toBe("running");
  await recovered.stop();

  const always = await fakeServer("crash-always");
  const down = new EngineServer();
  await down.start({
    serverPath: always,
    modelPath: "/m.gguf",
    modelId: "m",
    port: await findFreePort(),
  });
  await expect.poll(() => down.currentPhase, { timeout: 15_000 }).toBe("crashed");
  expect(down.reason).toContain("ran out of memory");
  expect(await readFile(`${always}.count`, "utf8")).toBe("2");
});
