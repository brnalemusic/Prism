interface FluidGenerationPlaceholderProps {
  cancelled?: boolean
  label?: string
}

export function FluidGenerationPlaceholder({
  cancelled = false,
  label = 'Generating Image'
}: FluidGenerationPlaceholderProps): React.JSX.Element {
  return (
    <div
      className="image-generation-fluid"
      role="status"
      aria-live="polite"
      aria-label={cancelled ? 'Image generation cancelled' : label}
    >
      <div className="image-generation-fluid-field" aria-hidden="true">
        <span className="image-generation-liquid image-generation-liquid-a" />
        <span className="image-generation-liquid image-generation-liquid-b" />
        <span className="image-generation-liquid image-generation-liquid-c" />
        <span className="image-generation-liquid image-generation-liquid-d" />
        <span className="image-generation-fluid-light" />
      </div>
      <span className="image-generation-label">{cancelled ? 'Generation Cancelled' : label}</span>
    </div>
  )
}
