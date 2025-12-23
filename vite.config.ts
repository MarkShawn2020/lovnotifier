import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { LovinspPlugin } from "lovinsp";
import path from "path";

export default defineConfig({
  plugins: [LovinspPlugin({ bundler: "vite" }), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 51420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        float: "float.html",
      },
    },
  },
});
