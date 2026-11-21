import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  external: [
    "bun:sqlite",
    "node:sqlite",
    "@opencode/plugin",
    "@opencode-ai/plugin",
  ],
});
