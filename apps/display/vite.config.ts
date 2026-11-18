import { defineConfig } from "vite";

export default defineConfig({
  base: "/display/",
  build: { outDir: "dist", emptyOutDir: true, target: "es2020" },
});
