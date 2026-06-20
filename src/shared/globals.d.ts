// Global compile-time constants injected via the vite `define` option
// (see electron.vite.config.ts). Declared here (in src/shared) so that both
// the main/preload (tsconfig.node) and renderer (tsconfig.web) typechecks see
// them, regardless of which env.d.ts files each tsconfig includes.

// `true` only when built with DEMO_MODE=true (the Prism Demo variant).
declare const __DEMO_MODE__: boolean
