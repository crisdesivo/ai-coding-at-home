import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  CudaSkipped,
  ENGINE_PIN,
  cudaDiskBytesNeeded,
  cudaPlan,
  installCudaEngine,
  versionAtLeast,
} from "../../electron/engine/cuda";

test("the pinned release has the CUDA builds the app downloads", () => {
  expect(ENGINE_PIN.tag).toMatch(/^b\d+$/);
  const windows = cudaPlan(ENGINE_PIN, "win32", "x64");
  expect(windows?.engine.name).toMatch(/win-cuda-12\.4-x64\.zip$/);
  expect(windows?.runtime?.name).toMatch(/^cudart-.*win-cuda-12\.4-x64\.zip$/);
  expect(windows?.runtimeAlways).toBe(true);
  const linux = cudaPlan(ENGINE_PIN, "linux", "x64");
  expect(linux?.engine.name).toMatch(/ubuntu-cuda-12\.8-x64\.tar\.gz$/);
  expect(linux?.runtimeAlways).toBe(false);
  for (const plan of [windows, linux]) {
    expect(plan?.engine.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(plan?.engine.size).toBeGreaterThan(1e8);
  }
  expect(cudaPlan(ENGINE_PIN, "darwin", "arm64")).toBeUndefined();
  expect(cudaPlan(ENGINE_PIN, "linux", "arm64")).toBeUndefined();
});

test("keeps 2 GB free beyond the download and its unpacked files", () => {
  const asset = { name: "x", url: "x", sha256: "x", size: 200e6 };
  expect(cudaDiskBytesNeeded(asset)).toBe(700e6 + 2e9);
});

test("compares glibc versions", () => {
  expect(versionAtLeast("2.35", "2.38")).toBe(false);
  expect(versionAtLeast("2.38", "2.38")).toBe(true);
  expect(versionAtLeast("2.39", "2.38")).toBe(true);
  expect(versionAtLeast("3.0", "2.38")).toBe(true);
});

test("skips the Linux CUDA build on a glibc that is too old, before downloading anything", async () => {
  const engineDir = await mkdtemp(join(tmpdir(), "engine-cuda-"));
  const error = await installCudaEngine({
    engineDir,
    platform: "linux",
    arch: "x64",
    glibcVersion: "2.35",
  }).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(CudaSkipped);
  expect((error as Error).message).toContain("newer version of Linux");
  expect((error as Error).message).toContain("2.35");
});
