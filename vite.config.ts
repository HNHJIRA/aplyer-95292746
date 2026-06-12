// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    // Prerender is disabled: the Lovable build targets a Cloudflare worker that
    // renders routes at runtime, and the nitro `cloudflare-module` preset emits
    // `dist/server/index.mjs`, which mismatches the preview-server plugin's
    // expected `server.js` filename and breaks `vite build`. For static cPanel
    // hosting, `bun run build:static` generates the SPA index.html separately.
  },
});
