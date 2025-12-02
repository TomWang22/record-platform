/**
 * Discogs Price History Scraper
 * 
 * Scrapes price history from Discogs release pages using browser automation.
 * This is necessary because Discogs shows CAPTCHA when accessing price history,
 * and the API doesn't provide the full sales history arc.
 * 
 * The price history shows:
 * - Individual sale prices over time
 * - Complete sales arc (not just low/median/high)
 * - Date of each sale
 * - Condition of each sale
 * 
 * This data is critical for analytics and AI price prediction.
 */

import { Page } from 'puppeteer'
import { getBrowserPool } from '../../lib/browser-pool'
import type { CompletedSale } from '../base/adapter'

export interface DiscogsPriceHistoryEntry {
  date: Date
  price: number
  currency: string
  condition?: string
  mediaCondition?: string
  sleeveCondition?: string
  seller?: string
  notes?: string
}

export interface PriceHistoryOptions {
  releaseId: number
  waitForCaptcha?: boolean  // Wait for manual CAPTCHA solving (development)
  captchaTimeout?: number   // Timeout for CAPTCHA solving (ms)
  maxRetries?: number       // Max retries on CAPTCHA
}

/**
 * Scrape price history from Discogs release page
 * 
 * Navigates to: https://www.discogs.com/release/{releaseId}
 * Then clicks on "Price History" tab and extracts all sales data
 */
export async function scrapeDiscogsPriceHistory(
  options: PriceHistoryOptions
): Promise<DiscogsPriceHistoryEntry[]> {
  const {
    releaseId,
    waitForCaptcha = true,
    captchaTimeout = 120000, // 2 minutes
    maxRetries = 3,
  } = options

  const browserPool = getBrowserPool()
  const page = await browserPool.getPage()

  try {
    const url = `https://www.discogs.com/release/${releaseId}`
    console.log(`[DiscogsPriceHistory] Navigating to ${url}`)

    // Navigate to release page
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    })

    // Check for CAPTCHA
    const captchaDetected = await detectCaptcha(page)
    
    if (captchaDetected) {
      console.log('[DiscogsPriceHistory] CAPTCHA detected')
      
      if (waitForCaptcha) {
        console.log('[DiscogsPriceHistory] Waiting for manual CAPTCHA solve...')
        const solved = await waitForCaptchaSolve(page, captchaTimeout)
        
        if (!solved) {
          throw new Error('CAPTCHA not solved within timeout')
        }
      } else {
        // In production, use automated CAPTCHA solving service
        throw new Error('CAPTCHA detected but automated solving not implemented')
      }
    }

    // Navigate to price history tab
    console.log('[DiscogsPriceHistory] Clicking price history tab...')
    await clickPriceHistoryTab(page)

    // Wait for price history table to load
    await page.waitForSelector('.price_history, .price-history, [data-testid="price-history"]', {
      timeout: 10000,
    }).catch(() => {
      // Try alternative selectors
      return page.waitForSelector('table.price_history, .price_history_table', {
        timeout: 5000,
      })
    })

    // Extract price history data
    console.log('[DiscogsPriceHistory] Extracting price history data...')
    const priceHistory = await extractPriceHistory(page)

    console.log(`[DiscogsPriceHistory] Extracted ${priceHistory.length} price history entries`)
    return priceHistory

  } catch (error) {
    console.error(`[DiscogsPriceHistory] Error scraping price history for release ${releaseId}:`, error)
    throw error
  } finally {
    await browserPool.releasePage(page)
  }
}

/**
 * Detect if CAPTCHA is present on the page
 */
async function detectCaptcha(page: Page): Promise<boolean> {
  // Check for common CAPTCHA indicators
  const captchaSelectors = [
    'iframe[src*="captcha"]',
    'iframe[src*="recaptcha"]',
    'iframe[src*="hcaptcha"]',
    '.g-recaptcha',
    '#captcha',
    '[data-captcha]',
    'iframe[title*="CAPTCHA"]',
  ]

  for (const selector of captchaSelectors) {
    const element = await page.$(selector)
    if (element) {
      return true
    }
  }

  // Check for CAPTCHA text in page content
  const pageContent = await page.content()
  const captchaKeywords = ['captcha', 'verify you are human', 'robot', 'security check']
  const lowerContent = pageContent.toLowerCase()
  
  for (const keyword of captchaKeywords) {
    if (lowerContent.includes(keyword)) {
      // Check if it's actually a CAPTCHA (not just text)
      const hasIframe = await page.$('iframe') !== null
      if (hasIframe) {
        return true
      }
    }
  }

  return false
}

/**
 * Wait for CAPTCHA to be solved (manual solving in development)
 */
async function waitForCaptchaSolve(page: Page, timeout: number): Promise<boolean> {
  const startTime = Date.now()
  
  while (Date.now() - startTime < timeout) {
    const captchaPresent = await detectCaptcha(page)
    
    if (!captchaPresent) {
      console.log('[DiscogsPriceHistory] CAPTCHA solved!')
      return true
    }

    // Wait a bit before checking again
    await page.waitForTimeout(2000)
  }

  return false
}

/**
 * Click on the price history tab
 */
async function clickPriceHistoryTab(page: Page): Promise<void> {
  // Try various selectors for the price history tab/link
  const tabSelectors = [
    'a[href*="price-history"]',
    'a[href*="price_history"]',
    'button:has-text("Price History")',
    'a:has-text("Price History")',
    '.tab:has-text("Price History")',
    '[data-tab="price-history"]',
    'a[href="#price-history"]',
  ]

  for (const selector of tabSelectors) {
    try {
      const element = await page.$(selector)
      if (element) {
        await element.click()
        await page.waitForTimeout(1000) // Wait for tab to load
        return
      }
    } catch (error) {
      // Try next selector
      continue
    }
  }

  // If no tab found, try navigating directly to price history URL
  const currentUrl = page.url()
  const priceHistoryUrl = currentUrl.includes('?') 
    ? `${currentUrl}&price_history=1`
    : `${currentUrl}?price_history=1`
  
  await page.goto(priceHistoryUrl, { waitUntil: 'networkidle2', timeout: 10000 })
}

/**
 * Extract price history data from the page
 */
async function extractPriceHistory(page: Page): Promise<DiscogsPriceHistoryEntry[]> {
  // Extract data using page.evaluate
  const priceHistory = await page.evaluate((): Array<{
    date: string | null
    price: number
    currency: string
    condition?: string
    mediaCondition?: string
    sleeveCondition?: string
    seller?: string
    notes?: string
  }> => {
    const entries: Array<{
      date: string | null
      price: number
      currency: string
      condition?: string
      mediaCondition?: string
      sleeveCondition?: string
      seller?: string
      notes?: string
    }> = []
    
    // Try to find price history table
    const tables = document.querySelectorAll('table.price_history, .price_history table, table[data-testid="price-history"]')
    
    for (const table of Array.from(tables)) {
      const rows = table.querySelectorAll('tbody tr, tr')
      
      for (const row of Array.from(rows)) {
        const cells = row.querySelectorAll('td, th')
        
        if (cells.length < 2) continue
        
        // Extract date
        const dateText = cells[0]?.textContent?.trim() || ''
        const date = parseDate(dateText)
        
        // Extract price
        const priceText = cells[1]?.textContent?.trim() || ''
        const priceMatch = priceText.match(/[\d,]+\.?\d*/)
        const price = priceMatch ? parseFloat(priceMatch[0].replace(/,/g, '')) : 0
        
        // Extract currency
        const currencyMatch = priceText.match(/(USD|EUR|GBP|JPY|CAD|AUD)/i)
        const currency = currencyMatch ? currencyMatch[1].toUpperCase() : 'USD'
        
        // Extract condition (if available)
        const conditionText = cells[2]?.textContent?.trim() || ''
        const mediaCondition = extractCondition(conditionText, 'media')
        const sleeveCondition = extractCondition(conditionText, 'sleeve')
        
        // Extract seller (if available)
        const seller = cells[3]?.textContent?.trim() || undefined
        
        // Extract notes (if available)
        const notes = cells[4]?.textContent?.trim() || undefined
        
        if (date && price > 0) {
          entries.push({
            date: dateText, // Keep as string for now, parse later
            price,
            currency,
            condition: conditionText || undefined,
            mediaCondition,
            sleeveCondition,
            seller,
            notes,
          })
        }
      }
    }
    
    // Helper function to parse date
    function parseDate(dateText: string): Date | null {
      // Try various date formats
      const formats = [
        /(\d{4})-(\d{2})-(\d{2})/,  // YYYY-MM-DD
        /(\d{2})\/(\d{2})\/(\d{4})/,  // MM/DD/YYYY
        /(\d{2})-(\d{2})-(\d{4})/,   // MM-DD-YYYY
        /(\w+)\s+(\d{1,2}),\s+(\d{4})/, // Month DD, YYYY
      ]
      
      for (const format of formats) {
        const match = dateText.match(format)
        if (match) {
          try {
            return new Date(dateText)
          } catch (e) {
            // Try next format
          }
        }
      }
      
      // Fallback: try Date constructor
      try {
        const date = new Date(dateText)
        if (!isNaN(date.getTime())) {
          return date
        }
      } catch (e) {
        // Invalid date
      }
      
      return null
    }
    
    // Helper function to extract condition
    function extractCondition(text: string, type: 'media' | 'sleeve'): string | undefined {
      const upper = text.toUpperCase()
      
      if (type === 'media') {
        if (upper.includes('MINT') && !upper.includes('NEAR')) return 'Mint'
        if (upper.includes('NEAR MINT') || upper.includes('NM')) return 'Near Mint'
        if (upper.includes('VG+')) return 'Very Good Plus'
        if (upper.includes('VG')) return 'Very Good'
        if (upper.includes('G+')) return 'Good Plus'
        if (upper.includes('G')) return 'Good'
      }
      
      if (type === 'sleeve') {
        if (upper.includes('MINT') && !upper.includes('NEAR')) return 'Mint'
        if (upper.includes('NEAR MINT') || upper.includes('NM')) return 'Near Mint'
        if (upper.includes('VG+')) return 'Very Good Plus'
        if (upper.includes('VG')) return 'Very Good'
        if (upper.includes('G+')) return 'Good Plus'
        if (upper.includes('G')) return 'Good'
      }
      
      return undefined
    }
    
    return entries
  })

  // Parse dates and convert to DiscogsPriceHistoryEntry format
  return priceHistory.map(entry => {
    let date: Date | null = null
    
    // Try to parse date
    try {
      date = new Date(entry.date || '')
      if (isNaN(date.getTime())) {
        date = null
      }
    } catch (e) {
      date = null
    }
    
    // If date parsing failed, use current date as fallback
    if (!date) {
      date = new Date()
    }
    
    return {
      date,
      price: entry.price,
      currency: entry.currency,
      condition: entry.condition,
      mediaCondition: entry.mediaCondition,
      sleeveCondition: entry.sleeveCondition,
      seller: entry.seller,
      notes: entry.notes,
    }
  })
}

/**
 * Convert DiscogsPriceHistoryEntry to CompletedSale format
 */
export function convertToCompletedSales(
  entries: DiscogsPriceHistoryEntry[],
  releaseId: number,
  title?: string
): CompletedSale[] {
  return entries.map(entry => ({
    platform: 'discogs',
    externalId: String(releaseId),
    title: title || `Discogs Release ${releaseId}`,
    soldPrice: entry.price,
    currency: entry.currency,
    soldDate: entry.date,
    condition: entry.condition,
    url: `https://www.discogs.com/release/${releaseId}/history`,
    rawData: {
      mediaCondition: entry.mediaCondition,
      sleeveCondition: entry.sleeveCondition,
      seller: entry.seller,
      notes: entry.notes,
      date: entry.date,
      price: entry.price,
      currency: entry.currency,
    },
  }))
}

