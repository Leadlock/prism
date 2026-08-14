import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    watch: process.env.PLAYWRIGHT ? false : { usePolling: true, interval: 500 },
    allowedHosts: process.env.PLAYWRIGHT ? undefined : ["prism.askthechamp.com"],
    proxy: process.env.PLAYWRIGHT ? {} : {
      "/api": {
        target: "http://api:4000",
        changeOrigin: true,
      },
    },
  },
});
