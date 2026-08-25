export function harnessWildcardRegex(query: string): RegExp {
  let pattern = ''
  for (let index = 0; index < query.length; index += 1) {
    const character = query[index]
    if (character === '*' && query[index + 1] === '*') {
      if (query[index + 2] === '/') {
        pattern += '(?:.*/)?'
        index += 2
      } else {
        pattern += '.*'
        index += 1
      }
    } else if (character === '*') {
      pattern += '[^/]*'
    } else {
      pattern += character.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${pattern}$`, 'i')
}
