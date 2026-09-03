export const QUESTIONNAIRE_CUSTOM_OPTION_VALUE = '__prism_custom_answer__'

export interface QuestionnaireOption {
  value: string
  label: string
  description?: string
  recommended?: boolean
  allow_custom_input?: boolean
}

export interface QuestionnaireQuestion {
  id: string
  type: 'multiple-choice' | 'multiple-select' | 'essay'
  title: string
  prompt: string
  options?: QuestionnaireOption[]
  placeholder?: string
  max_selections?: number
}

export type QuestionnaireAnswer = string | string[]

export function normalizeQuestionnaire(raw: unknown): QuestionnaireQuestion[] {
  let parsed = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(parsed)) return []

  return parsed
    .filter(
      (question): question is Record<string, unknown> =>
        Boolean(question && typeof question === 'object' && !Array.isArray(question))
    )
    .map((question, index) => {
      const type =
        question.type === 'multiple-select' || question.type === 'essay'
          ? question.type
          : 'multiple-choice'
      const base: QuestionnaireQuestion = {
        id: typeof question.id === 'string' && question.id ? question.id : `question-${index + 1}`,
        type,
        title: typeof question.title === 'string' ? question.title : 'Question',
        prompt: typeof question.prompt === 'string' ? question.prompt : '',
        placeholder: typeof question.placeholder === 'string' ? question.placeholder : undefined
      }
      if (type === 'essay') return base

      const sourceOptions = Array.isArray(question.options) ? question.options : []
      const options: QuestionnaireOption[] = sourceOptions
        .filter(
          (option): option is Record<string, unknown> =>
            Boolean(
              option &&
                typeof option === 'object' &&
                !Array.isArray(option) &&
                typeof option.value === 'string' &&
                typeof option.label === 'string' &&
                option.value !== QUESTIONNAIRE_CUSTOM_OPTION_VALUE
            )
        )
        .map((option) => ({
          value: option.value as string,
          label: option.label as string,
          description:
            typeof option.description === 'string' ? option.description.trim() : undefined,
          recommended: option.recommended === true,
          allow_custom_input: false
        }))
      options.push({
        value: QUESTIONNAIRE_CUSTOM_OPTION_VALUE,
        label: 'Write your own answer',
        description: 'Provide a different response in your own words.',
        allow_custom_input: true
      })

      const configuredMaximum = Number.isInteger(question.max_selections)
        ? Math.max(1, question.max_selections as number)
        : undefined
      return {
        ...base,
        options,
        max_selections:
          type === 'multiple-select' && configuredMaximum
            ? Math.min(configuredMaximum, options.length)
            : undefined
      }
    })
}

export function materializeQuestionnaireResponses(
  questions: QuestionnaireQuestion[],
  answers: Record<string, QuestionnaireAnswer>,
  customValues: Record<string, string>
): Record<string, QuestionnaireAnswer> {
  const responses: Record<string, QuestionnaireAnswer> = {}
  for (const question of questions) {
    const answer = answers[question.id]
    if (question.type === 'essay') {
      responses[question.id] = typeof answer === 'string' ? answer : ''
      continue
    }
    const values = Array.isArray(answer) ? answer : answer ? [answer] : []
    const labels = values.map((value) =>
      value === QUESTIONNAIRE_CUSTOM_OPTION_VALUE
        ? customValues[question.id] || ''
        : question.options?.find((option) => option.value === value)?.label || value
    )
    responses[question.id] = question.type === 'multiple-select' ? labels : labels[0] || ''
  }
  return responses
}
