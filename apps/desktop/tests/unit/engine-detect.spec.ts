import { expect, test } from "@playwright/test";
import {
  buildDetectedComputer,
  computerSpecs,
  describeComputer,
  parseListDevices,
  unsupportedReason,
} from "../../electron/engine/detect";
import { chooseModel } from "../../electron/engine/choose";

const GIB = 1024 ** 3;
const RAM_38 = 38.9 * GIB;

// Captured on the development laptop (Intel Xe + RTX 3050 Laptop 4 GB, 38 GB RAM) with the
// bundled Vulkan build b12445: `llama-server --list-devices`.
const VULKAN_THIS_PC = `Available devices:
  Vulkan0: Intel(R) Xe Graphics (TGL GT2) (29922 MiB, 27188 MiB free)
  Vulkan1: NVIDIA GeForce RTX 3050 Laptop GPU (4096 MiB, 996 MiB free)
`;

// Same laptop, a local CUDA + Vulkan build.
const CUDA_THIS_PC = `Available devices:
  CUDA0: NVIDIA GeForce RTX 3050 Laptop GPU (3772 MiB, 803 MiB free)
  Vulkan0: Intel(R) Xe Graphics (TGL GT2) (29922 MiB, 26853 MiB free)
  Vulkan1: NVIDIA GeForce RTX 3050 Laptop GPU (4096 MiB, 803 MiB free)
`;

// Hand-written samples in the same format.
const METAL_M2_PRO = `Available devices:
  MTL0: Apple M2 Pro (21845 MiB, 21845 MiB free)
`;
const AMD_DESKTOP = `load_backend: loaded Vulkan backend from libggml-vulkan.so
Available devices:
  Vulkan0: AMD Radeon RX 7900 XTX (RADV NAVI31) (24560 MiB, 24100 MiB free)
`;
const AMD_LAPTOP_IGPU_ONLY = `Available devices:
  Vulkan0: AMD Radeon(TM) Graphics (RADV REMBRANDT) (16384 MiB, 15000 MiB free)
`;
const SOFTWARE_ONLY = `Available devices:
  Vulkan0: llvmpipe (LLVM 15.0.7, 256 bits) (32000 MiB, 32000 MiB free)
`;
const WINDOWS_CRLF =
  "Available devices:\r\n  Vulkan0: NVIDIA GeForce RTX 4070 (12282 MiB, 11000 MiB free)\r\n";

test("parses this PC's Vulkan device list and picks the NVIDIA card", () => {
  const devices = parseListDevices(VULKAN_THIS_PC, RAM_38);
  expect(devices).toHaveLength(2);
  expect(devices[0]).toMatchObject({
    id: "Vulkan0",
    backend: "vulkan",
    shared: true,
    nvidia: false,
  });
  expect(devices[1]).toMatchObject({
    id: "Vulkan1",
    backend: "vulkan",
    name: "NVIDIA GeForce RTX 3050 Laptop GPU",
    totalMiB: 4096,
    freeMiB: 996,
    shared: false,
    nvidia: true,
  });
  const computer = buildDetectedComputer({
    platform: "linux",
    arch: "x64",
    ramBytes: RAM_38,
    listDevicesOutput: VULKAN_THIS_PC,
    nvidiaSmi: false,
  });
  expect(computer.gpu?.id).toBe("Vulkan1");
  expect(computer.hasNvidia).toBe(true);
  expect(computerSpecs(computer)).toEqual({ kind: "pc", vramGb: 4, ramGb: 38.9 });
  expect(describeComputer(computer)).toBe(
    "NVIDIA GeForce RTX 3050 Laptop GPU (4 GB) · 39 GB memory",
  );
  const choice = chooseModel({ computer: computerSpecs(computer) });
  expect(choice.kind === "ok" && `${choice.choice.model.id} ${choice.choice.quant}`).toBe(
    "minicpm5-2b Q5_K_S",
  );
});

test("parses a CUDA build's list (CUDA and Vulkan entries for the same card)", () => {
  const devices = parseListDevices(CUDA_THIS_PC, RAM_38);
  expect(devices.map((device) => [device.id, device.backend, device.shared])).toEqual([
    ["CUDA0", "cuda", false],
    ["Vulkan0", "vulkan", true],
    ["Vulkan1", "vulkan", false],
  ]);
  const computer = buildDetectedComputer({
    platform: "linux",
    arch: "x64",
    ramBytes: RAM_38,
    listDevicesOutput: CUDA_THIS_PC,
    nvidiaSmi: true,
  });
  expect(computer.gpu?.totalMiB).toBe(4096);
});

test("an Apple chip is sized from its unified memory", () => {
  const computer = buildDetectedComputer({
    platform: "darwin",
    arch: "arm64",
    ramBytes: 32 * GIB,
    listDevicesOutput: METAL_M2_PRO,
    nvidiaSmi: false,
  });
  expect(computer.devices[0]).toMatchObject({ backend: "metal", name: "Apple M2 Pro" });
  expect(computer.gpu).toBeUndefined();
  expect(computerSpecs(computer)).toEqual({ kind: "mac", vramGb: 0, ramGb: 32 });
  expect(describeComputer(computer)).toBe("Apple M2 Pro · 32 GB memory");
});

test("a big AMD card counts as a graphics card even with less system memory", () => {
  const computer = buildDetectedComputer({
    platform: "win32",
    arch: "x64",
    ramBytes: 32 * GIB,
    listDevicesOutput: AMD_DESKTOP,
    nvidiaSmi: false,
  });
  expect(computer.gpu?.name).toBe("AMD Radeon RX 7900 XTX (RADV NAVI31)");
  expect(computer.hasNvidia).toBe(false);
});

test("integrated and software GPUs are not graphics cards", () => {
  for (const output of [AMD_LAPTOP_IGPU_ONLY, SOFTWARE_ONLY]) {
    const computer = buildDetectedComputer({
      platform: "linux",
      arch: "x64",
      ramBytes: 32 * GIB,
      listDevicesOutput: output,
      nvidiaSmi: false,
    });
    expect(computer.gpu).toBeUndefined();
    expect(computerSpecs(computer).vramGb).toBe(0);
    expect(describeComputer(computer)).toBe("No graphics card found · 32 GB memory");
  }
});

test("Windows line endings parse too", () => {
  expect(parseListDevices(WINDOWS_CRLF, 32 * GIB)[0]).toMatchObject({
    name: "NVIDIA GeForce RTX 4070",
    totalMiB: 12282,
    shared: false,
  });
});

test("an empty device list means no graphics card", () => {
  expect(parseListDevices("Available devices:\n", 16 * GIB)).toEqual([]);
});

test("Intel Macs and non-x64 PCs are not supported", () => {
  expect(unsupportedReason("darwin", "x64")).toContain("Apple chip");
  expect(unsupportedReason("darwin", "arm64")).toBeUndefined();
  expect(unsupportedReason("win32", "arm64")).toContain("isn't supported");
  expect(unsupportedReason("linux", "x64")).toBeUndefined();
});
