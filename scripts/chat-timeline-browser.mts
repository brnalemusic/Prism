/** Local renderer fixture. No Electron backend, provider requests, or user history is used. */
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

const server = await createServer({
  configFile: false,
  root: resolve('src/renderer'),
  define: { __DEMO_MODE__: 'false' },
  resolve: { alias: { '@renderer': resolve('src/renderer/src') } },
  server: { host: '127.0.0.1', port: 5187, strictPort: true },
  plugins: [
    {
      name: 'timeline-fixture',
      enforce: 'pre',
      transform(source, id) {
        if (id.endsWith('/src/App.tsx')) return `${source}\nexport { AiMessageRow };`
        if (id.endsWith('/components/QuickLauncher.tsx'))
          return `${source}\nexport { LauncherAiMessage };`
      },
      configureServer(instance) {
        instance.middlewares.use(async (req, res, next) => {
          if (req.url !== '/') return next()
          res.setHeader('Content-Type', 'text/html')
          res.end(
            await instance.transformIndexHtml(
              '/',
              '<html><head><title>Prism timeline validation</title></head><body><div id="root"></div><script type="module" src="/@fs/' +
                resolve('scripts/fixtures/chat-timeline.tsx').replaceAll('\\', '/') +
                '"></script></body></html>'
            )
          )
        })
      }
    },
    react(),
    tailwindcss()
  ]
})
await server.listen()
console.log('Timeline renderer fixture: http://127.0.0.1:5187')
