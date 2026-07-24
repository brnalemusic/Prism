import bannerImg from '../../../../resources/banner.png?asset'

interface LandingBackgroundEffectsProps {
  theme?: string
}

export function LandingBackgroundEffects({ _theme }: LandingBackgroundEffectsProps & { _theme?: string }): React.JSX.Element {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0 flex items-center justify-center">
      <img
        src={bannerImg}
        alt="Prism Background Banner"
        className="w-[760px] max-w-[92vw] h-auto object-contain opacity-40 select-none pointer-events-none -translate-y-16 sm:-translate-y-20 transition-opacity duration-700"
      />
    </div>
  )
}
