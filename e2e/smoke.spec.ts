import { test, expect } from '@playwright/test'

test('front page shows the header, category tabs, and content', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Front Page')).toBeVisible()
  // Category tabs render the seeded categories with an Inbox tab
  await expect(page.getByRole('link', { name: /Inbox/ }).first()).toBeVisible()
})

test('inbox lists articles and opens the reader', async ({ page }) => {
  await page.goto('/inbox')
  const card = page.locator('a.article-card').first()
  await expect(card).toBeVisible()
  const cardTitle = (await card.locator('span').first().textContent())?.trim()
  await card.click()
  // The reader shows the article title as an h1
  const heading = page.locator('article h1')
  await expect(heading).toBeVisible()
  if (cardTitle) {
    await expect(heading).toContainText(cardTitle.slice(0, 20))
  }
})

test('bottom tab bar appears on mobile and opens the sidebar via Menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/inbox')
  const menuTab = page.locator('nav.fixed.bottom-0').getByRole('button', { name: 'Menu' })
  await expect(menuTab).toBeVisible()
  await menuTab.click()
  await expect(page.getByText('Oksskolten').first()).toBeVisible()
})
