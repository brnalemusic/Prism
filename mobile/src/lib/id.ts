let counter = 0

/** Short, sortable-enough id that stays readable inside storage keys. */
export function createId(prefix = 'id'): string {
  counter = (counter + 1) % 46656
  const time = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 7)
  const seq = counter.toString(36).padStart(3, '0')
  return `${prefix}_${time}${seq}${random}`
}
