export interface StarterPrompt {
  id: string
  title: string
  subtitle: string
  prompt: string
  category: 'Think' | 'Write' | 'Build' | 'Study'
  icon: string
}

export const STARTER_PROMPTS: StarterPrompt[] = [
  {
    id: 'explain-simply',
    title: 'Explain it simply',
    subtitle: 'One idea, plain language, no jargon',
    prompt:
      'Explain the following idea to me as if I have five minutes and no background in the field. Use one analogy, then three bullets with the essentials:\n\n',
    category: 'Think',
    icon: 'bulb-outline'
  },
  {
    id: 'decide',
    title: 'Weigh a decision',
    subtitle: 'Options, trade-offs, recommendation',
    prompt:
      'Help me decide between these options. List the trade-offs in a compact table-free format, call out the risk I am most likely to underestimate, and end with one clear recommendation:\n\n',
    category: 'Think',
    icon: 'git-compare-outline'
  },
  {
    id: 'draft-reply',
    title: 'Draft a reply',
    subtitle: 'Tone-controlled message you can paste',
    prompt:
      'Draft a short reply to the message below. Keep it warm, direct and under 120 words. Offer one alternative version that is more formal.\n\nMessage:\n',
    category: 'Write',
    icon: 'mail-outline'
  },
  {
    id: 'tighten',
    title: 'Tighten my writing',
    subtitle: 'Cut filler, keep the voice',
    prompt:
      'Edit the text below for clarity and rhythm. Keep my voice, remove filler, and do not add new claims. Show the edited version first, then a one-line summary of what you changed.\n\n',
    category: 'Write',
    icon: 'create-outline'
  },
  {
    id: 'debug',
    title: 'Debug this snippet',
    subtitle: 'Find the bug and prove the fix',
    prompt:
      'Find the bug in this code. Explain the root cause in two sentences, give the smallest working fix, and mention one test that would have caught it.\n\n```\n\n```',
    category: 'Build',
    icon: 'bug-outline'
  },
  {
    id: 'ship-plan',
    title: 'Plan a small build',
    subtitle: 'A milestone you can finish this week',
    prompt:
      'I want to build the following. Give me a plan of at most five steps, each completable in an evening, with the riskiest unknown first and a definition of done per step:\n\n',
    category: 'Build',
    icon: 'construct-outline'
  },
  {
    id: 'study-drill',
    title: 'Quiz me',
    subtitle: 'Active recall with answers hidden',
    prompt:
      'Quiz me on this topic with five questions of increasing difficulty. Ask all five first, wait for my answers, then grade them and explain the gaps:\n\n',
    category: 'Study',
    icon: 'school-outline'
  },
  {
    id: 'translate',
    title: 'Translate naturally',
    subtitle: 'Meaning first, literal second',
    prompt:
      'Translate the text below. Prioritise natural phrasing over literal wording, keep names and technical terms intact, and note anything that does not translate cleanly.\n\n',
    category: 'Study',
    icon: 'language-outline'
  }
]

export const PROMPT_CATEGORIES: StarterPrompt['category'][] = ['Think', 'Write', 'Build', 'Study']
