import { createHash, type Hash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat, statfs, truncate } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatBytes } from "./catalog";

/**
 * Resumable download into `<destination>.part`, renamed to `destination` once complete and
 * verified. Every way it can fail ends in a DownloadError whose message can be shown as is.
 */
export type DownloadErrorKind =
  "offline" | "http" | "disk-full" | "checksum" | "stalled" | "interrupted" | "cancelled" | "io";

export class DownloadError extends Error {
  constructor(
    readonly kind: DownloadErrorKind,
    message: string,
    readonly details?: { readonly neededBytes?: number; readonly freeBytes?: number },
  ) {
    super(message);
    this.name = "DownloadError";
  }
}

export interface DownloadProgress {
  readonly phase: "checking-existing" | "downloading" | "verifying";
  readonly receivedBytes: number;
  readonly totalBytes: number;
  readonly bytesPerSecond: number;
  readonly etaSeconds?: number;
  /** Seconds since the last data arrived, once that passes the stall warning time. */
  readonly stalledSeconds?: number;
  /** Bytes that were already on disk from an earlier attempt. */
  readonly resumedFromBytes: number;
}

export interface WritableFile {
  write(chunk: Uint8Array): Promise<unknown>;
  close(): Promise<void>;
}

type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal; redirect?: "follow" },
) => Promise<Response>;

export interface DownloadOptions {
  /** http(s) URL, file:// URL or a local path. */
  readonly url: string;
  readonly destination: string;
  readonly expectedSize?: number;
  readonly sha256?: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: DownloadProgress) => void;
  /** Space to keep free after the download (default 2 GB). */
  readonly headroomBytes?: number;
  /** After this long without data, progress reports `stalledSeconds` (default 60 s). */
  readonly stallWarnMs?: number;
  /** After this long without data, the download stops with a "stalled" error (default 3 min). */
  readonly stallAbortMs?: number;
  readonly progressIntervalMs?: number;
  readonly fetch?: FetchLike;
  readonly freeBytes?: (dir: string) => Promise<number>;
  readonly openFile?: (filePath: string) => Promise<WritableFile>;
  /** Name shown in error messages instead of the URL's host ("the download server"). */
  readonly sourceLabel?: string;
}

export interface DownloadResult {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

export const DEFAULT_HEADROOM_BYTES = 2e9;

export async function freeDiskBytes(dir: string): Promise<number> {
  const stats = await statfs(dir);
  return Number(stats.bavail) * Number(stats.bsize);
}

export function partPath(destination: string): string {
  return `${destination}.part`;
}

export async function partialBytes(destination: string): Promise<number> {
  try {
    return (await stat(partPath(destination))).size;
  } catch {
    return 0;
  }
}

async function defaultOpenFile(filePath: string): Promise<WritableFile> {
  const handle = await open(filePath, "a");
  return {
    write: (chunk) => handle.write(chunk),
    close: () => handle.close(),
  };
}

function isNoSpace(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOSPC" || code === "EDQUOT";
}

function diskFullError(dir: string, neededBytes?: number, freeBytes?: number): DownloadError {
  const amounts =
    neededBytes !== undefined && freeBytes !== undefined
      ? ` It needs ${formatBytes(neededBytes)} free (including 2 GB to spare) but only ${formatBytes(freeBytes)} is free`
      : " The disk filled up during the download";
  return new DownloadError(
    "disk-full",
    `Not enough free disk space.${amounts} on the drive with ${dir}. Free up some space, then press Retry; the download continues where it stopped.`,
    {
      ...(neededBytes !== undefined ? { neededBytes } : {}),
      ...(freeBytes !== undefined ? { freeBytes } : {}),
    },
  );
}

function networkError(error: unknown, source: string): DownloadError {
  const cause = (error as { cause?: { code?: string; message?: string } } | undefined)?.cause;
  const code = cause?.code ?? (error as NodeJS.ErrnoException | undefined)?.code ?? "";
  if (/ENOTFOUND|EAI_AGAIN/.test(code)) {
    return new DownloadError(
      "offline",
      `Couldn't reach ${source}. Check that this computer is connected to the internet, then press Retry.`,
    );
  }
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE|UND_ERR|ENETUNREACH|EHOSTUNREACH/.test(code)) {
    return new DownloadError(
      "interrupted",
      `The connection to ${source} was lost (${code}). Press Retry; the download continues where it stopped.`,
    );
  }
  const detail = cause?.message ?? (error instanceof Error ? error.message : String(error));
  return new DownloadError(
    "interrupted",
    `The download from ${source} failed: ${detail}. Press Retry; it continues where it stopped.`,
  );
}

function httpError(status: number, source: string): DownloadError {
  if (status === 404) {
    return new DownloadError(
      "http",
      `The file was not found on ${source} (error 404). It may have been moved; please contact support.`,
    );
  }
  if (status === 401 || status === 403) {
    return new DownloadError(
      "http",
      `${source} refused the download (error ${status}). Try again later; if it keeps happening, please contact support.`,
    );
  }
  if (status === 429) {
    return new DownloadError(
      "http",
      `${source} is limiting downloads right now (error 429). Wait a few minutes, then press Retry.`,
    );
  }
  return new DownloadError(
    "http",
    `${source} had a problem (error ${status}). Wait a few minutes, then press Retry.`,
  );
}

function sourceName(url: string, label?: string): string {
  if (label) return label;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.host;
    }
  } catch {
    // a local path
  }
  return "the download source";
}

function localSourcePath(url: string): string | undefined {
  if (url.startsWith("file://")) return fileURLToPath(url);
  if (/^https?:\/\//i.test(url)) return undefined;
  return url;
}

async function hashExisting(
  filePath: string,
  hash: Hash,
  bytes: number,
  report: (done: number) => void,
): Promise<void> {
  if (bytes === 0) return;
  let done = 0;
  for await (const chunk of createReadStream(filePath, { start: 0, end: bytes - 1 })) {
    const buffer = chunk as Buffer;
    hash.update(buffer);
    done += buffer.length;
    report(done);
  }
}

/** Download speed over the last few seconds. */
class SpeedMeter {
  private readonly samples: Array<{ readonly at: number; readonly bytes: number }> = [];
  constructor(private readonly windowMs = 5_000) {}
  add(at: number, bytes: number): void {
    this.samples.push({ at, bytes });
    while (this.samples.length > 2 && at - (this.samples[0]?.at ?? at) > this.windowMs) {
      this.samples.shift();
    }
  }
  bytesPerSecond(): number {
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (!first || !last || last.at - first.at < 250) return 0;
    return ((last.bytes - first.bytes) * 1000) / (last.at - first.at);
  }
}

export async function downloadFile(options: DownloadOptions): Promise<DownloadResult> {
  const destination = options.destination;
  const dir = path.dirname(destination);
  const part = partPath(destination);
  const source = sourceName(options.url, options.sourceLabel);
  const headroom = options.headroomBytes ?? DEFAULT_HEADROOM_BYTES;
  const stallWarnMs = options.stallWarnMs ?? 60_000;
  const stallAbortMs = options.stallAbortMs ?? 180_000;
  const progressIntervalMs = options.progressIntervalMs ?? 250;
  const getFree = options.freeBytes ?? freeDiskBytes;
  const openFile = options.openFile ?? defaultOpenFile;
  const fetchImpl: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));

  try {
    await mkdir(dir, { recursive: true });
  } catch (error) {
    throw new DownloadError("io", `Couldn't create the folder ${dir}: ${String(error)}`);
  }

  let existing = await partialBytes(destination);
  if (options.expectedSize !== undefined && existing > options.expectedSize) {
    await rm(part, { force: true });
    existing = 0;
  }

  const checkDisk = async (remaining: number) => {
    let free: number;
    try {
      free = await getFree(dir);
    } catch {
      return; // unknown: let the write itself report ENOSPC
    }
    if (free < remaining + headroom) {
      throw diskFullError(dir, remaining + headroom, free);
    }
  };
  if (options.expectedSize !== undefined) {
    await checkDisk(options.expectedSize - existing);
  }

  let hash = createHash("sha256");
  let resumedFromBytes = existing;
  const total = () => options.expectedSize ?? knownTotal ?? 0;
  let knownTotal: number | undefined = options.expectedSize;
  let lastReport = 0;
  const report = (progress: DownloadProgress, force = false) => {
    const now = Date.now();
    if (!force && now - lastReport < progressIntervalMs) return;
    lastReport = now;
    options.onProgress?.(progress);
  };

  await hashExisting(part, hash, existing, (done) =>
    report({
      phase: "checking-existing",
      receivedBytes: done,
      totalBytes: total(),
      bytesPerSecond: 0,
      resumedFromBytes,
    }),
  );

  const abort = new AbortController();
  const onOuterAbort = () => abort.abort();
  options.signal?.addEventListener("abort", onOuterAbort);
  if (options.signal?.aborted) abort.abort();

  let received = existing;
  let lastDataAt = Date.now();
  let stalledOut = false;
  const meter = new SpeedMeter();
  meter.add(Date.now(), received);
  const progressNow = (): DownloadProgress => {
    const speed = meter.bytesPerSecond();
    const totalBytes = total();
    const idleMs = Date.now() - lastDataAt;
    return {
      phase: "downloading",
      receivedBytes: received,
      totalBytes,
      bytesPerSecond: idleMs > 5_000 ? 0 : speed,
      ...(speed > 0 && totalBytes > 0 && idleMs <= 5_000
        ? { etaSeconds: Math.max(0, (totalBytes - received) / speed) }
        : {}),
      ...(idleMs >= stallWarnMs ? { stalledSeconds: Math.floor(idleMs / 1000) } : {}),
      resumedFromBytes,
    };
  };
  const watchdog = setInterval(() => {
    meter.add(Date.now(), received);
    report(progressNow(), true);
    if (Date.now() - lastDataAt >= stallAbortMs) {
      stalledOut = true;
      abort.abort();
    }
  }, 1_000);

  let file: WritableFile | undefined;
  try {
    const needsData = options.expectedSize === undefined || existing < options.expectedSize;
    if (needsData) {
      let body: AsyncIterable<Uint8Array>;
      const localPath = localSourcePath(options.url);
      if (localPath) {
        let size: number;
        try {
          size = (await stat(localPath)).size;
        } catch {
          throw new DownloadError("http", `The file ${localPath} does not exist.`);
        }
        knownTotal = options.expectedSize ?? size;
        body = createReadStream(localPath, { start: existing, signal: abort.signal });
      } else {
        let response: Response;
        try {
          response = await fetchImpl(options.url, {
            headers: existing > 0 ? { Range: `bytes=${existing}-` } : {},
            signal: abort.signal,
            redirect: "follow",
          });
        } catch (error) {
          throw networkError(error, source);
        }
        if (response.status === 416 && existing > 0) {
          // The server has no bytes past what is on disk: start over once.
          await rm(part, { force: true });
          throw new DownloadError(
            "interrupted",
            `The partly downloaded file didn't match ${source}'s copy, so it was removed. Press Retry to download it again.`,
          );
        }
        if (!response.ok) {
          throw httpError(response.status, source);
        }
        if (existing > 0 && response.status !== 206) {
          // The server ignored the Range request and sends the whole file: start from zero.
          await truncate(part, 0);
          existing = 0;
          received = 0;
          resumedFromBytes = 0;
          hash = createHash("sha256");
        }
        const length = Number(response.headers.get("content-length") ?? NaN);
        if (knownTotal === undefined && Number.isFinite(length)) {
          knownTotal = existing + length;
          await checkDisk(length);
        }
        if (!response.body) {
          throw new DownloadError("interrupted", `${source} sent an empty answer. Press Retry.`);
        }
        body = response.body as unknown as AsyncIterable<Uint8Array>;
      }

      try {
        file = await openFile(part);
      } catch (error) {
        if (isNoSpace(error)) throw diskFullError(dir);
        throw new DownloadError("io", `Couldn't write to ${part}: ${String(error)}`);
      }
      try {
        for await (const chunk of body) {
          try {
            await file.write(chunk);
          } catch (error) {
            if (isNoSpace(error)) {
              let free: number | undefined;
              try {
                free = await getFree(dir);
              } catch {
                free = undefined;
              }
              throw diskFullError(
                dir,
                free !== undefined ? total() - received + headroom : undefined,
                free,
              );
            }
            throw new DownloadError("io", `Couldn't write to ${part}: ${String(error)}`);
          }
          hash.update(chunk);
          received += chunk.length;
          lastDataAt = Date.now();
          meter.add(lastDataAt, received);
          report(progressNow());
        }
      } catch (error) {
        if (error instanceof DownloadError) throw error;
        if (stalledOut) {
          throw new DownloadError(
            "stalled",
            `No data arrived from ${source} for ${Math.round(stallAbortMs / 60_000)} minutes, so the download was paused. Check your internet connection, then press Retry; it continues where it stopped.`,
          );
        }
        if (options.signal?.aborted) {
          throw new DownloadError("cancelled", "The download was cancelled.");
        }
        throw networkError(error, source);
      }
    }
  } finally {
    clearInterval(watchdog);
    options.signal?.removeEventListener("abort", onOuterAbort);
    await file?.close().catch(() => undefined);
  }

  const expected = options.expectedSize ?? knownTotal;
  if (expected !== undefined && received < expected) {
    throw new DownloadError(
      "interrupted",
      `The download stopped early (${formatBytes(received)} of ${formatBytes(expected)}). Press Retry; it continues where it stopped.`,
    );
  }
  report(
    {
      phase: "verifying",
      receivedBytes: received,
      totalBytes: expected ?? received,
      bytesPerSecond: 0,
      resumedFromBytes,
    },
    true,
  );
  const digest = hash.digest("hex");
  if (options.sha256 && digest.toLowerCase() !== options.sha256.toLowerCase()) {
    await rm(part, { force: true });
    throw new DownloadError(
      "checksum",
      "The downloaded file is damaged (its checksum doesn't match), so it was deleted. Press Retry to download it again.",
    );
  }
  try {
    await rename(part, destination);
  } catch (error) {
    throw new DownloadError("io", `Couldn't save ${destination}: ${String(error)}`);
  }
  return { path: destination, sha256: digest, bytes: received };
}
