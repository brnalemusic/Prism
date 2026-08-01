const packageJson = require('./package.json')
const [major, minor, patch] = packageJson.version.split('.')

module.exports = {
  appId: 'com.prism.demo.app',
  productName: 'Prism Demo',
  icon: 'resources/icon.png',
  directories: {
    buildResources: 'resources'
  },
  files: [
    '!**/.vscode/*',
    '!**/.antigravitycli/*',
    '!src/*',
    '!electron.vite.config.{js,ts,mjs,cjs}',
    '!{.eslintcache,eslint.config.mjs,.prettierignore,.prettierrc.yaml,dev-app-update.yml,CHANGELOG.md,README.md}',
    '!{.env,.env.*,.npmrc,pnpm-lock.yaml}',
    '!{tsconfig.json,tsconfig.node.json,tsconfig.web.json}',
    '!electron-builder*.yml',
    '!electron-builder*.js'
  ],
  asarUnpack: ['resources/**'],
  extraResources: [
    { from: 'resources/icon.ico', to: 'resources/icon.ico' },
    { from: 'resources/icon.png', to: 'resources/icon.png' },
    { from: 'resources/icons', to: 'resources/icons' },
    { from: 'resources/prism-setup.exe', to: 'resources/prism-setup.exe' },
    { from: 'resources/docs', to: 'docs' }
  ],
  win: {
    executableName: 'Prism Demo',
    icon: 'resources/icon.ico',
    target: ['portable']
  },
  portable: {
    artifactName: `Prism ${major} Installer (Version ${minor}.${patch}).\${ext}`
  },
  npmRebuild: false,
  electronDownload: {
    mirror: 'https://npmmirror.com/mirrors/electron/'
  }
}
