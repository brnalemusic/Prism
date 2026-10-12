import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  Compass,
  MagnifyingGlass,
  BookOpen,
  Sparkle,
  Robot,
  CheckCircle,
  Warning
} from '@phosphor-icons/react'
import type { ToolCallItem } from '../types/tab'
import type { DeepResearchPageItem, HarnessSource } from '../../../shared/types'
import { decodeHarnessToolResult } from '../harnessToolPresentation'
import { FetchSubagentPill, SourceFavicon, SourcePill } from './SourcePills'

function asHarnessSource(item: DeepResearchPageItem): HarnessSource {
  return {
    title: item.title,
    url: item.url,
    domain: item.domain,
    faviconUrl: item.faviconUrl || ''
  }
}

interface DeepResearchCardProps {
  toolCall: ToolCallItem
  chatId?: string
}

type CarouselFacetType =
  | 'floating-portal'
  | 'accessing-pages'
  | 'reading-about'
  | 'searching-about'
  | 'status-phrase'
  | 'page-summary'

interface CarouselFacet {
  id: string
  type: CarouselFacetType
  data: any
}

const CONTEMPLATIVE_PHRASES = [
  'Conducting in-depth research',
  'Cross-referencing data',
  'Synthesizing multi-source intelligence',
  'Analyzing search angles',
  'Verifying authoritative references',
  'Validating empirical claims'
]

function TypewriterText({
  text,
  speed = 22,
  className
}: {
  text: string
  speed?: number
  className?: string
}): React.JSX.Element {
  const reduced = useReducedMotion()
  const [displayedCount, setDisplayedCount] = useState(reduced ? text.length : 0)

  useEffect(() => {
    if (reduced) {
      setDisplayedCount(text.length)
      return
    }

    setDisplayedCount(0)
    let current = 0
    const interval = setInterval(() => {
      current++
      setDisplayedCount(current)
      if (current >= text.length) {
        clearInterval(interval)
      }
    }, speed)

    return () => clearInterval(interval)
  }, [text, speed, reduced])

  return (
    <span className={className}>
      {text.slice(0, displayedCount)}
      {!reduced && displayedCount < text.length && (
        <span className="inline-block w-1.5 h-3.5 ml-0.5 -mb-0.5 bg-accent-primary animate-pulse" />
      )}
    </span>
  )
}

export function DeepResearchCard({ toolCall }: DeepResearchCardProps): React.JSX.Element {
  const systemReduced = useReducedMotion()
  const surfaceRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<number | null>(null)
  const visibleRef = useRef(true)

  const argsTitle =
    typeof toolCall.args.title === 'string'
      ? toolCall.args.title.trim()
      : typeof toolCall.args.query === 'string'
        ? toolCall.args.query.trim()
        : 'Deep Research'

  const argsQueries = useMemo(() => {
    if (Array.isArray(toolCall.args.queries)) {
      return toolCall.args.queries.map((q) => String(q).trim()).filter(Boolean)
    }
    return [argsTitle]
  }, [toolCall.args.queries, argsTitle])

  const progress = toolCall.deepResearchProgress
  const queries = useMemo(() => {
    return progress?.queries && progress.queries.length > 0 ? progress.queries : argsQueries
  }, [progress?.queries, argsQueries])

  const pages = useMemo<DeepResearchPageItem[]>(() => {
    return progress?.pages || []
  }, [progress?.pages])

  // Real-time character progress calculation (minimum 5,000 chars required)
  const characterCount = progress?.characterCount || 0
  const minCharacters = progress?.minCharacters || 5000

  // Calculate percentage: if subagent is synthesizing, compute strictly from characterCount;
  // during searching/reading phases, show a subtle preparation progress (0% - 15%).
  const calculatedPercent = useMemo(() => {
    if (progress?.phase === 'synthesizing' || progress?.phase === 'polishing') {
      return Math.min(100, Math.floor((characterCount / minCharacters) * 100))
    }
    if (progress?.phase === 'reading' && pages.length > 0) {
      return Math.min(15, Math.floor((pages.length / 10) * 15))
    }
    if (progress?.phase === 'searching') {
      return 5
    }
    return 0
  }, [progress?.phase, characterCount, minCharacters, pages.length])

  // Polishing text morph state: when 100% is reached, wait gracefully before showing "Polishing search..."
  const [showPolishingText, setShowPolishingText] = useState(false)
  useEffect(() => {
    if (calculatedPercent >= 100) {
      const timer = setTimeout(() => {
        setShowPolishingText(true)
      }, 1200)
      return () => clearTimeout(timer)
    }
    setShowPolishingText(false)
    return undefined
  }, [calculatedPercent])

  // Mouse radial lighting setup (inspired by Git recovery card)
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      visibleRef.current = entry.isIntersecting
    })
    if (surfaceRef.current) observer.observe(surfaceRef.current)
    return () => {
      observer.disconnect()
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    }
  }, [])

  // Random facet carousel selection
  const [facet, setFacet] = useState<CarouselFacet>({
    id: 'initial',
    type: 'status-phrase',
    data: 'Conducting in-depth research'
  })

  const facetIndexRef = useRef(0)

  useEffect(() => {
    if (toolCall.status !== 'running' && toolCall.status !== 'writing') return undefined

    const cycleInterval = setInterval(() => {
      facetIndexRef.current++
      const availableTypes: CarouselFacetType[] = ['status-phrase']

      if (queries.length > 0) {
        availableTypes.push('searching-about')
      }
      if (pages.length > 0) {
        availableTypes.push('floating-portal')
        availableTypes.push('accessing-pages')
        availableTypes.push('reading-about')
        const pagesWithSnippet = pages.filter((p) => p.snippet && p.snippet.length > 30)
        if (pagesWithSnippet.length > 0) {
          availableTypes.push('page-summary')
        }
      }

      // Filter out the current type to guarantee dynamic variety across steps
      const candidateTypes = availableTypes.filter((t) => t !== facet.type)
      const selectedType =
        candidateTypes.length > 0
          ? candidateTypes[Math.floor(Math.random() * candidateTypes.length)]
          : availableTypes[Math.floor(Math.random() * availableTypes.length)]

      let facetData: any = null
      switch (selectedType) {
        case 'floating-portal': {
          facetData = pages[Math.floor(Math.random() * pages.length)]
          break
        }
        case 'accessing-pages': {
          // Select 1 to 2 pages to access
          const sampleCount = Math.min(pages.length, Math.random() > 0.5 ? 2 : 1)
          const shuffled = [...pages].sort(() => 0.5 - Math.random())
          facetData = shuffled.slice(0, sampleCount)
          break
        }
        case 'reading-about': {
          facetData = pages[Math.floor(Math.random() * pages.length)]
          break
        }
        case 'searching-about': {
          facetData = queries[Math.floor(Math.random() * queries.length)]
          break
        }
        case 'page-summary': {
          const eligible = pages.filter((p) => p.snippet && p.snippet.length > 30)
          facetData = eligible[Math.floor(Math.random() * eligible.length)] || pages[0]
          break
        }
        case 'status-phrase':
        default: {
          const phrases = CONTEMPLATIVE_PHRASES.filter((p) => p !== facet.data)
          facetData = phrases[Math.floor(Math.random() * phrases.length)]
          break
        }
      }

      setFacet({
        id: `facet-${facetIndexRef.current}-${selectedType}`,
        type: selectedType,
        data: facetData
      })
    }, 3400)

    return () => clearInterval(cycleInterval)
  }, [toolCall.status, queries, pages, facet.type, facet.data])

  // Morph to completion pill when finished
  if (toolCall.status === 'done') {
    const decoded = toolCall.result ? decodeHarnessToolResult(toolCall.result) : null
    const subagent = decoded?.fetchSubagent || {
      title: argsTitle,
      query: argsTitle,
      summary: toolCall.result || '',
      sources: decoded?.sources || []
    }

    return (
      <motion.div
        layout
        initial={systemReduced ? false : { opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 220, damping: 24 }}
        className="my-1.5"
      >
        <FetchSubagentPill subagent={subagent} />
      </motion.div>
    )
  }

  // Error / Cancelled state
  if (toolCall.status === 'error' || toolCall.status === 'cancelled') {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative my-2.5 overflow-hidden rounded-xl border border-white/[0.04] bg-[var(--surface)] p-3 text-xs text-text-muted flex items-center gap-2"
      >
        {toolCall.status === 'error' ? (
          <Warning size={14} className="text-red-400 shrink-0" />
        ) : (
          <CheckCircle size={14} className="text-text-muted shrink-0" />
        )}
        <span className="truncate">
          {toolCall.status === 'error' ? 'Deep Research encountered an error.' : 'Deep Research stopped.'}
        </span>
      </motion.div>
    )
  }

  // Active contemplative research modal
  return (
    <motion.div
      ref={surfaceRef}
      layout={!systemReduced}
      initial={systemReduced ? undefined : { opacity: 0, height: 0, scale: 0.98 }}
      animate={{ opacity: 1, height: 'auto', scale: 1 }}
      exit={systemReduced ? undefined : { opacity: 0, height: 0, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 180, damping: 24, mass: 0.8 }}
      className="relative isolate my-3.5 overflow-hidden rounded-2xl bg-[var(--surface)] p-4 sm:p-5 text-text-primary border border-white/[0.04] shadow-md select-none"
      onPointerMove={(event) => {
        if (systemReduced || !visibleRef.current || frameRef.current !== null) return
        const rect = event.currentTarget.getBoundingClientRect()
        const x = event.clientX - rect.left
        const y = event.clientY - rect.top
        frameRef.current = requestAnimationFrame(() => {
          surfaceRef.current?.style.setProperty('--research-mouse-x', `${x}px`)
          surfaceRef.current?.style.setProperty('--research-mouse-y', `${y}px`)
          frameRef.current = null
        })
      }}
      onPointerLeave={() => {
        surfaceRef.current?.style.removeProperty('--research-mouse-x')
        surfaceRef.current?.style.removeProperty('--research-mouse-y')
      }}
    >
      {/* Background grid texture & ambient radial accent glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.06]"
        style={{
          backgroundImage:
            'linear-gradient(var(--accent-primary) 1px, transparent 1px), linear-gradient(90deg, var(--accent-primary) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          maskImage: 'radial-gradient(ellipse at 80% 20%, black, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse at 80% 20%, black, transparent 75%)'
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.14] blur-2xl transition-opacity duration-300"
        style={{
          background:
            'radial-gradient(220px circle at var(--research-mouse-x, 85%) var(--research-mouse-y, 25%), var(--accent-primary), transparent)'
        }}
      />

      {/* Top Header Row */}
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.04] pb-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center justify-center w-5 h-5 rounded-md bg-accent-primary/10 text-accent-primary shrink-0">
            <Robot size={13} weight="duotone" className="animate-pulse" />
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">
            Deep Research
          </span>
          {argsTitle && (
            <>
              <span className="text-white/20">·</span>
              <span className="text-[11.5px] font-medium text-text-secondary truncate max-w-[240px] sm:max-w-[360px]">
                {argsTitle}
              </span>
            </>
          )}
        </div>

        {/* Minimalist Progress Meter */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-16 sm:w-20 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
            <motion.div
              className="h-full bg-accent-primary rounded-full shadow-[0_0_8px_var(--accent-primary)]"
              initial={{ width: '0%' }}
              animate={{ width: `${calculatedPercent}%` }}
              transition={{ type: 'spring', stiffness: 120, damping: 20 }}
            />
          </div>
          <div className="text-[11px] font-semibold tabular-nums text-text-secondary min-w-[32px] text-right">
            <AnimatePresence mode="wait">
              {showPolishingText ? (
                <motion.span
                  key="polishing"
                  initial={{ opacity: 0, y: 2 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -2 }}
                  transition={{ duration: 0.3 }}
                  className="text-accent-primary font-medium text-[10.5px]"
                >
                  Polishing search...
                </motion.span>
              ) : (
                <motion.span
                  key="percent"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {calculatedPercent}%
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Center Dynamic Facet Area */}
      <div className="min-h-[110px] flex items-center justify-center py-4 px-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={facet.id}
            initial={systemReduced ? undefined : { opacity: 0, filter: 'blur(8px)', scale: 0.98 }}
            animate={{ opacity: 1, filter: 'blur(0px)', scale: 1 }}
            exit={systemReduced ? undefined : { opacity: 0, filter: 'blur(6px)', scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 220, damping: 22, mass: 0.7 }}
            className="w-full flex flex-col items-center justify-center text-center"
          >
            {/* 1. Floating Portal Card */}
            {facet.type === 'floating-portal' && facet.data && (
              <motion.div
                whileHover={{ y: -2 }}
                className="group inline-flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.08] shadow-sm max-w-sm transition-all"
              >
                <SourceFavicon source={asHarnessSource(facet.data)} className="w-4 h-4 rounded-full shrink-0" />
                <div className="flex flex-col text-left min-w-0">
                  <span className="text-[12px] font-medium text-text-primary truncate">
                    {facet.data.domain}
                  </span>
                  <span className="text-[10px] text-text-muted truncate max-w-[220px]">
                    {facet.data.title || facet.data.url}
                  </span>
                </div>
              </motion.div>
            )}

            {/* 2. Accessing Page(s) */}
            {facet.type === 'accessing-pages' && Array.isArray(facet.data) && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <span className="text-[12px] text-text-muted font-normal">
                  Accessing {facet.data.length > 1 ? 'pages' : 'page'}
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {facet.data.map((item: DeepResearchPageItem, idx: number) => (
                    <SourcePill key={item.url || idx} source={asHarnessSource(item)} index={idx} />
                  ))}
                </div>
              </div>
            )}

            {/* 3. Reading about [Title] */}
            {facet.type === 'reading-about' && facet.data && (
              <div className="max-w-md px-2 space-y-1">
                <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-accent-primary uppercase tracking-wider">
                  <BookOpen size={13} weight="bold" />
                  <span>Reading about</span>
                </div>
                <p className="text-[13px] font-medium leading-relaxed text-text-primary">
                  <TypewriterText text={facet.data.title || facet.data.domain} speed={20} />
                </p>
              </div>
            )}

            {/* 4. Searching about [Query] */}
            {facet.type === 'searching-about' && facet.data && (
              <div className="max-w-md px-2 space-y-1">
                <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-accent-primary uppercase tracking-wider">
                  <MagnifyingGlass size={13} weight="bold" />
                  <span>Searching about</span>
                </div>
                <p className="text-[13px] font-medium leading-relaxed text-text-primary">
                  <TypewriterText text={facet.data} speed={22} />
                </p>
              </div>
            )}

            {/* 5. Contemplative Status Phrase */}
            {facet.type === 'status-phrase' && (
              <div className="flex items-center gap-2 text-[13px] font-medium text-text-secondary">
                <Sparkle size={14} className="text-accent-primary shrink-0 animate-pulse" />
                <TypewriterText text={facet.data} speed={25} />
              </div>
            )}

            {/* 6. Page Summary Excerpt with Bottom Alpha Mask Fade */}
            {facet.type === 'page-summary' && facet.data && (
              <div className="w-full max-w-lg px-2">
                <div className="flex items-center justify-center gap-1.5 mb-1.5 text-[10.5px] text-text-muted">
                  <SourceFavicon source={asHarnessSource(facet.data)} className="w-3 h-3 rounded-full shrink-0" />
                  <span className="font-medium truncate">{facet.data.domain}</span>
                  <span>·</span>
                  <span className="truncate max-w-[200px]">{facet.data.title}</span>
                </div>
                <div
                  style={{
                    WebkitMaskImage:
                      'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 45%, rgba(0,0,0,0) 100%)',
                    maskImage:
                      'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 45%, rgba(0,0,0,0) 100%)'
                  }}
                  className="max-h-[64px] overflow-hidden text-[11.5px] leading-relaxed text-text-secondary text-left"
                >
                  <TypewriterText text={facet.data.snippet || ''} speed={8} />
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom Subtext / Footer Info */}
      <div className="flex items-center justify-between pt-2 border-t border-white/[0.04] text-[10.5px] text-text-muted">
        <div className="flex items-center gap-1.5">
          <Compass size={12} className="text-accent-primary" />
          <span>Synthesizing multi-angle web research</span>
        </div>
        {pages.length > 0 && (
          <span className="font-mono text-[10px]">
            {pages.length} source{pages.length === 1 ? '' : 's'} indexed
          </span>
        )}
      </div>
    </motion.div>
  )
}
