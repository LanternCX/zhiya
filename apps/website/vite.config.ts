import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig(({ mode }) => ({
  base: mode === "pages" ? "/zhiya/" : "/",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("../client/src", import.meta.url)) } },
  define: { __ZHIYA_CLIENT_CONFIG__: JSON.stringify({ apiOrigin: "https://website-demo.invalid", requestTimeoutMilliseconds: 10000 }) },
  build: { rolldownOptions: { input: {
    website: fileURLToPath(new URL("./index.html", import.meta.url)),
    demo: fileURLToPath(new URL("./product-demo/index.html", import.meta.url)),
  } } },
  server: {
    host: "127.0.0.1",
    port: 4174,
    strictPort: true,
  },
}));
