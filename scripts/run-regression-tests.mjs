import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";

const entryPoint = path.resolve("tests/regression.test.ts");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "damage-calc-tests-"));
const outfile = path.join(tempDir, "regression.test.mjs");

try {
  await build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    sourcemap: "inline",
    logLevel: "silent",
  });

  const result = spawnSync(process.execPath, ["--test", outfile], {
    stdio: "inherit",
  });

  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
