import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { DownloadSimple, X } from '@phosphor-icons/react'
import type { ToolImageAttachment } from '../../../shared/types'

interface GeneratedImageViewerProps {
  attachment: ToolImageAttachment
  alt: string
  onClose: () => void
  onDownload: (attachment: ToolImageAttachment) => void
}

export function GeneratedImageViewer({
  attachment,
  alt,
  onClose,
  onDownload
}: GeneratedImageViewerProps): React.JSX.Element {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const controls = Array.from(
        document.querySelectorAll<HTMLElement>('[data-generated-image-viewer-control]')
      ).filter((element) => !element.hasAttribute('disabled'))
      if (controls.length === 0) return
      const activeIndex = controls.indexOf(document.activeElement as HTMLElement)
      const nextIndex = event.shiftKey
        ? activeIndex <= 0
          ? controls.length - 1
          : activeIndex - 1
        : activeIndex === -1 || activeIndex === controls.length - 1
          ? 0
          : activeIndex + 1
      event.preventDefault()
      controls[nextIndex].focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      previousFocusRef.current?.focus()
    }
  }, [onClose])

  return createPortal(
    <div
      className="generated-image-viewer prism-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Generated image viewer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="generated-image-viewer-actions">
        <button
          type="button"
          data-generated-image-viewer-control
          onClick={() => onDownload(attachment)}
          aria-label="Download generated image"
          title="Download image"
        >
          <DownloadSimple size={19} />
        </button>
        <button
          ref={closeButtonRef}
          type="button"
          data-generated-image-viewer-control
          onClick={onClose}
          aria-label="Close fullscreen image viewer"
          title="Close"
        >
          <X size={20} />
        </button>
      </div>
      <img
        src={`data:${attachment.mimeType};base64,${attachment.data}`}
        alt={alt}
        draggable={false}
      />
    </div>,
    document.body
  )
}
