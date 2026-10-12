import { expect, test } from '@playwright/test'

test.skip(!!process.env['SKIP_E2E'], 'E2E disabled (SKIP_E2E is set)')

test('signed-out visitors land on sign in', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled()
})

test('register page links back to sign in', async ({ page }) => {
  await page.goto('/register')
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
  await page.getByRole('link', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/login/)
})
