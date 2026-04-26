import React from 'react'
import bannerImg from '../../../../resources/banner.png?asset'

interface MissingKeyBannerProps {
  onAddKey: () => void
}

export function MissingKeyBanner({ onAddKey }: MissingKeyBannerProps): React.JSX.Element {
  return (
    <div className="w-full px-6 sm:px-12 pt-4 animate-in fade-in slide-in-from-top-4 duration-700">
      <div 
        onClick={onAddKey}
        className="relative w-full aspect-[3/1] max-h-[180px] rounded-2xl overflow-hidden border border-white/10 cursor-pointer group hover:border-accent-primary/40 transition-all duration-500 shadow-2xl"
      >
        <img 
          src={bannerImg} 
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" 
          alt="Prism Banner"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background-main via-background-main/20 to-transparent opacity-80" />
        
        <div className="absolute inset-0 flex items-center justify-start pl-6 sm:pl-12 p-6 sm:p-8">
          <button className="px-6 py-3 bg-white text-black text-xs font-black uppercase tracking-widest rounded-lg hover:scale-105 active:scale-95 transition-all whitespace-nowrap shadow-xl">
            Configurar
          </button>
        </div>
      </div>
    </div>
  )
}
