import type { DemoScript } from '../../../../shared/demo'
import { answerChunks, doneAfter } from './utils'

const answer = `For music production, I would optimize for sustained CPU performance, quiet cooling, RAM, and low-latency driver stability before chasing a flashy GPU.

**Shortlist**

**1. MacBook Pro 14-inch, M-series Pro chip**
Best all-around pick if you use Logic Pro, Ableton, FL Studio, or heavy sample libraries. It is quiet, has strong battery life, and handles sessions with many software instruments very well. Get at least 24 GB of unified memory if you keep large Kontakt libraries or orchestral templates open.

**2. ASUS ProArt P16 or similar creator laptop**
Good Windows option if you want a strong CPU, OLED display, and dedicated GPU for visual work too. It is better if you also edit video, run 3D plugins, or want a single machine for creative production.

**3. Lenovo ThinkPad P-series or Dell XPS 16**
Good for reliability and ports, especially if you prefer Windows, external interfaces, and a more serviceable workstation-style setup.

**Minimum spec I would buy**
- CPU: modern high-performance laptop chip, not an ultra-budget U-series part.
- RAM: 16 GB minimum, 32 GB preferred.
- Storage: 1 TB SSD if you use sample packs.
- Ports: at least two fast USB-C/Thunderbolt ports.
- Noise: check reviews for fan behavior under sustained audio workloads.

**My recommendation**
If your main work is music, buy the best MacBook Pro 14 you can reasonably afford. If you need Windows for plugins, gaming, or FL Studio-specific workflow comfort, choose a creator/workstation laptop with 32 GB RAM and keep some budget for a proper audio interface.

Before purchase, I would verify your exact DAW, plugin list, and interface drivers against the OS version you plan to run.`

const answerEvents = answerChunks(answer, 5600, 44, 35)

export const musicLaptopScript: DemoScript = {
  id: 'music-laptop',
  trigger: 'Research the best laptops for music production',
  subtitle: 'A buyer-focused comparison for DAWs and plugins.',
  category: 'Research',
  events: [
    {
      kind: 'user_message',
      text: 'Research the best laptops for music production',
      at: 0
    },
    {
      kind: 'tool_start',
      tool: 'web_search',
      toolType: 'search',
      label: 'Researching current creator laptops',
      at: 360
    },
    { kind: 'tool_update', text: 'Scanning DAW performance recommendations...', at: 980 },
    { kind: 'tool_update', text: 'Checking thermal and fan-noise notes...', at: 2180 },
    { kind: 'tool_update', text: 'Comparing RAM and SSD upgrade tiers...', at: 3320 },
    { kind: 'tool_end', at: 4200 },
    {
      kind: 'thinking_chunk',
      text: '**Ranking criteria**\nPrioritizing sustained CPU, memory, low noise, and driver stability.\n',
      at: 4540
    },
    ...answerEvents,
    doneAfter(answerEvents)
  ]
}
