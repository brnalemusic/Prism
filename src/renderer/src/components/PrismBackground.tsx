export function PrismBackground(): React.JSX.Element {
  return (
    <div className="prism-background-field fixed inset-0 pointer-events-none overflow-hidden z-0 select-none">
      {/* Top subtle ambient glow */}
      <div className="absolute -top-[20%] left-1/2 -translate-x-1/2 w-[70vw] h-[40vh] rounded-full bg-[radial-gradient(ellipse_at_center,var(--home-glow-color-2)_0%,transparent_70%)] blur-[80px] opacity-60" />
      {/* Bottom ambient glow near floating command island */}
      <div className="absolute -bottom-[15%] left-1/2 -translate-x-1/2 w-[60vw] h-[35vh] rounded-full bg-[radial-gradient(ellipse_at_center,var(--home-glow-color-1)_0%,transparent_70%)] blur-[90px] opacity-40" />
    </div>
  )
}
