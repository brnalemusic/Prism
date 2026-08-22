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
        className="absolute -top-[15%] right-[10%] w-[55vw] h-[55vh] rounded-full blur-[110px] opacity-40 mix-blend-screen transition-all duration-700 pointer-events-none animate-[pulse_10s_ease-in-out_infinite]"
        style={{
          background: 'radial-gradient(circle, var(--theme-aura-1) 0%, transparent 70%)'
        }}
      />

      {/* Secondary glowing ember/aurora orb (Bottom-left under InputBar & Chat) */}
      <div
        className="absolute -bottom-[20%] left-[15%] w-[60vw] h-[60vh] rounded-full blur-[130px] opacity-35 mix-blend-screen transition-all duration-700 pointer-events-none animate-[pulse_14s_ease-in-out_infinite]"
        style={{
          background: 'radial-gradient(circle, var(--theme-aura-2) 0%, transparent 65%)'
        }}
      />

      {/* Tertiary atmospheric depth node (Behind Sidebar) */}
      <div
        className="absolute top-[20%] -left-[10%] w-[35vw] h-[50vh] rounded-full blur-[90px] opacity-30 mix-blend-screen transition-all duration-700 pointer-events-none"
        style={{
          background: 'radial-gradient(circle, var(--theme-aura-1) 0%, transparent 60%)'
        }}
      />

      {/* Subtle organic light grain vignette overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.5)_100%)] pointer-events-none" />
    </div>
  )
}
