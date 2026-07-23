# GitHub and Contributing Guide

## 1. Project Overview

Prism is an open-source Electron + React desktop AI assistant built with TypeScript, Vite, Tailwind CSS v4, and a Multi-Provider AI Architecture. Contributions are welcome across UI improvements, tool additions, provider integrations, and performance optimizations.

---

## 2. Contribution Guidelines and Rules

Contributors MUST follow these guidelines strictly:

1. **Language Policy (`AGENTS.md` Rule 2 & 3):**
   - The Prism visual interface, UI/UX text, documentation, and code comments **MUST be in English**.
2. **Source Control Rules:**
   - Never commit raw build output folders (`dist/`, `out/`, `node_modules/`).
   - Create feature branches for major or minor updates.
3. **Quality Verification:**
   - Always run `npm run typecheck` to verify Node and Web TypeScript targets before opening pull requests.

---

## 3. Local Development Setup

```bash
# Clone the repository
git clone https://github.com/brnalemusic/Prism.git
cd Prism

# Install dependencies
npm install

# Start local development workspace with Vite HMR
npm run dev

# Run TypeScript typechecks
npm run typecheck

# Build Windows installer package
npm run build:win
```

---

## 4. Key Source Code Directory Layout

- `src/main/`: Electron main process.
  - `src/main/ai/`: Multi-provider dispatchers (`openaiClient.ts`), provider manager (`providerManager.ts`), trusted registry (`trustedRegistry.ts`).
  - `src/main/config.ts`: Configuration persistence and `safeStorage` key encryption.
  - `src/main/localCommandSandbox.ts`: Guarded terminal sandbox and path validation.
  - `src/main/systemTools.ts`: Native OS tools, Playwright browser, file operations.
  - `src/main/toolsManifest.ts`: Tool schemas exposed to LLM endpoints.
- `src/preload/`: Electron preload bridge (`contextBridge`).
- `src/renderer/`: React 19 UI views, components, and Tailwind v4 themes.
- `src/shared/`: Shared TypeScript types (`types.ts`).
- `resources/docs/`: Internal AI knowledge base documentation files.
