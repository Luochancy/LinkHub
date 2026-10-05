// Shared authentication state for the SPA.
//
// Previously App.vue fetched /api/auth/me inline while the router declared
// `meta: { auth: true }` on protected routes that nothing ever enforced.
// Centralising the request here lets the navigation guard await the same
// in-flight call instead of issuing a second round trip, and gives every view
// one place to read the session from.
import { computed, ref } from 'vue'

export interface SessionUser {
  id: number
  login: string
  avatar?: string
}

const user = ref<SessionUser | null>(null)
const admin = ref(false)

let inflight: Promise<void> | null = null
let loaded = false

export const currentUser = computed(() => user.value)
export const isAdminUser = computed(() => Boolean(user.value && admin.value))

/**
 * Resolves the current session, de-duplicating concurrent callers.
 *
 * A failed request is treated as "signed out" rather than rejecting, so a
 * flaky network cannot leave the UI stuck on a loading state. `loaded` is only
 * set on success, which lets a later navigation retry.
 */
export async function loadAuth (force = false): Promise<void> {
  if (loaded && !force) return
  if (inflight) return inflight

  inflight = (async () => {
    try {
      const res = await fetch('/api/auth/me', { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`auth/me responded ${res.status}`)
      const data = await res.json()
      user.value = data?.user ?? null
      admin.value = Boolean(data?.isAdmin)
      loaded = true
    } catch {
      user.value = null
      admin.value = false
    } finally {
      inflight = null
    }
  })()

  return inflight
}

/** Clears the session server-side and locally. Never throws. */
export async function logout (): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST' })
  } catch {
    // Even if the request fails the local session is dropped below.
  }
  user.value = null
  admin.value = false
  loaded = true
}

const REDIRECT_KEY = 'linkhub:redirect'

/**
 * Remembers where a signed-out visitor was heading before the login round trip.
 *
 * Stored in sessionStorage because the OAuth callback returns to a fixed URL
 * (`/`), so the destination cannot survive in a query parameter — and it should
 * not leak across tabs or outlive the browser session.
 */
export function rememberRedirect (fullPath: string): void {
  if (!fullPath || fullPath === '/' || fullPath.startsWith('/login')) return
  try {
    sessionStorage.setItem(REDIRECT_KEY, fullPath)
  } catch {
    // Private mode / storage disabled: the redirect is a convenience, not a need.
  }
}

/** Returns the remembered destination once, clearing it so a refresh won't re-fire. */
export function consumeRedirect (): string | null {
  try {
    const target = sessionStorage.getItem(REDIRECT_KEY)
    if (target) sessionStorage.removeItem(REDIRECT_KEY)
    return target
  } catch {
    return null
  }
}