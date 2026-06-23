import { useEffect, useState } from 'react'

interface Particle {
  id: number
  x: number // percentage 0-100
  y: number // percentage 0-100
  size: number // pixels/rem
  delay: number // seconds
  duration: number // seconds
  rotation?: number // degrees
}

interface WindGust {
  id: number
  y: number // percentage
  delay: number
  duration: number
  scaleY: number
}

interface LandingBackgroundEffectsProps {
  theme: 'marine' | 'vertez' | 'akoustik' | 'terno' | 'ursula' | 'rgb'
}

export function LandingBackgroundEffects({ theme }: LandingBackgroundEffectsProps): React.JSX.Element | null {
  const [stars, setStars] = useState<Particle[]>([])
  const [embers, setEmbers] = useState<Particle[]>([])
  const [leaves, setLeaves] = useState<Particle[]>([])
  const [windGusts, setWindGusts] = useState<WindGust[]>([])

  useEffect(() => {
    // Generate star coordinates for Marine/Akoustik
    const newStars = Array.from({ length: 30 }).map((_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: 1 + Math.random() * 2, // 1px to 3px
      delay: Math.random() * 5,
      duration: 3 + Math.random() * 4
    }))
    setStars(newStars)

    // Generate embers for Vertez
    const newEmbers = Array.from({ length: 18 }).map((_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: 70 + Math.random() * 30, // start near the bottom half
      size: 1.5 + Math.random() * 2.5, // 1.5px to 4px
      delay: Math.random() * 8,
      duration: 8 + Math.random() * 8
    }))
    setEmbers(newEmbers)

    // Generate leaves for Ursula Tree
    const newLeaves = Array.from({ length: 8 }).map((_, i) => ({
      id: i,
      x: -10 - Math.random() * 20, // start off-screen left
      y: Math.random() * 60, // start in top half
      size: 12 + Math.random() * 12, // size in px
      delay: Math.random() * 12,
      duration: 12 + Math.random() * 8,
      rotation: Math.random() * 360
    }))
    setLeaves(newLeaves)

    // Generate wind gusts for Ursula Tree
    const newWind = Array.from({ length: 3 }).map((_, i) => ({
      id: i,
      y: 20 + Math.random() * 60, // random height
      delay: Math.random() * 8,
      duration: 6 + Math.random() * 5,
      scaleY: 0.5 + Math.random() * 1.5
    }))
    setWindGusts(newWind)
  }, [theme])

  if (theme === 'terno') {
    // Terno only has the white glow behind input box, handled in parent
    return null
  }

  // 1. Marine Theme Background
  if (theme === 'marine') {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        {/* Soft, morphing background glows */}
        <div className="absolute top-[10%] left-[20%] w-[350px] h-[350px] rounded-full bg-blue-600/10 blur-[90px] animate-slow-pulse" />
        <div className="absolute bottom-[20%] right-[15%] w-[420px] h-[420px] rounded-full bg-teal-500/10 blur-[110px] animate-slow-pulse" style={{ animationDelay: '-1.5s' }} />

        {/* Twinkling constellation stars */}
        {stars.map((star) => (
          <div
            key={star.id}
            className="absolute rounded-full bg-white animate-twinkle-star"
            style={
              {
                left: `${star.x}%`,
                top: `${star.y}%`,
                width: `${star.size}px`,
                height: `${star.size}px`,
                '--delay': `${star.delay}s`,
                '--duration': `${star.duration}s`
              } as React.CSSProperties
            }
          />
        ))}
      </div>
    )
  }

  // 2. Akoustik Theme Background
  if (theme === 'akoustik') {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        {/* Soft purple/magenta glows */}
        <div className="absolute top-[15%] right-[20%] w-[380px] h-[380px] rounded-full bg-purple-600/10 blur-[100px] animate-slow-pulse" />
        <div className="absolute bottom-[15%] left-[15%] w-[400px] h-[400px] rounded-full bg-fuchsia-500/8 blur-[100px] animate-slow-pulse" style={{ animationDelay: '-2s' }} />

        {/* Twinkling stars */}
        {stars.map((star) => (
          <div
            key={star.id}
            className="absolute rounded-full bg-indigo-200 animate-twinkle-star"
            style={
              {
                left: `${star.x}%`,
                top: `${star.y}%`,
                width: `${star.size}px`,
                height: `${star.size}px`,
                '--delay': `${star.delay}s`,
                '--duration': `${star.duration}s`
              } as React.CSSProperties
            }
          />
        ))}
      </div>
    )
  }

  // 3. Vertez Theme Background (Lava/Meltdown)
  if (theme === 'vertez') {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        {/* Shifting warm volcanic heat zones */}
        <div className="absolute top-1/2 left-[15%] -translate-y-1/2 w-[500px] h-[300px] bg-red-950/15 blur-[120px] animate-morph-lava" style={{ '--duration': '22s' } as any} />
        <div className="absolute top-1/3 right-[15%] w-[450px] h-[350px] bg-orange-950/20 blur-[120px] animate-morph-lava" style={{ '--duration': '18s', animationDelay: '-4s' } as any} />
        <div className="absolute bottom-0 left-[35%] w-[600px] h-[200px] bg-red-900/10 blur-[90px] rounded-full" />

        {/* Rising embers */}
        {embers.map((ember) => (
          <div
            key={ember.id}
            className="absolute rounded-full bg-gradient-to-t from-orange-400 to-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)] animate-rise-ember"
            style={
              {
                left: `${ember.x}%`,
                top: `${ember.y}%`,
                width: `${ember.size}px`,
                height: `${ember.size}px`,
                '--delay': `${ember.delay}s`,
                '--duration': `${ember.duration}s`
              } as React.CSSProperties
            }
          />
        ))}
      </div>
    )
  }

  // 4. Ursula Tree Theme Background
  if (theme === 'ursula') {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        {/* Soft deep forest glows */}
        <div className="absolute top-[10%] left-[30%] w-[380px] h-[380px] rounded-full bg-green-900/10 blur-[100px] animate-slow-pulse" />
        <div className="absolute bottom-[20%] right-[20%] w-[420px] h-[420px] rounded-full bg-emerald-950/15 blur-[110px] animate-slow-pulse" style={{ animationDelay: '-3s' }} />

        {/* Wind lines / blurred gusts passing through */}
        {windGusts.map((gust) => (
          <div
            key={gust.id}
            className="absolute h-[1.5px] w-[250px] rounded-full bg-gradient-to-r from-transparent via-emerald-400/12 to-transparent blur-[3px] animate-wind-sweep"
            style={
              {
                top: `${gust.y}%`,
                '--delay': `${gust.delay}s`,
                '--duration': `${gust.duration}s`,
                transform: `scaleY(${gust.scaleY})`
              } as React.CSSProperties
            }
          />
        ))}

        {/* Twinkling sparkles */}
        {stars.map((star) => (
          <div
            key={star.id}
            className="absolute rounded-full bg-emerald-300 animate-sparkle-green"
            style={
              {
                left: `${star.x}%`,
                top: `${star.y}%`,
                width: `${star.size * 0.9}px`,
                height: `${star.size * 0.9}px`,
                '--delay': `${star.delay}s`,
                '--duration': `${star.duration * 0.9}s`
              } as React.CSSProperties
            }
          />
        ))}

        {/* Drifting leaves */}
        {leaves.map((leaf) => (
          <svg
            key={leaf.id}
            viewBox="0 0 24 24"
            className="absolute fill-emerald-800/25 stroke-emerald-700/15 animate-drift-leaf"
            style={
              {
                top: `${leaf.y}%`,
                width: `${leaf.size}px`,
                height: `${leaf.size}px`,
                '--delay': `${leaf.delay}s`,
                '--duration': `${leaf.duration}s`,
                transform: `rotate(${leaf.rotation}deg)`
              } as React.CSSProperties
            }
          >
            <path d="M17,8C8,10 5.9,16.17 3.82,21.34L5.71,22L6.58,20.08C7.11,20.22 7.65,20.3 8.2,20.3C14.73,20.3 19,16 19,9.5C19,9 18.9,8.5 18.72,8C18.13,8 17.56,8 17,8M8.2,19.1C7.8,19.1 7.42,19.04 7.06,18.94L14.7,11.3C15.1,10.9 15.1,10.27 14.7,9.88C14.3,9.5 13.67,9.5 13.28,9.88L5.64,17.5C5.43,16.5 5.72,15.14 6.78,13.78C8.9,11 15.3,9.25 17.8,9.1C17.65,11.6 15.9,18 13.1,18C12.18,18 11.23,17.5 10.45,17L8.71,18.74C8.54,18.9 8.35,19 8.2,19.1Z" />
          </svg>
        ))}
      </div>
    )
  }

  // 5. RGB Theme Background (uses default simple glows)
  if (theme === 'rgb') {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative h-[320px] w-[560px] blur-[96px] opacity-[0.55]">
            <div className="absolute inset-0 rounded-full home-radial-glow rgb-glow-default" />
            <div className="absolute inset-0 rounded-full rgb-glow-red" />
            <div className="absolute inset-0 rounded-full rgb-glow-green" />
            <div className="absolute inset-0 rounded-full rgb-glow-blue" />
          </div>
        </div>
      </div>
    )
  }

  return null
}
