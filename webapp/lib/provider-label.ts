import type { SessionUser } from './use-session'

/** Product-facing auth provider labels — never expose internal "dev". */
export function formatProviderLabel(provider: SessionUser['provider']): string {
  switch (provider) {
    case 'google':
      return 'Google'
    case 'discogs':
      return 'Discogs'
    case 'local':
      return 'Email'
    case 'dev':
      return 'Test account'
    default:
      return 'Email'
  }
}
