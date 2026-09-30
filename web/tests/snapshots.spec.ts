import { test, expect } from '@playwright/test'

test('snapshot deletion confirms, preserves failures and omits unavailable storage size', async ({
  page,
}) => {
  let snapshots = [
    {
      snapshotID: 'saved-checkpoint',
      names: ['my-checkpoint'],
      cpuCount: 1,
      memoryMB: 2048,
      diskSizeMB: 8192,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    },
  ]
  let deletes = 0
  await page.route('**/dashboard/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      })
    if (path === '/dashboard/session') return json({ authenticated: true })
    if (path === '/dashboard/api/snapshots') return json(snapshots)
    if (
      path === '/dashboard/api/templates/saved-checkpoint' &&
      route.request().method() === 'DELETE'
    ) {
      if (++deletes === 1)
        return json({ message: 'Storage temporarily unavailable' }, 500)
      snapshots = []
      return route.fulfill({ status: 204 })
    }
    return json([])
  })
  await page.goto('/snapshots')
  const card = page.getByRole('article').filter({ hasText: 'my-checkpoint' })
  await expect(card).toBeVisible()
  await expect(card.locator('.snapshot-size')).toHaveCount(0)
  await expect(card).toContainText('2 GB')
  await card
    .getByRole('button', { name: 'Delete snapshot my-checkpoint', exact: true })
    .click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click()
  expect(deletes).toBe(0)
  await card
    .getByRole('button', { name: 'Delete snapshot my-checkpoint', exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Delete snapshot?' })
  await dialog
    .getByRole('button', { name: 'Delete snapshot', exact: true })
    .click()
  await expect(dialog.getByRole('alert')).toContainText(
    'Storage temporarily unavailable',
  )
  await expect(card).toBeVisible()
  await dialog
    .getByRole('button', { name: 'Delete snapshot', exact: true })
    .click()
  await expect(dialog).toHaveCount(0)
  await expect(card).toHaveCount(0)
  expect(deletes).toBe(2)
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'No matching snapshots' }),
  ).toBeVisible()
})

test('demo snapshot delete button fits a mobile card and removes the selected snapshot', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/snapshots?demo=1')
  const card = page.getByRole('article').first()
  const name = await card.getByRole('heading').textContent()
  await card.getByRole('button', { name: /^Delete snapshot / }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  )
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete snapshot', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: name!, exact: true }),
  ).toHaveCount(0)
})
