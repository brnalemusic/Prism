const { app, BrowserWindow } = require('electron')
app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1000,
    height: 760,
    show: true,
    webPreferences: { contextIsolation: true, backgroundThrottling: false }
  })
  window.loadURL(process.env.PRISM_GLASS_TEST_URL)
})
