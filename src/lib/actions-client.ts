/**
 * Browser side of the server actions in src/actions. Every game mutation goes
 * through here; the browser never writes games/players/responses itself
 * (their schemas forbid it).
 */

import { getAuthToken } from 'deepspace'

export class ActionError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message)
  }
}

export async function callAction<T = Record<string, unknown>>(
  name: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const token = await getAuthToken()
  const res = await fetch(`/api/actions/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(params),
  })
  if (res.status === 401) throw new ActionError('Sign in to continue.', 'unauthorized')
  const body = (await res.json().catch(() => null)) as
    | { success: true; data: T }
    | { success: false; error: string; code?: string }
    | null
  if (!body) throw new ActionError(`Server error (${res.status}).`)
  if (!body.success) throw new ActionError(body.error, body.code)
  return body.data
}
