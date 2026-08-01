import React from 'react'
import { ShieldCheck, Buildings, UserPlus } from '@phosphor-icons/react'
import type { UserProfile } from '../../../shared/types'

interface UserAccountCardProps {
  user: UserProfile | null
  onOpenAuth: () => void
  onOpenProfile: () => void
}

export const UserAccountCard: React.FC<UserAccountCardProps> = ({
  user,
  onOpenAuth,
  onOpenProfile
}) => {
  if (!user) {
    return (
      <button
        onClick={onOpenAuth}
        className="group relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs transition-all duration-200 cursor-pointer select-none text-text-secondary hover:bg-white/[0.04] hover:text-text-primary border border-dashed border-white/10 hover:border-white/20 mb-1.5"
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] text-text-muted group-hover:bg-accent-primary/20 group-hover:text-accent-primary transition-all duration-200">
          <UserPlus size={16} weight="bold" />
        </div>
        <div className="flex flex-col text-left min-w-0 flex-1">
          <span className="font-semibold text-text-primary group-hover:text-white text-xs truncate">
            Sign In / Register
          </span>
          <span className="text-[10px] text-text-muted/70 truncate">
            Sync account & unlock features
          </span>
        </div>
      </button>
    )
  }

  const isEnterprise =
    user.accountType === 'enterprise' ||
    user.accountType === 'company' ||
    Boolean(user.companyName)

  const initials = user.fullName
    ? user.fullName
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : user.email.slice(0, 2).toUpperCase()

  return (
    <button
      onClick={onOpenProfile}
      className="group relative flex w-full items-center gap-2.5 rounded-xl p-2.5 text-xs transition-all duration-200 cursor-pointer select-none bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.05] hover:border-white/[0.1] mb-1.5 shadow-sm"
    >
      {/* Avatar / Initials */}
      <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent-primary/30 to-purple-600/30 border border-white/15 text-accent-primary font-bold text-xs shadow-inner">
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt={user.fullName || user.email}
            className="h-full w-full rounded-lg object-cover"
          />
        ) : (
          <span>{initials}</span>
        )}

        {isEnterprise && (
          <span className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-accent-primary text-[8px] text-white shadow-sm">
            <ShieldCheck size={10} weight="fill" />
          </span>
        )}
      </div>

      {/* User Details */}
      <div className="flex flex-col text-left min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-text-primary truncate text-xs">
            {user.fullName || user.email.split('@')[0]}
          </span>
        </div>
        <span className="text-[10.5px] text-text-muted truncate leading-tight">
          {user.companyName || user.email}
        </span>
      </div>

      {/* Account Type Badge */}
      <div className="shrink-0 flex items-center">
        {isEnterprise ? (
          <span
            className="flex items-center gap-0.5 rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-accent-primary bg-accent-primary/10 border border-accent-primary/20"
            title={user.companyName ? `Enterprise Account: ${user.companyName}` : 'Enterprise Account'}
          >
            <Buildings size={10} weight="bold" />
            ENT
          </span>
        ) : (
          <span className="rounded px-1.5 py-0.5 font-mono text-[9px] font-medium text-text-muted bg-white/[0.04]">
            IND
          </span>
        )}
      </div>
    </button>
  )
}
