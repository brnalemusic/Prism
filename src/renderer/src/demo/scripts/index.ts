import type { DemoScript } from '../../../../shared/demo'
import { tripJapanScript } from './tripJapan'
import { musicLaptopScript } from './musicLaptop'
import { downloadsCleanupScript } from './downloadsCleanup'
import { gitStatusScript } from './gitStatus'
import { focusWorkspaceScript } from './focusWorkspace'

export const demoScripts: DemoScript[] = [
  tripJapanScript,
  musicLaptopScript,
  downloadsCleanupScript,
  gitStatusScript,
  focusWorkspaceScript
]

export function getDemoScript(id: string): DemoScript | undefined {
  return demoScripts.find((script) => script.id === id)
}
