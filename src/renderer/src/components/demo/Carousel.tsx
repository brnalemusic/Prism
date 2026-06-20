import { useEffect, useMemo, useState } from 'react'
import { Images } from '@phosphor-icons/react'

const imageModules = import.meta.glob<string>('../../assets/install/examples/*.{png,jpg,jpeg,webp}', {
  eager: true,
  import: 'default'
})

const FALLBACK_SLIDES = [
  {
    title: 'Scripted Chat',
    body: 'Tool calls, thinking, and streamed responses.'
  },
  {
    title: 'Desktop Actions',
    body: 'Search, inspect files, open apps, automate.'
  },
  {
    title: 'PrismCLI',
    body: 'Terminal-first automation companion.'
  }
]

export function Carousel(): React.JSX.Element {
  const images = useMemo(
    () =>
      Object.entries(imageModules)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, src]) => src),
    []
  )
  const slideCount = images.length || FALLBACK_SLIDES.length
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIndex((value) => (value + 1) % slideCount)
    }, 4000)
    return () => window.clearInterval(timer)
  }, [slideCount])

  return (
    <div className="overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.025]">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <Images size={13} className="text-text-muted" />
        <span className="text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
          Preview
        </span>
        <span className="ml-auto text-[10px] tabular-nums text-text-muted/50">
          {index + 1}/{slideCount}
        </span>
      </div>

      {/* Slide */}
      <div className="relative h-[120px]">
        {images.length > 0 ? (
          <img
            src={images[index]}
            alt="Prism example"
            className="h-full w-full object-cover object-top transition-opacity duration-500"
          />
        ) : (
          <div className="flex h-full flex-col justify-center px-4 py-3">
            <div className="text-xs font-semibold text-text-primary">
              {FALLBACK_SLIDES[index].title}
            </div>
            <p className="mt-0.5 text-[11px] leading-snug text-text-secondary">
              {FALLBACK_SLIDES[index].body}
            </p>
          </div>
        )}

        {/* Dot indicators */}
        <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1">
          {Array.from({ length: slideCount }).map((_, dotIndex) => (
            <button
              key={dotIndex}
              onClick={() => setIndex(dotIndex)}
              className={`h-1 rounded-full transition-all duration-200 ${
                dotIndex === index ? 'w-4 bg-accent-secondary' : 'w-1 bg-white/25'
              }`}
              title={`Slide ${dotIndex + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
