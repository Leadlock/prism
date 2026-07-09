import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: ["prism.askthechamp.com"],
    proxy: {
      "/test": {
        target: "http://api:8080",
        rewrite: (path) => path.replace(/^\/test/, ""),
        changeOrigin: true,
      },
      "/api": {
        target: "http://api:4000",
        changeOrigin: true,
      },
    },
  },
});
