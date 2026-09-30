import { test, expect } from '@playwright/test'

test('sandbox lifecycle, snapshots and deletion stay within the prototype', async ({
  page,
}) => {
  const remoteRequests: string[] = []
  page.on('request', (request) => {
    if (!new URL(request.url()).hostname.match(/^(localhost|127\.0\.0\.1)$/))
      remoteRequests.push(request.url())
  })
  await page.goto('/?demo=1')
  await page.waitForLoadState('networkidle')
  await expect(
    page.getByRole('heading', { name: 'A little room for big ideas.' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'New sandbox', exact: true }).click()
  await page.getByLabel('Sandbox name').fill('test-workspace')
  await page
    .getByRole('button', { name: 'Create sandbox', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Sandboxes', exact: true }),
  ).toBeVisible()
  const row = page.getByRole('row').filter({ hasText: 'test-workspace' })
  await expect(row).toContainText('Running')
  await row.getByRole('button', { name: 'Pause test-workspace' }).click()
  await expect(row).toContainText('Paused')
  await page
    .getByRole('button', { name: 'Paused', exact: false })
    .filter({ hasText: 'Paused' })
    .first()
    .click()
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Resume test-workspace' }).click()
  await expect(row).not.toBeVisible()
  await page.getByRole('button', { name: 'All sandboxes' }).click()
  await row.getByRole('button', { name: 'Details for test-workspace' }).click()
  await page.getByRole('button', { name: 'Save snapshot' }).click()
  await expect(page.getByRole('status')).toContainText('Demo snapshot created')
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await page.getByRole('button', { name: 'Snapshots', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'test-workspace-snapshot' }),
  ).toBeVisible()
  await page.getByRole('button', { name: /^Sandboxes/ }).click()
  await row.getByRole('button', { name: 'Details for test-workspace' }).click()
  await page
    .getByRole('button', { name: 'Delete sandbox', exact: true })
    .click()
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Details for test-workspace' }).click()
  await page
    .getByRole('button', { name: 'Delete sandbox', exact: true })
    .click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete sandbox', exact: true })
    .click()
  await expect(row).not.toBeVisible()
  expect(remoteRequests).toEqual([])
})

test('search, focus restoration, snapshot launch and reset', async ({
  page,
}) => {
  await page.goto('/?demo=1')
  await page.waitForLoadState('networkidle')
  await page.keyboard.press('Control+k')
  await page
    .getByRole('textbox', { name: 'Search workspace' })
    .fill('research-agent')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /research-agent/ })
    .click()
  await expect(page.getByRole('dialog')).toContainText('Research & analysis')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByRole('button', { name: 'Snapshots', exact: true }).click()
  await page
    .getByRole('article')
    .filter({ hasText: 'browser-base' })
    .getByRole('button', { name: 'Launch sandbox' })
    .click()
  await expect(page.getByLabel('Base image')).toHaveValue('ubuntu:24.04')
  await expect(page.getByLabel('Base image')).toBeDisabled()
  await page.getByLabel('Sandbox name').fill('from-snapshot')
  await page
    .getByRole('button', { name: 'Create sandbox', exact: true })
    .click()
  await expect(
    page.getByRole('row').filter({ hasText: 'from-snapshot' }),
  ).toContainText('2 GB')
  await page
    .getByRole('textbox', { name: 'Search sandboxes' })
    .fill('no-such-workspace')
  await expect(
    page.getByRole('heading', { name: 'No sandboxes found' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Dark', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveCSS(
    'background-color',
    'rgb(28, 30, 35)',
  )
  await page.getByRole('button', { name: 'Reset demo', exact: true }).click()
  await page
    .getByRole('button', { name: 'Reset sample data', exact: true })
    .click()
  await page.getByRole('button', { name: /^Sandboxes/ }).click()
  await expect(
    page.getByRole('row').filter({ hasText: 'from-snapshot' }),
  ).not.toBeVisible()
})

test('mobile navigation and dialogs fit the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?demo=1')
  await page.waitForLoadState('networkidle')
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('button', { name: 'Volumes', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Volumes', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: /research-datasets/ }).click()
  await expect(
    page.getByRole('dialog', { name: 'Volume details' }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.getByRole('button', { name: 'New sandbox', exact: true }).click()
  await expect(page.getByLabel('Sandbox name')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('button', { name: 'New sandbox', exact: true }),
  ).toBeFocused()
})

test('Web Shell entry points, simulated commands, history and paused gating', async ({
  page,
}) => {
  await page.goto('/?demo=1')
  await page.waitForLoadState('networkidle')
  await expect(
    page.getByRole('button', { name: 'Open Web Shell for evaluation-runner' }),
  ).toBeDisabled()
  await page
    .getByRole('button', { name: 'Open Web Shell for research-agent' })
    .click()
  const command = page.getByRole('textbox', { name: 'Terminal command' })
  const output = page.getByRole('log', { name: 'Terminal output' })
  await expect(command).toBeFocused()
  await command.fill('pwd')
  await command.press('Enter')
  await expect(output).toContainText('/workspace')
  await command.fill('echo hello from demo')
  await command.press('Enter')
  await expect(output).toContainText('hello from demo')
  await command.press('ArrowUp')
  await expect(command).toHaveValue('echo hello from demo')
  await command.press('Control+c')
  await expect(command).toHaveValue('')
  await command.fill('curl https://example.com')
  await command.press('Enter')
  await expect(output).toContainText('unsupported command')
  await command.press('Control+l')
  await expect(output).toHaveText('')
  await command.fill('exit')
  await command.press('Enter')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByRole('button', { name: 'Details for research-agent' }).click()
  await page
    .getByRole('button', { name: 'Open Web Shell', exact: true })
    .click()
  await expect(page.getByRole('dialog', { name: 'Web Shell' })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
})
