import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

const stamp = '2026-10-01T00:00:00Z'
const template = (id: string, status = 'ready') => ({
  templateID: id,
  buildID: `${id}-build`,
  names: [id],
  buildStatus: status,
  cpuCount: 4,
  memoryMB: 2048,
  diskSizeMB: 0,
  public: false,
  createdAt: stamp,
  updatedAt: stamp,
  lastSpawnedAt: null,
  spawnCount: 0,
  buildCount: 1,
  envdVersion: 'test',
})

async function backend(page: Page) {
  let templates = [template('python-ready'), template('failed-image', 'error')]
  const reservations: unknown[] = [],
    starts: unknown[] = [],
    launches: Record<string, unknown>[] = []
  const sandboxes: unknown[] = []
  let deleteAttempts = 0
  await page.route('**/dashboard/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url())
    const path = url.pathname.replace('/dashboard/api', '')
    const json = (body: unknown, status = 200, headers = {}) =>
      route.fulfill({
        status,
        headers,
        contentType: 'application/json',
        body: JSON.stringify(body),
      })
    if (path === '/dashboard/session') return json({ authenticated: true })
    if (path === '/v2/templates')
      return url.searchParams.has('nextToken')
        ? json(templates.slice(1))
        : json(
            templates.slice(0, 1),
            200,
            templates.length > 1 ? { 'X-Next-Token': 'next' } : {},
          )
    if (['/nodes', '/snapshots', '/volumes'].includes(path)) return json([])
    if (path === '/v2/sandboxes') {
      if (req.method() === 'GET') return json(sandboxes)
      const body = req.postDataJSON()
      launches.push(body)
      sandboxes.push({
        sandboxID: 'launched',
        templateID: body.templateID,
        metadata: body.metadata,
        state: 'running',
        cpuCount: 4,
        memoryMB: 2048,
        startedAt: stamp,
      })
      return json({ sandboxID: 'launched' }, 201)
    }
    if (path === '/v3/templates') {
      reservations.push(req.postDataJSON())
      templates.push(template('new-template', 'waiting'))
      return json(
        {
          templateID: 'new-template',
          buildID: 'new-template-build',
          names: ['new-template'],
          aliases: [],
          tags: [],
          public: false,
        },
        202,
      )
    }
    if (path === '/v2/templates/new-template/builds/new-template-build') {
      starts.push(req.postDataJSON())
      if (starts.length === 1)
        return json({ message: 'Registry temporarily unavailable' }, 503)
      templates[2].buildStatus = 'ready'
      return route.fulfill({ status: 202, body: '' })
    }
    if (path.match(/^\/templates\/[^/]+$/)) {
      const id = path.split('/')[2]
      if (req.method() === 'DELETE') {
        if (++deleteAttempts === 1)
          return json({ message: 'Template build is still in progress' }, 409)
        templates = templates.filter((t) => t.templateID !== id)
        return route.fulfill({ status: 204 })
      }
      const t = templates.find((t) => t.templateID === id)!
      return json(
        {
          ...t,
          builds: [
            {
              buildID: url.searchParams.has('nextToken')
                ? `${id}-old`
                : t.buildID,
              status: t.buildStatus,
              createdAt: stamp,
              updatedAt: stamp,
              cpuCount: 4,
              memoryMB: 2048,
            },
          ],
        },
        200,
        url.searchParams.has('nextToken')
          ? {}
          : { 'X-Next-Token': 'history-next' },
      )
    }
    if (path.endsWith('/status')) {
      const id = path.split('/')[2],
        offset = Number(url.searchParams.get('logsOffset'))
      const t = templates.find((t) => t.templateID === id)!
      return json({
        templateID: id,
        buildID: path.split('/')[4],
        status: t.buildStatus,
        logEntries: Array.from({ length: offset ? 1 : 100 }, (_, i) => ({
          timestamp: stamp,
          level: 'info',
          message: offset ? 'LAST_LOG_LINE' : `Import layer ${i}`,
          step: 'image',
        })),
        reason:
          t.buildStatus === 'error'
            ? { message: 'Image manifest not found', step: 'resolve' }
            : undefined,
      })
    }
    return json({ message: `Unexpected route ${path}` }, 404)
  })
  return { reservations, starts, launches }
}

test('template pagination, filters, build history, failure logs and inherited launch resources', async ({
  page,
}) => {
  const state = await backend(page)
  await page.goto('/templates')
  await expect(
    page.getByRole('heading', { name: 'Templates', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('row').filter({ hasText: 'failed-image' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Launch failed-image', exact: true }),
  ).toBeDisabled()
  await page.getByRole('button', { name: 'Ready', exact: true }).click()
  await expect(
    page.getByRole('row').filter({ hasText: 'failed-image' }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await page.getByLabel('Search templates').fill('failed-image')
  await page
    .getByRole('button', { name: 'Build details for failed-image' })
    .click()
  const detail = page.getByRole('dialog', { name: 'Template details' })
  await expect(detail.getByText('2 builds')).toBeVisible()
  await expect(detail.getByRole('alert')).toContainText(
    'Image manifest not found',
  )
  await expect(detail.getByRole('alert')).toContainText('resolve')
  await detail.getByRole('button', { name: 'Load more logs' }).click()
  await expect(detail.getByLabel('Build logs')).toContainText('LAST_LOG_LINE')
  await expect(
    detail.getByRole('button', { name: 'Launch sandbox' }),
  ).toBeDisabled()
  await detail.getByRole('button', { name: /failed-image-old/ }).click()
  await expect(
    detail.getByRole('button', { name: /failed-image-old/ }),
  ).toHaveAttribute('aria-pressed', 'true')
  await detail.getByRole('button', { name: 'Close dialog' }).click()
  await page.getByLabel('Search templates').fill('')
  await page
    .getByRole('button', { name: 'Launch python-ready', exact: true })
    .click()
  await expect(page.getByLabel('CPU', { exact: true })).toHaveValue('4')
  await expect(page.getByLabel('Memory', { exact: true })).toHaveValue('2048')
  await expect(page.getByLabel('CPU', { exact: true })).toBeDisabled()
  await page.getByLabel('Sandbox name').fill('from-template')
  await page
    .getByRole('button', { name: 'Create sandbox', exact: true })
    .click()
  await expect.poll(() => state.launches.length).toBe(1)
  expect(state.launches[0]).toMatchObject({
    templateID: 'python-ready',
    metadata: { name: 'from-template' },
    autoPause: true,
  })
  expect(state.launches[0]).not.toHaveProperty('cpuCount')
  expect(state.launches[0]).not.toHaveProperty('memoryMB')
  await expect(
    page.getByRole('row').filter({ hasText: 'from-template' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'New sandbox', exact: true }).click()
  await page.getByLabel('Starting point').selectOption('python-ready')
  await expect(page.getByLabel('Memory', { exact: true })).toHaveValue('2048')
  await page.getByLabel('Starting point').selectOption('')
  await expect(page.getByLabel('CPU', { exact: true })).toBeEnabled()
  await expect(page.getByLabel('CPU', { exact: true })).toHaveValue('2')
})

test('OCI creation retries the reservation, accepts empty 202 and preserves deletion conflicts', async ({
  page,
}) => {
  const state = await backend(page)
  await page.goto('/templates')
  await page.getByRole('button', { name: 'New template', exact: true }).click()
  await page.getByLabel('Template name', { exact: true }).fill('new-template')
  await page.getByLabel('OCI image', { exact: true }).fill('alpine:3.21')
  await page.getByLabel('Template CPU').selectOption('1')
  await page.getByLabel('Template memory').selectOption('512')
  await page
    .getByRole('button', { name: 'Create template', exact: true })
    .click()
  await expect(page.getByRole('alert')).toContainText(
    'Registry temporarily unavailable',
  )
  await expect(page.getByLabel('Template CPU')).toBeDisabled()
  await page.getByRole('button', { name: 'Retry build', exact: true }).click()
  await expect(
    page.getByRole('dialog', { name: 'Template details' }),
  ).toBeVisible()
  expect(state.reservations).toEqual([
    { name: 'new-template', cpuCount: 1, memoryMB: 512 },
  ])
  expect(state.starts).toEqual([
    { fromImage: 'alpine:3.21' },
    { fromImage: 'alpine:3.21' },
  ])
  await page
    .getByRole('button', { name: 'Delete template', exact: true })
    .click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete template', exact: true })
    .click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'still in progress',
  )
  await expect(
    page.getByRole('row').filter({ hasText: 'new-template' }),
  ).toHaveCount(1)
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete template', exact: true })
    .click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(
    page.getByRole('row').filter({ hasText: 'new-template' }),
  ).toHaveCount(0)
})

test('mobile template table scrolls without widening the page', async ({
  page,
}) => {
  await backend(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/templates')
  const launch = page.getByRole('button', {
    name: 'Launch python-ready',
    exact: true,
  })
  await expect(launch).toBeEnabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  )
  await launch.click()
  await expect(
    page.getByRole('dialog', { name: 'Launch from template' }),
  ).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  )
})
