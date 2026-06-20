import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// `DEMO_MODE=true` produces the key-less Prism Demo build variant
// (see src/shared/demo.ts). Otherwise the regular Prism build.
const IS_DEMO = process.env.DEMO_MODE === 'true'

const demoDefine = {
  __DEMO_MODE__: JSON.stringify(IS_DEMO)
}

export default defineConfig({
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
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
