// electron.vite.config.ts
import { resolve } from "path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
var IS_DEMO = process.env.DEMO_MODE === "true";
var demoDefine = {
  __DEMO_MODE__: JSON.stringify(IS_DEMO)
};
var electron_vite_config_default = defineConfig({
  main: {
    define: demoDefine
  },
  preload: {
    define: demoDefine
  },
  renderer: {
    define: demoDefine,
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src")
      }
    },
    plugins: [react(), tailwindcss()]
  }
});
export {
  electron_vite_config_default as default
};
