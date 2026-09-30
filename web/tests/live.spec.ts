import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

async function mockBackend(page: Page) {
  let authenticated = false
  let failCreate = false
  const bodies: Record<string, unknown>[] = []
  const sandboxes = [
    {
      sandboxID: 'real-one',
      metadata: { name: 'real-agent', 'dashboard.image': 'alpine:3.21' },
      templateID: 'cold',
      state: 'running',
      cpuCount: 1,
      memoryMB: 512,
      startedAt: '2026-10-01T00:00:00Z',
    },
    {
      sandboxID: 'real-two',
      metadata: { name: 'paused-agent' },
      templateID: 'cold',
      state: 'paused',
      cpuCount: 2,
      memoryMB: 1024,
      startedAt: '2026-10-01T00:00:00Z',
    },
  ]
  await page.route('**/dashboard/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname
    const json = (value: unknown, status = 200, headers = {}) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(value),
        headers,
      })
    if (path === '/dashboard/session') {
      if (request.method() === 'POST') {
        authenticated = request.postDataJSON().apiKey === 'test-key'
        return json({ authenticated }, authenticated ? 200 : 401)
      }
      if (request.method() === 'DELETE') {
        authenticated = false
        return route.fulfill({ status: 204 })
      }
      return json({ authenticated }, authenticated ? 200 : 401)
    }
    if (!authenticated) return json({ message: 'login required' }, 401)
    if (path.endsWith('/v2/sandboxes') && request.method() === 'GET') {
      return url.searchParams.has('nextToken')
        ? json(sandboxes.slice(1))
        : json(
            sandboxes.slice(0, 1),
            200,
            sandboxes.length > 1 ? { 'X-Next-Token': 'page-two' } : {},
          )
    }
    if (path.endsWith('/nodes'))
      return json([
        {
          id: 'test-node',
          metrics: { cpuCount: 8, memoryTotalBytes: 16 * 1024 ** 3 },
        },
      ])
    if (path.endsWith('/v2/templates')) return json([])
    if (path.endsWith('/snapshots')) return json([])
    if (path.endsWith('/volumes'))
      return json([
        {
          volumeID: 'vol-one',
          name: 'real-data',
          sizeMB: 1024,
          mode: 'exclusive',
          status: 'ready',
        },
      ])
    if (path.endsWith('/sandboxes-cold')) {
      const body = request.postDataJSON()
      bodies.push(body)
      if (failCreate)
        return json({ message: 'Insufficient memory on node' }, 409)
      sandboxes.push({
        sandboxID: 'created-one',
        metadata: body.metadata,
        templateID: 'cold',
        state: 'running',
        cpuCount: body.cpuCount,
        memoryMB: body.memoryMB,
        startedAt: new Date().toISOString(),
      })
      return json({ sandboxID: 'created-one' }, 201)
    }
    if (path.endsWith('/pause')) {
      sandboxes[0].state = 'paused'
      return route.fulfill({ status: 204 })
    }
    if (path.endsWith('/connect')) {
      sandboxes[0].state = 'running'
      return json({ sandboxID: 'real-one' }, 201)
    }
    return json({ message: 'unexpected test route' }, 404)
  })
  return {
    bodies,
    failCreate: () => {
      failCreate = true
    },
  }
}
async function signIn(page: Page) {
  await page.getByLabel('API key', { exact: true }).fill('test-key')
  await page.getByRole('button', { name: 'Open workspace' }).click()
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
}

test('live login, pagination, API mutation errors and deep links', async ({
  page,
}) => {
  const backend = await mockBackend(page)
  await page.goto('/sandboxes')
  await expect(
    page.getByRole('heading', { name: 'A space for your agents.' }),
  ).toBeVisible()
  await expect(
    page.getByText('research-agent', { exact: true }),
  ).not.toBeVisible()
  await signIn(page)
  await expect(
    page.getByRole('row').filter({ hasText: 'real-agent' }),
  ).toBeVisible()
  await expect(
    page.getByRole('row').filter({ hasText: 'paused-agent' }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Pause real-agent', exact: true })
    .click()
  await expect(
    page.getByRole('row').filter({ hasText: 'real-agent' }),
  ).toContainText('Paused')
  await page
    .getByRole('button', { name: 'Resume real-agent', exact: true })
    .click()
  await expect(
    page.getByRole('row').filter({ hasText: 'real-agent' }),
  ).toContainText('Running')
  await page.getByRole('button', { name: 'New sandbox', exact: true }).click()
  await page.getByLabel('Sandbox name').fill('live-created')
  await page
    .getByRole('button', { name: 'Create sandbox', exact: true })
    .click()
  await expect(
    page.getByRole('row').filter({ hasText: 'live-created' }),
  ).toBeVisible()
  expect(backend.bodies[0]).toMatchObject({
    secure: true,
    autoPause: true,
    timeout: 300,
    metadata: { name: 'live-created' },
  })
  backend.failCreate()
  await page.getByRole('button', { name: 'New sandbox', exact: true }).click()
  await page.getByLabel('Sandbox name').fill('must-not-appear')
  await page
    .getByRole('button', { name: 'Create sandbox', exact: true })
    .click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'Insufficient memory',
  )
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(
    page.getByRole('row').filter({ hasText: 'must-not-appear' }),
  ).not.toBeVisible()
  await page.getByRole('button', { name: 'Volumes', exact: true }).click()
  await expect(page).toHaveURL(/\/volumes$/)
  await expect(page.getByText('Usage unavailable')).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Volumes', exact: true }),
  ).toBeVisible()
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 })
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByLabel('API key', { exact: true })).toBeVisible()
})

test('real terminal renders WebSocket output and sends input and resize', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await mockBackend(page)
  const messages: { type: string; data?: string; cols?: number }[] = []
  let closed = false
  await page.routeWebSocket('**/dashboard/shell/**', (socket) => {
    socket.send(JSON.stringify({ type: 'ready' }))
    socket.send(Buffer.from('REAL_PTY_READY\r\n'))
    socket.onMessage((message) => {
      messages.push(JSON.parse(String(message)))
    })
    socket.onClose(() => {
      closed = true
    })
  })
  await page.goto('/')
  await signIn(page)
  await page
    .getByRole('button', { name: 'Open Web Shell for real-agent' })
    .click()
  const terminal = page.getByRole('dialog', { name: 'Web Shell' })
  await expect(terminal.getByRole('status')).toHaveText('Connected')
  await expect(terminal.locator('.xterm')).toBeVisible()
  await page.keyboard.type('echo hello')
  await page.keyboard.press('Enter')
  await expect
    .poll(() =>
      messages
        .filter((m) => m.type === 'input')
        .map((m) => m.data)
        .join(''),
    )
    .toContain('echo hello\r')
  await page.setViewportSize({ width: 900, height: 700 })
  await expect
    .poll(() => messages.filter((m) => m.type === 'resize').length)
    .toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await expect.poll(() => closed).toBe(true)
  expect(errors).toEqual([])
})
