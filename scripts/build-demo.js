/* eslint-disable */
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

function run() {
  try {
    const extraArgs = process.argv.slice(2).join(' ')
    execSync(`npm run build:win ${extraArgs}`.trim(), { stdio: 'inherit' })

    // 2. Locate the built installer
    console.log('\n--- Step 2: Locating built installer ---')
    const packageJsonPath = path.join(__dirname, '..', 'package.json')
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
    const version = packageJson.version
    const setupFilename = `prism-invisible-setup-${version}.exe`
    const distDir = path.join(__dirname, '..', 'dist')
    const builtSetupPath = path.join(distDir, setupFilename)

    console.log(`Expecting setup at: ${builtSetupPath}`)
    if (!fs.existsSync(builtSetupPath)) {
      throw new Error(`Built installer not found at ${builtSetupPath}`)
    }

    // 3. Ensure resources directory exists and copy the installer
    console.log('\n--- Step 3: Copying built installer to resources/prism-setup.exe ---')
    const resourcesDir = path.join(__dirname, '..', 'resources')
    if (!fs.existsSync(resourcesDir)) {
      fs.mkdirSync(resourcesDir)
    }
    const targetSetupPath = path.join(resourcesDir, 'prism-setup.exe')
    fs.copyFileSync(builtSetupPath, targetSetupPath)
    console.log(`Successfully copied to ${targetSetupPath}`)

    // 4. Build the Prism Demo portable variant
    console.log('\n--- Step 4: Building Prism Demo portable variant ---')
    // We run the build with process.env.DEMO_MODE set to true
    execSync(
      'npx cross-env DEMO_MODE=true npm run build && npx electron-builder --win --config electron-builder.demo.js',
      {
        stdio: 'inherit',
        env: { ...process.env, DEMO_MODE: 'true' }
      }
    )
    console.log('\nPrism Demo build complete!')
  } catch (err) {
    console.error('Demo build pipeline failed:', err)
    process.exit(1)
  }
}

run()
