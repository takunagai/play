import { defineConfig } from "vite";

// 作品集（play）の /works/prism-pop/ 配下で配信するため、アセット参照を相対にする
export default defineConfig({
  base: "./",
});
