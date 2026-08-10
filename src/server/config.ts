export type RuntimeEnv = Record<string, any> & {
  ASSETS?: { fetch(request: Request): Promise<Response> }
}

export function getEnv(name: string, runtime?: RuntimeEnv) {
  return runtime?.[name] ?? (typeof process !== 'undefined' ? process.env[name] : undefined)
}

export function requiredEnv(name: string, runtime?: RuntimeEnv) {
  const value = getEnv(name, runtime)
  if (!value) throw new Error(`Missing environment variable: ${name}`)
  return value
}

export function appUrl(runtime?: RuntimeEnv) {
  return getEnv('APP_URL', runtime) || 'http://localhost:3000'
}

export function adminIds(runtime?: RuntimeEnv) {
  return new Set((getEnv('ADMIN_GITHUB_IDS', runtime) || '').split(',').map((x: string) => x.trim()).filter(Boolean))
}

export function adminLogins(runtime?: RuntimeEnv) {
  return new Set((getEnv('ADMIN_GITHUB_LOGINS', runtime) || '').split(',').map((x: string) => x.trim().toLowerCase()).filter(Boolean))
}
