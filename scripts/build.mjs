import { resolve } from "node:path";
import { build as viteBuild } from "vite";
import { build as esbuild } from "esbuild";
import react from "@vitejs/plugin-react";

const root = process.cwd();

await viteBuild({
  configFile: resolve(root, "vite.config.ts")
});

await Promise.all([
  esbuild({
    entryPoints: [resolve(root, "src/background/background.ts")],
    outfile: resolve(root, "dist/assets/background.js"),
    bundle: true,
    minify: true,
    format: "esm",
    platform: "browser",
    target: "chrome114"
  })
]);

await viteBuild({
  configFile: false,
  root,
  plugins: [react()],
  build: {
    outDir: "web-dist",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(root, "web.html")
    }
  }
});
