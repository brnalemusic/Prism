// Global atmospheric background. One radial base gradient, three slow
// theme-colored auras for depth, and a barely-visible grain veil so large
// dark areas do not feel digitally flat. Everything is fixed, non-scrolling
// and pointer-transparent; auras animate only opacity/transform (GPU-safe).
// PERFORMANCE: orbs are GPU-promoted and isolated so the fullscreen blur
// behind glass surfaces does not repaint the whole frame on every pulse.
export function PrismBackground(): React.JSX.Element {
  return (
    <div
      className="prism-background-field fixed inset-0 pointer-events-none overflow-hidden z-0 select-none transition-colors duration-700"
      style={{
        background:
          'radial-gradient(ellipse at 50% -10%, var(--theme-aura-3) 0%, var(--theme-base-bg) 50%, #000000 100%)'
      }}
    >
      {/* Primary dynamic theme aura orb (Top-right/center) */}
      <div
        className="gpu-layer absolute -top-[15%] right-[10%] w-[55vw] h-[55vh] rounded-full blur-[130px] opacity-25 mix-blend-screen transition-colors duration-700 pointer-events-none animate-[pulse_12s_ease-in-out_infinite]"
        style={{
          background: 'radial-gradient(circle, var(--theme-aura-1) 0%, transparent 70%)'
        }}
      />

      {/* Secondary glowing ember/aurora orb (Bottom-left under InputBar & Chat) */}
      <div
        className="gpu-layer absolute -bottom-[20%] left-[15%] w-[60vw] h-[60vh] rounded-full blur-[150px] opacity-22 mix-blend-screen transition-colors duration-700 pointer-events-none animate-[pulse_16s_ease-in-out_infinite]"
        style={{
          background: 'radial-gradient(circle, var(--theme-aura-2) 0%, transparent 65%)'
        }}
      />

      {/* Tertiary atmospheric depth node (Behind Sidebar) */}
      <div
        className="gpu-layer absolute top-[20%] -left-[10%] w-[35vw] h-[50vh] rounded-full blur-[110px] opacity-18 mix-blend-screen transition-colors duration-700 pointer-events-none"
        style={{
          background: 'radial-gradient(circle, var(--theme-aura-1) 0%, transparent 60%)'
        }}
      />

      {/* Soft vignette to anchor content toward the center */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.42)_100%)] pointer-events-none" />

      {/* Fine grain veil — breaks digital flatness at ~2.5% opacity. Rendered
          once as a fixed layer; never attached to scrolling containers. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none opacity-[0.028] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          backgroundSize: '160px 160px'
        }}
      />
    </div>
  )
}
