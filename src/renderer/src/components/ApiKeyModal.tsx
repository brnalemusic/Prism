import React from 'react'
import { ApiProviderWizardModal } from './ApiProviderWizardModal'
import { ProviderConfig } from '../../../shared/types'

interface ApiKeyModalProps {
  isOpen: boolean
  onClose: () => void
  onSave?: (key: string) => void
  initialValue?: string
}

export function ApiKeyModal({
  isOpen,
  onClose,
  onSave
}: ApiKeyModalProps): React.JSX.Element | null {
  if (!isOpen) return null

  const handleSaveProvider = async (provider: ProviderConfig) => {
    try {
      const existing = await window.api.getProviders()
      const updated = [...(existing || []), provider]
      await window.api.saveProviders(updated)
      if (onSave) {
        onSave(provider.apiKey)
      } else {
        onClose()
      }
    } catch (e) {
      console.error('Failed to save provider from modal:', e)
      onClose()
    }
  }

  return <ApiProviderWizardModal onClose={onClose} onSave={handleSaveProvider} />
}
