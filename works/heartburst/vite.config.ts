import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  // 作品集（play）の /works/heartburst/ 配下で配信するため、アセット参照を相対にする
  base: "./",
  build: {
    outDir: "dist",
    target: "es2022",
  },
});
