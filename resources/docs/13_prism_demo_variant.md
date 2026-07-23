# Prism Demo Variant Architecture Guide

## 1. Overview: Demo Mode Isolation

Prism includes a specialized **Demo Variant** target designed for public demonstrations, sandbox testing, or showcase environments.

The Demo mode isolates application state, utilizes mock/sandbox provider configurations, and restricts destructive host terminal commands.

---

## 2. Building and Launching Demo Mode

### 2.1. Development Execution
Launch the demo development workspace:
```bash
npm run dev:demo
```
This runs `cross-env DEMO_MODE=true electron-vite dev`, passing the `DEMO_MODE` environment flag to Electron main and renderer processes.

### 2.2. Production Demo Build
Compile the demo installer package using the dedicated demo builder script:
```bash
npm run build:demo
```
This executes `node scripts/build-demo.js`, bundling the application using `electron-builder.demo.js`.

---

## 3. Demo Mode Restrictions and Behavior

When `DEMO_MODE` is active:
1. **Isolated Configuration:** Settings and history are written to an isolated demo configuration directory.
2. **Mock AI Provider:** Uses mock responses or isolated demo API keys to prevent quota consumption.
3. **Restricted Command Sandbox:** Terminal commands and file mutation tools operate in strict read-only or mocked virtual paths, preventing host filesystem changes during live presentations.
