import React from 'react'
import bannerImg from '../../../../resources/banner.png?asset'

interface MissingKeyBannerProps {
  onAddKey: () => void
}

export function MissingKeyBanner({ onAddKey }: MissingKeyBannerProps): React.JSX.Element {
  return (
    <div className="w-full px-6 pt-4 animate-soft-pop sm:px-12">
      <div
        onClick={onAddKey}
        className="premium-panel-soft group relative aspect-[3/1] max-h-[180px] w-full cursor-pointer overflow-hidden rounded-[30px] transition-all duration-300 hover:border-accent-primary/30"
      >
        <img
          src={bannerImg}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
          alt="Prism Banner"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background-main via-background-main/35 to-transparent opacity-90" />

        <div className="absolute inset-0 flex items-center justify-start pl-6 sm:pl-12 p-6 sm:p-8">
          <button className="whitespace-nowrap rounded-[18px] bg-text-primary px-6 py-3 text-xs font-semibold text-black shadow-xl transition-all hover:bg-white active:scale-95">
            Set Up
          </button>
        </div>
      </div>
    </div>
  )
}
