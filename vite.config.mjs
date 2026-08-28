import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createLocalAuditRuntime } from "./worker/local-runtime.js";

function frontmendLocalAudit() {
  return {
    name: "frontmend-local-audit",
    configureServer(server) {
      server.middlewares.use(createLocalAuditRuntime());
    },
  };
}

export default defineConfig({
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "127.0.0.1",
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [frontmendLocalAudit(), react()],
});
