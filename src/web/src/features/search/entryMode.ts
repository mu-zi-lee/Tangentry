export type SearchEntryMode = 'add' | 'search'

export function searchEntryMode(search: string): SearchEntryMode {
  const params = new URLSearchParams(search)
  const explicit = params.get('entry') ?? params.get('mode')
  if (explicit === 'add' || explicit === 'search') return explicit
  return params.has('q') || params.has('creator') ? 'search' : 'add'
}
