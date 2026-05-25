# Prism

Prism is an Electron application built with React and TypeScript. It integrates with the Gemini API to provide advanced AI capabilities.

## Architecture

- **Main Process**: Handles Electron life cycle, configuration, and Gemini API integration (`src/main`).
- **Preload**: Bridges the main and renderer processes (`src/preload`).
- **Renderer Process**: The React-based UI (`src/renderer`).
- **Shared**: Common types and utilities (`src/shared`).

## Key Technologies

- **Frontend**: React, TypeScript, Tailwind CSS, Lucide React.
- **Backend**: Electron, Node.js.
- **AI**: Google Generative AI (Gemini).
- **Build Tools**: Vite, electron-vite, electron-builder.

## Coding Standards

- Use TypeScript for all new code.
- Follow the established component structure in `src/renderer/src/components`.
- Use Vanilla CSS for custom styling where Tailwind is not sufficient.
- Ensure all main process logic is properly exposed via the preload script.
