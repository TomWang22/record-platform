import { expect, type Page } from '@playwright/test'

/** Wait until listing compose has a resolved seller/recipient, then fill and send. */
export async function fillComposeAndSend(page: Page, body: string): Promise<void> {
  await expect(page.getByTestId('messages-compose-ready')).toBeAttached({ timeout: 45_000 })
  const field = page.getByTestId('messages-compose-body')
  await field.click()
  await field.fill(body)
  const send = page.getByTestId('messages-compose-send')
  await expect(send).toBeEnabled({ timeout: 15_000 })
  const sendRes = page.waitForResponse(
    (res) =>
      res.request().method() === 'POST' &&
      (res.url().includes('/api/messages/send') || res.url().includes('/api/messages/start')) &&
      res.status() < 400,
    { timeout: 60_000 },
  )
  await send.click()
  await sendRes
}
