import type { components } from './schema'

export type APISandbox = components['schemas']['ListedSandbox']
export type APISnapshot = components['schemas']['SnapshotInfo']
export type APIVolume = components['schemas']['Volume']
export type APITemplate = components['schemas']['Template']
export type APITemplateBuild = components['schemas']['TemplateBuild']
export type APITemplateBuildInfo = components['schemas']['TemplateBuildInfo']
export type TemplateReservation =
  components['schemas']['TemplateRequestResponseV3']
export type APINode = components['schemas']['Node']
export type NewColdSandbox = components['schemas']['NewColdSandbox']
export type NewSandbox = components['schemas']['NewSandboxV2']

export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...init.headers },
  })
  if (!response.ok) {
    const body = await response.text()
    let message = body
    try {
      const error = JSON.parse(body)
      message = error.message || error.error || body
    } catch {
      /* Plain HTTP errors are also supported. */
    }
    throw new APIError(
      typeof message === 'string'
        ? message.slice(0, 500)
        : `Request failed (${response.status})`,
      response.status,
    )
  }
  if (response.status === 204) return undefined as T
  const body = await response.text()
  return (body ? JSON.parse(body) : undefined) as T
}

async function listAll<T>(
  path: string,
  signal: AbortSignal,
  field?: 'builds',
): Promise<T[]> {
  const items: T[] = []
  const seen = new Set<string>()
  let token = ''
  do {
    const params = new URLSearchParams({ limit: '100' })
    if (token) params.set('nextToken', token)
    const response = await fetch(`/dashboard/api${path}?${params}`, {
      credentials: 'same-origin',
      signal,
    })
    if (!response.ok)
      throw new APIError(`${path}: ${await response.text()}`, response.status)
    const body = await response.json()
    const page: T[] = field ? body[field] : body
    if (!Array.isArray(page)) throw new Error(`${path}: invalid list response`)
    items.push(...page)
    token = response.headers.get('X-Next-Token') || ''
    if (token && seen.has(token))
      throw new Error(`${path}: repeated pagination cursor`)
    seen.add(token)
  } while (token)
  return items
}

export function loadWorkspace(signal: AbortSignal) {
  return Promise.all([
    listAll<APISandbox>('/v2/sandboxes', signal),
    listAll<APISnapshot>('/snapshots', signal),
    listAll<APIVolume>('/volumes', signal),
    listAll<APITemplate>('/v2/templates', signal),
    request<APINode[]>('/dashboard/api/nodes', { signal }),
  ]).then(([sandboxes, snapshots, volumes, templates, nodes]) => ({
    sandboxes,
    snapshots,
    volumes,
    templates,
    nodes,
  }))
}

export const api = {
  reserveTemplate: (body: components['schemas']['TemplateBuildRequestV3']) =>
    request<TemplateReservation>('/dashboard/api/v3/templates', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  startTemplateBuild: (templateID: string, buildID: string, image: string) =>
    request<void>(
      `/dashboard/api/v2/templates/${encodeURIComponent(templateID)}/builds/${encodeURIComponent(buildID)}`,
      {
        method: 'POST',
        body: JSON.stringify({ fromImage: image }),
      },
    ),
  templateBuilds: (id: string, signal: AbortSignal) =>
    listAll<APITemplateBuild>(
      `/templates/${encodeURIComponent(id)}`,
      signal,
      'builds',
    ),
  templateBuild: (
    id: string,
    buildID: string,
    offset: number,
    signal: AbortSignal,
  ) =>
    request<APITemplateBuildInfo>(
      `/dashboard/api/templates/${encodeURIComponent(id)}/builds/${encodeURIComponent(buildID)}/status?logsOffset=${offset}&limit=100`,
      { signal },
    ),
  deleteTemplate: (id: string) =>
    request<void>(`/dashboard/api/templates/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  // AgentENV's template deletion endpoint also deletes sandbox snapshots.
  deleteSnapshot: (id: string) =>
    request<void>(`/dashboard/api/templates/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  session: (signal?: AbortSignal) =>
    request<{ authenticated: boolean; expiresAt: string }>(
      '/dashboard/session',
      { signal },
    ),
  login: (apiKey: string) =>
    request('/dashboard/session', {
      method: 'POST',
      body: JSON.stringify({ apiKey }),
    }),
  logout: () => request('/dashboard/session', { method: 'DELETE' }),
  create: (body: NewColdSandbox) =>
    request('/dashboard/api/sandboxes-cold', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  launch: (body: NewSandbox) =>
    request('/dashboard/api/v2/sandboxes', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  pause: (id: string) =>
    request(`/dashboard/api/sandboxes/${encodeURIComponent(id)}/pause`, {
      method: 'POST',
      body: '{}',
    }),
  resume: (id: string) =>
    request(`/dashboard/api/v2/sandboxes/${encodeURIComponent(id)}/connect`, {
      method: 'POST',
      body: JSON.stringify({ timeout: 300 }),
    }),
  remove: (id: string) =>
    request(`/dashboard/api/sandboxes/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  capture: (id: string, name: string) =>
    request(`/dashboard/api/sandboxes/${encodeURIComponent(id)}/snapshots`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
}
