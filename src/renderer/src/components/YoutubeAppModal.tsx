import React, { useState, useEffect } from 'react'
import { YoutubeLogo, X, Play } from '@phosphor-icons/react'
import clsx from 'clsx'

interface YoutubeAppModalProps {
  isOpen: boolean
  onClose: () => void
  onRun: (data: {
    query: string
    sortBy: string
    duration: string
    type: string
    customInstructions: string
  }) => void
}

export function YoutubeAppModal({
  isOpen,
  onClose,
  onRun
}: YoutubeAppModalProps): React.JSX.Element | null {
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('relevance')
  const [duration, setDuration] = useState('any')
  const [type, setType] = useState('video')
  const [customInstructions, setCustomInstructions] = useState('')
  const [isVisible, setIsVisible] = useState(false)

  // Sync open state animation
  useEffect(() => {
    if (isOpen) {
      setIsVisible(true)
      setQuery('')
      setSortBy('relevance')
      setDuration('any')
      setType('video')
      setCustomInstructions('')
    } else {
      const timer = setTimeout(() => setIsVisible(false), 300)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [isOpen])

  if (!isOpen && !isVisible) return null

  const handleRun = (): void => {
    if (!query.trim()) return
    onRun({
      query: query.trim(),
      sortBy,
      duration,
      type,
      customInstructions: customInstructions.trim()
    })
    onClose()
  }

  const isValid = query.trim().length > 0

  return (
    <div
      className={clsx(
        'fixed inset-0 z-[100] flex items-center justify-center p-4 transition-all duration-300',
        isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
      )}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/[0.55] backdrop-blur-xl" onClick={onClose} />

      {/* Modal Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        className={clsx(
          'premium-panel relative w-full max-w-xl overflow-hidden rounded-[30px] transition-all duration-300 transform bg-[#12141a] border border-white/[0.08] shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex flex-col max-h-[85vh]',
          isOpen ? 'scale-100 translate-y-0' : 'scale-95 translate-y-4'
        )}
      >
        {/* Header */}
        <div className="p-6 pb-4 border-b border-white/[0.04] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-red-500/20 bg-red-500/[0.08] text-red-500">
              <YoutubeLogo size={20} weight="fill" />
            </div>
            <h2 className="text-base font-semibold text-text-primary">YouTube Assistant App</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-text-secondary/50 transition-colors hover:bg-white/[0.06] hover:text-text-primary"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Main Search Input */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-text-secondary/70">
              Video, Playlist or Channel Search Query
            </label>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="What do you want to find and play?"
              className="w-full rounded-[18px] border border-white/[0.08] bg-white/[0.035] px-4 py-3 text-sm text-text-primary placeholder:text-text-muted transition-all focus:border-red-500/40 focus:outline-none"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && isValid) {
                  handleRun()
                }
              }}
            />
          </div>

          <div className="h-px bg-white/[0.04]" />

          {/* Filters Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Type */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-text-secondary/70">Type</label>
              <div className="relative">
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="w-full appearance-none rounded-[14px] border border-white/[0.08] bg-white/[0.035] px-3.5 py-2.5 text-xs text-text-primary placeholder:text-text-muted transition-all focus:border-red-500/40 focus:outline-none cursor-pointer"
                >
                  <option value="video" className="bg-[#13151a] text-text-primary">Video</option>
                  <option value="playlist" className="bg-[#13151a] text-text-primary">Playlist</option>
                  <option value="channel" className="bg-[#13151a] text-text-primary">Channel</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-text-secondary/50">
                  <svg className="fill-current h-3.5 w-3.5" viewBox="0 0 20 20">
                    <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Sort By */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-text-secondary/70">Sort By</label>
              <div className="relative">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="w-full appearance-none rounded-[14px] border border-white/[0.08] bg-white/[0.035] px-3.5 py-2.5 text-xs text-text-primary placeholder:text-text-muted transition-all focus:border-red-500/40 focus:outline-none cursor-pointer"
                >
                  <option value="relevance" className="bg-[#13151a] text-text-primary">Relevance</option>
                  <option value="date" className="bg-[#13151a] text-text-primary">Upload Date</option>
                  <option value="views" className="bg-[#13151a] text-text-primary">View Count</option>
                  <option value="rating" className="bg-[#13151a] text-text-primary">Rating</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-text-secondary/50">
                  <svg className="fill-current h-3.5 w-3.5" viewBox="0 0 20 20">
                    <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Duration */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-text-secondary/70">Duration</label>
              <div className="relative">
                <select
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  className="w-full appearance-none rounded-[14px] border border-white/[0.08] bg-white/[0.035] px-3.5 py-2.5 text-xs text-text-primary placeholder:text-text-muted transition-all focus:border-red-500/40 focus:outline-none cursor-pointer"
                >
                  <option value="any" className="bg-[#13151a] text-text-primary">Any</option>
                  <option value="short" className="bg-[#13151a] text-text-primary">Short (&lt; 4 min)</option>
                  <option value="medium" className="bg-[#13151a] text-text-primary">Medium (4-20 min)</option>
                  <option value="long" className="bg-[#13151a] text-text-primary">Long (&gt; 20 min)</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-text-secondary/50">
                  <svg className="fill-current h-3.5 w-3.5" viewBox="0 0 20 20">
                    <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
                  </svg>
                </div>
              </div>
            </div>
          </div>

          <div className="h-px bg-white/[0.04]" />

          {/* Custom Instructions */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-text-secondary/70">
              Custom AI Instructions (Optional)
            </label>
            <textarea
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              placeholder="e.g. Summarize the video contents, find the lyrics, play the official audio version..."
              className="w-full min-h-[80px] max-h-[160px] resize-y bg-white/[0.02] border border-white/[0.08] rounded-xl p-3 text-xs text-text-primary placeholder:text-text-muted focus:border-red-500/40 focus:outline-none transition-all"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-white/[0.04] flex items-center justify-end gap-3 shrink-0">
          <button
            onClick={onClose}
            className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-2 text-sm font-semibold text-text-secondary hover:bg-white/[0.06] hover:text-text-primary transition-all active:scale-[0.98] focus:outline-none"
          >
            Cancel
          </button>
          <button
            onClick={handleRun}
            disabled={!isValid}
            className={clsx(
              'flex items-center gap-2 rounded-2xl px-6 py-2 text-sm font-semibold transition-all active:scale-[0.98] focus:outline-none',
              isValid
                ? 'bg-red-600 text-white hover:bg-red-500 cursor-pointer shadow-md'
                : 'bg-white/[0.055] text-text-muted cursor-not-allowed'
            )}
          >
            <Play size={14} weight="fill" />
            Run
          </button>
        </div>
      </div>
    </div>
  )
}
