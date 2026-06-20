import type { DemoScript } from '../../../../shared/demo'
import { answerChunks, doneAfter } from './utils'

const answer = `Here is a practical Brazil to Japan plan built around comfort, first-time logistics, and a good rhythm once you land.

**Best route**
- Fly Sao Paulo (GRU) to Tokyo, usually landing at Haneda or Narita.
- The cleanest one-stop options tend to connect through Doha, Dubai, Istanbul, or a major US hub.
- If the price difference is small, choose Haneda for easier access to central Tokyo.

**Suggested 12 day itinerary**

Day 1-3: Tokyo. Stay near Shinjuku, Ueno, or Ginza if you want easy train access. Keep the first day light: hotel check-in, ramen, konbini snacks, and a short walk through Shinjuku Gyoen or Asakusa.

Day 4-5: Hakone or Kawaguchiko. Pick Hakone for onsen and ryokan comfort, or Kawaguchiko if Mount Fuji views are the priority.

Day 6-8: Kyoto. Focus on early mornings: Fushimi Inari before the crowds, Arashiyama, Nishiki Market, and an evening around Gion.

Day 9: Nara or Osaka. Nara is better for temples and a slower day. Osaka is better for food and nightlife.

Day 10-12: Back to Tokyo. Leave shopping, teamLab, Akihabara, Shimokitazawa, or a Disney day for the end so you are not dragging bags across the country.

**Budget notes**
- Flights: plan around USD 1,000-1,700 round trip depending on season.
- Hotels: USD 80-180 per night for comfortable midrange options.
- Food: USD 25-55 per day can be enough if you mix casual restaurants, markets, and convenience stores.
- Transport: compare a JR Pass against individual Shinkansen tickets. For this itinerary, individual tickets may be cheaper unless you add Hiroshima or more long-distance train legs.

**Timing**
Avoid Golden Week in late April/early May and the New Year travel window if you want easier bookings. March-April is beautiful but expensive. Late May, October, and November are usually the sweet spots.

I would book flights first, then hotels with free cancellation, then reserve one special ryokan night.`

const answerEvents = answerChunks(answer, 5850, 42, 34)

export const tripJapanScript: DemoScript = {
  id: 'trip-japan',
  trigger: 'Plan me a trip from Brazil to Japan',
  subtitle: 'Flights, route, cities, budget, and timing.',
  category: 'Travel',
  events: [
    { kind: 'user_message', text: 'Plan me a trip from Brazil to Japan', at: 0 },
    {
      kind: 'tool_start',
      tool: 'web_search',
      toolType: 'search',
      label: 'Searching flight routes and travel seasons',
      at: 420
    },
    { kind: 'tool_update', text: 'Checking GRU to Tokyo one-stop routes...', at: 1150 },
    { kind: 'tool_update', text: 'Comparing Haneda and Narita arrival options...', at: 2350 },
    { kind: 'tool_update', text: 'Reviewing seasonal hotel and transit patterns...', at: 3480 },
    { kind: 'tool_end', at: 4300 },
    {
      kind: 'thinking_chunk',
      text: '**Building itinerary outline**\nBalancing arrival fatigue, train transfers, and first-time Japan highlights.\n',
      at: 4550
    },
    {
      kind: 'thinking_chunk',
      text: '**Checking budget assumptions**\nUsing midrange hotels and current long-haul fare ranges.\n',
      at: 5120
    },
    ...answerEvents,
    doneAfter(answerEvents)
  ]
}
