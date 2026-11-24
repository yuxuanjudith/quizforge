/**
 * Two browsers, one game: the host runs the built-in sample quiz and a
 * player answers. Proves the realtime loop end to end (actions → record
 * room → both screens) without an AI call, because the sample's answers
 * are fixed.
 *
 * Needs two test accounts — see tests/collab.spec.ts for how to create them.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

test.skip(loadAllTestAccounts().length < 2, 'Needs 2 test accounts (npx deepspace test accounts create …)')

test('host runs a sample game, player answers and scores', async ({ users }) => {
  test.setTimeout(120_000)
  const [host, player] = await users(2)

  // Host: sample quiz → review page → go live.
  await host.page.goto('/home')
  await host.page.getByRole('button', { name: 'Try a sample quiz first' }).click()
  await expect(host.page.getByText('What does DNS do')).toBeVisible({ timeout: 20_000 })
  await host.page.getByRole('button', { name: 'Host live game' }).click()

  const codeEl = host.page.getByLabel(/^Join code/)
  await expect(codeEl).toBeVisible({ timeout: 20_000 })
  const code = (await codeEl.textContent())!.trim()
  expect(code).toMatch(/^[A-Z0-9]{6}$/)

  // Player joins by code; host sees them appear live.
  await player.page.goto('/home')
  await player.page.getByLabel('Game code').fill(code)
  await player.page.getByRole('button', { name: 'Join' }).click()
  await expect(player.page.getByText(/You're in/)).toBeVisible({ timeout: 20_000 })
  await expect(host.page.getByText('1 joined')).toBeVisible({ timeout: 20_000 })

  // Question 1: answer B (correct). With one player, answering reveals immediately.
  await host.page.getByRole('button', { name: 'Start' }).click()
  await expect(player.page.getByText('What does DNS do')).toBeVisible({ timeout: 20_000 })
  await player.page.getByRole('button', { name: /^B:/ }).click()
  await expect(player.page.getByText('Correct', { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(host.page.getByRole('button', { name: /Next question/ })).toBeVisible()

  // The server scored it: base 500 + a speed bonus, so between 500 and 1000.
  const score = Number(await player.page.locator('header .font-display').first().textContent())
  expect(score).toBeGreaterThanOrEqual(500)
  expect(score).toBeLessThanOrEqual(1000)
})
