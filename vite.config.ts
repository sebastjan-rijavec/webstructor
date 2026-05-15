import { defineConfig } from "vite";

// Subpath deploy: served from https://<host>/webstructor/ — the base is
// baked into every asset URL by Vite at build time, so it must match the
// actual location the static files are mounted at on the server. Change
// here (and rebuild) if you move the deploy target.
export default defineConfig({
  base: "/webstructor/",
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
