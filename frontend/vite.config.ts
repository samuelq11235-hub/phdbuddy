import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        // Heavy, view-specific libs in their own chunks. Keeps the
        // initial bundle small (loaded on every page) and lazy-loads
        // the editor / viewer libs only when you visit those views.
        manualChunks: {
          // Multimedia + image annotation
          konva: ["konva", "react-konva", "use-image"],
          wavesurfer: ["wavesurfer.js"],
          pdfjs: ["pdfjs-dist"],
          // Rich-text editing
          tiptap: ["@tiptap/react", "@tiptap/starter-kit", "@tiptap/extension-link"],
          // React Flow + dagre for the network editor
          flow: ["reactflow", "dagre"],
        },
      },
    },
    // pdf.js worker is large but always loads in its own file already.
    chunkSizeWarningLimit: 800,
  },
});
