import { CaretDown, FileText } from '@phosphor-icons/react'
import licenseText from '../../../../../LICENSE?raw'

interface LicenseViewProps {
  accepted: boolean
  onAcceptedChange: (accepted: boolean) => void
}

export function LicenseView({
  accepted,
  onAcceptedChange
}: LicenseViewProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <details className="group rounded-lg border border-white/[0.08] bg-white/[0.025] transition-colors hover:border-white/[0.12]">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 select-none [&::-webkit-details-marker]:hidden">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.04]">
            <FileText size={14} className="text-text-secondary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-text-primary">GPL-3.0 License</div>
            <div className="text-[11px] text-text-muted">Prism + PrismCLI — click to read</div>
          </div>
          <CaretDown
            size={14}
            className="shrink-0 text-text-muted transition-transform duration-200 group-open:rotate-180"
          />
        </summary>
        <div className="border-t border-white/[0.06]">
          <pre className="max-h-[200px] overflow-y-auto whitespace-pre-wrap p-4 font-mono text-[10px] leading-relaxed text-text-secondary/75">
            {licenseText}
          </pre>
        </div>
      </details>

      <label className="flex items-center gap-2.5 rounded-lg border border-white/[0.08] bg-white/[0.025] px-4 py-3 text-sm text-text-secondary transition-colors hover:border-white/[0.12] hover:bg-white/[0.035]">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(event) => onAcceptedChange(event.target.checked)}
          className="h-4 w-4 accent-accent-secondary"
        />
        <span>I accept the GPL-3.0 license terms for Prism and PrismCLI.</span>
      </label>
    </div>
  )
}
