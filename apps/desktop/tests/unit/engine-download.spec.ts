import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  DownloadError,
  downloadFile,
  partPath,
  type DownloadProgress,
  type WritableFile,
} from "../../electron/engine/download";

const DATA = randomBytes(3 * 1024 * 1024 + 123);
const SHA = createHash("sha256").update(DATA).digest("hex");
const MB = 1024 * 1024;

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

/** Serves DATA with Range support; `handler` can take over for error cases. */
async function serve(handler?: Handler): Promise<{
  readonly url: string;
  readonly server: Server;
  readonly ranges: Array<string | undefined>;
}> {
  const ranges: Array<string | undefined> = [];
  const server = createServer((request, response) => {
    ranges.push(request.headers.range);
    if (handler) {
      handler(request, response);
      return;
    }
    sendRange(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/model.gguf`, server, ranges };
}

function sendRange(request: IncomingMessage, response: ServerResponse, body = DATA): void {
  const match = /bytes=(\d+)-/.exec(request.headers.range ?? "");
  if (match) {
    const start = Number(match[1]);
    if (start >= body.length) {
      response.writeHead(416).end();
      return;
    }
    response.writeHead(206, {
      "Content-Length": body.length - start,
      "Content-Range": `bytes ${start}-${body.length - 1}/${body.length}`,
    });
    response.end(body.subarray(start));
    return;
  }
  response.writeHead(200, { "Content-Length": body.length });
  response.end(body);
}

async function tempDest(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "engine-download-"));
  return join(dir, "models", "model.gguf");
}

const plenty = async () => 1e12;

test("downloads, verifies the checksum and reports progress", async () => {
  const { url, server } = await serve();
  const destination = await tempDest();
  const progress: DownloadProgress[] = [];
  try {
    const result = await downloadFile({
      url,
      destination,
      expectedSize: DATA.length,
      sha256: SHA,
      freeBytes: plenty,
      progressIntervalMs: 0,
      onProgress: (entry) => progress.push(entry),
    });
    expect(result.sha256).toBe(SHA);
    expect((await readFile(destination)).equals(DATA)).toBe(true);
    await expect(stat(partPath(destination))).rejects.toThrow();
    expect(progress.some((entry) => entry.phase === "downloading")).toBe(true);
    expect(progress[progress.length - 1]?.phase).toBe("verifying");
    expect(progress[progress.length - 1]?.receivedBytes).toBe(DATA.length);
  } finally {
    server.close();
  }
});

test("resumes from the .part file with a Range request", async () => {
  const { url, server, ranges } = await serve();
  const destination = await tempDest();
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(destination, ".."), { recursive: true });
  await writeFile(partPath(destination), DATA.subarray(0, MB));
  const progress: DownloadProgress[] = [];
  try {
    await downloadFile({
      url,
      destination,
      expectedSize: DATA.length,
      sha256: SHA,
      freeBytes: plenty,
      progressIntervalMs: 0,
      onProgress: (entry) => progress.push(entry),
    });
    expect(ranges[ranges.length - 1]).toBe(`bytes=${MB}-`);
    expect((await readFile(destination)).equals(DATA)).toBe(true);
    expect(progress.find((entry) => entry.phase === "downloading")?.resumedFromBytes).toBe(MB);
  } finally {
    server.close();
  }
});

test("starts over when the server ignores the Range request", async () => {
  const { url, server } = await serve((request, response) => {
    response.writeHead(200, { "Content-Length": DATA.length });
    response.end(DATA);
  });
  const destination = await tempDest();
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(destination, ".."), { recursive: true });
  await writeFile(partPath(destination), DATA.subarray(0, MB));
  try {
    await downloadFile({
      url,
      destination,
      expectedSize: DATA.length,
      sha256: SHA,
      freeBytes: plenty,
    });
    expect((await readFile(destination)).equals(DATA)).toBe(true);
  } finally {
    server.close();
  }
});

test("a checksum mismatch deletes the file and says so", async () => {
  const corrupt = Buffer.from(DATA);
  corrupt[1000] = (corrupt[1000] ?? 0) ^ 0xff;
  const { url, server } = await serve((request, response) => sendRange(request, response, corrupt));
  const destination = await tempDest();
  try {
    const error = await downloadFile({
      url,
      destination,
      expectedSize: DATA.length,
      sha256: SHA,
      freeBytes: plenty,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DownloadError);
    expect((error as DownloadError).kind).toBe("checksum");
    expect((error as DownloadError).message).toContain("damaged");
    await expect(stat(partPath(destination))).rejects.toThrow();
    await expect(stat(destination)).rejects.toThrow();
  } finally {
    server.close();
  }
});

for (const status of [404, 500, 503]) {
  test(`a server error ${status} becomes a readable error`, async () => {
    const { url, server } = await serve((_request, response) => response.writeHead(status).end());
    const destination = await tempDest();
    try {
      const error = (await downloadFile({
        url,
        destination,
        expectedSize: DATA.length,
        freeBytes: plenty,
      }).catch((caught: unknown) => caught)) as DownloadError;
      expect(error.kind).toBe("http");
      expect(error.message).toContain(`error ${status}`);
    } finally {
      server.close();
    }
  });
}

test("refuses to start when the disk can't hold the file plus 2 GB", async () => {
  const { url, server } = await serve();
  const destination = await tempDest();
  try {
    const error = (await downloadFile({
      url,
      destination,
      expectedSize: DATA.length,
      freeBytes: async () => 1.5e9,
    }).catch((caught: unknown) => caught)) as DownloadError;
    expect(error.kind).toBe("disk-full");
    expect(error.message).toContain("1.5 GB is free");
    expect(error.message).toContain(join(destination, ".."));
    expect(error.details?.neededBytes).toBe(DATA.length + 2e9);
  } finally {
    server.close();
  }
});

test("a disk that fills up mid-download stops with a clear error and keeps the part", async () => {
  const { url, server } = await serve();
  const destination = await tempDest();
  const { open } = await import("node:fs/promises");
  let written = 0;
  const openFile = async (filePath: string): Promise<WritableFile> => {
    const handle = await open(filePath, "a");
    return {
      write: async (chunk) => {
        if (written + chunk.length > MB) {
          throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
        }
        written += chunk.length;
        return handle.write(chunk);
      },
      close: () => handle.close(),
    };
  };
  try {
    const error = (await downloadFile({
      url,
      destination,
      expectedSize: DATA.length,
      sha256: SHA,
      freeBytes: plenty,
      openFile,
    }).catch((caught: unknown) => caught)) as DownloadError;
    expect(error.kind).toBe("disk-full");
    expect(error.message).toContain("Not enough free disk space");
    expect((await stat(partPath(destination))).size).toBe(written);
    // After freeing space, Retry continues and completes.
    await downloadFile({
      url,
      destination,
      expectedSize: DATA.length,
      sha256: SHA,
      freeBytes: plenty,
    });
    expect((await readFile(destination)).equals(DATA)).toBe(true);
  } finally {
    server.close();
  }
});

test("a dropped connection is resumable", async () => {
  let first = true;
  const { url, server } = await serve((request, response) => {
    if (first) {
      first = false;
      response.writeHead(200, { "Content-Length": DATA.length });
      response.write(DATA.subarray(0, MB), () => response.socket?.destroy());
      return;
    }
    sendRange(request, response);
  });
  const destination = await tempDest();
  try {
    const error = (await downloadFile({
      url,
      destination,
      expectedSize: DATA.length,
      sha256: SHA,
      freeBytes: plenty,
    }).catch((caught: unknown) => caught)) as DownloadError;
    expect(error).toBeInstanceOf(DownloadError);
    expect(["interrupted"]).toContain(error.kind);
    expect(error.message).toContain("continues where it stopped");
    const kept = (await stat(partPath(destination))).size;
    expect(kept).toBeGreaterThan(0);
    await downloadFile({
      url,
      destination,
      expectedSize: DATA.length,
      sha256: SHA,
      freeBytes: plenty,
    });
    expect((await readFile(destination)).equals(DATA)).toBe(true);
  } finally {
    server.close();
  }
});

test("no data for a while is reported, then the download stops as stalled", async () => {
  const { url, server } = await serve((_request, response) => {
    response.writeHead(200, { "Content-Length": DATA.length });
    response.write(DATA.subarray(0, 64 * 1024));
    // ...and then nothing.
  });
  const destination = await tempDest();
  const progress: DownloadProgress[] = [];
  try {
    const error = (await downloadFile({
      url,
      destination,
      expectedSize: DATA.length,
      freeBytes: plenty,
      stallWarnMs: 1_000,
      stallAbortMs: 2_500,
      progressIntervalMs: 0,
      onProgress: (entry) => progress.push(entry),
    }).catch((caught: unknown) => caught)) as DownloadError;
    expect(error.kind).toBe("stalled");
    expect(error.message).toContain("No data arrived");
    expect(progress.some((entry) => entry.stalledSeconds !== undefined)).toBe(true);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("an unreachable host reads as no internet connection", async () => {
  const destination = await tempDest();
  const error = (await downloadFile({
    url: "http://no-such-host.invalid/model.gguf",
    destination,
    expectedSize: DATA.length,
    freeBytes: plenty,
  }).catch((caught: unknown) => caught)) as DownloadError;
  expect(error.kind).toBe("offline");
  expect(error.message).toContain("connected to the internet");
});

test("copies from a local file, resumable too", async () => {
  const dir = await mkdtemp(join(tmpdir(), "engine-download-src-"));
  const source = join(dir, "source.gguf");
  await writeFile(source, DATA);
  const destination = await tempDest();
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(destination, ".."), { recursive: true });
  await writeFile(partPath(destination), DATA.subarray(0, MB));
  await downloadFile({ url: source, destination, sha256: SHA, freeBytes: plenty });
  expect((await readFile(destination)).equals(DATA)).toBe(true);
});
