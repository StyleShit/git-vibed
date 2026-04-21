import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import electron from "vite-plugin-electron/simple";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    electron({
      main: {
        entry: "src-electron/main.ts",
        vite: {
          build: {
            outDir: "dist-electron",
            rollupOptions: {
              external: ["electron", "chokidar", "simple-git", "fsevents"],
            },
          },
          resolve: {
            alias: {
              "@shared": path.resolve(__dirname, "src/shared"),
            },
          },
        },
      },
      preload: {
        input: "src-electron/preload.ts",
        vite: {
          build: {
            outDir: "dist-electron",
            rollupOptions: {
              external: ["electron"],
              output: {
                // Emit CJS with a .cjs extension so Node/Electron load it as
                // CommonJS even though the root package is "type": "module".
                // ESM preload support in Electron is new and sharp-edged; CJS
                // is the path of least surprise for contextBridge.
                format: "cjs",
                entryFileNames: "[name].cjs",
              },
            },
          },
          resolve: {
            alias: {
              "@shared": path.resolve(__dirname, "src/shared"),
            },
          },
        },
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@shared": path.resolve(__dirname, "src/shared"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
