import bannerImg from '../../../../resources/banner.png?asset'

interface LandingBackgroundEffectsProps {
  theme?: string
}

export function LandingBackgroundEffects(_props: LandingBackgroundEffectsProps): React.JSX.Element {
  return (
    <div className="absolute -top-16 left-0 right-0 bottom-0 pointer-events-none z-0 flex flex-col items-center justify-start overflow-visible">
      <img
        src={bannerImg}
        alt="Prism Background Banner"
        className="w-[1080px] max-w-[98vw] h-auto object-contain opacity-40 select-none pointer-events-none -mt-2 sm:-mt-4 transition-all duration-500"
      />
    </div>
  )
}
