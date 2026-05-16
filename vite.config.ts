import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };

// Subpath deploy: served from https://<host>/webstructor/ — the base is
// baked into every asset URL by Vite at build time, so it must match the
// actual location the static files are mounted at on the server. Change
// here (and rebuild) if you move the deploy target.
export default defineConfig({
  base: "/webstructor/",
  define: {
    // package.json version baked into the bundle as a global. Used by the
    // version display in the UI. Declared in src/types/globals.d.ts.
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
