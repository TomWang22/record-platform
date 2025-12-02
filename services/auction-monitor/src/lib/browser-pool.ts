// Browser pool management for Puppeteer scraping
// Manages a pool of browser instances to avoid creating new browsers for each request

import puppeteer, { Browser, Page } from 'puppeteer'

export interface BrowserPoolConfig {
  maxBrowsers?: number
  maxPagesPerBrowser?: number
  headless?: boolean
  timeout?: number
  userAgent?: string
}

export class BrowserPool {
  private browsers: Browser[] = []
  private config: Required<BrowserPoolConfig>
  private pageCounts: Map<Browser, number> = new Map()
  
  constructor(config: BrowserPoolConfig = {}) {
    this.config = {
      maxBrowsers: config.maxBrowsers || 3,
      maxPagesPerBrowser: config.maxPagesPerBrowser || 5,
      headless: config.headless !== false,
      timeout: config.timeout || 30000,
      userAgent: config.userAgent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }
  }
  
  async getPage(): Promise<Page> {
    // Find a browser with available pages
    for (const browser of this.browsers) {
      const count = this.pageCounts.get(browser) || 0
      if (count < this.config.maxPagesPerBrowser) {
        try {
          const page = await browser.newPage()
          await page.setUserAgent(this.config.userAgent)
          await page.setViewport({ width: 1920, height: 1080 })
          this.pageCounts.set(browser, count + 1)
          return page
        } catch (error) {
          console.error('[BrowserPool] Error creating page:', error)
          // Browser might be closed, remove it
          await this.removeBrowser(browser)
        }
      }
    }
    
    // Create new browser if we haven't reached max
    if (this.browsers.length < this.config.maxBrowsers) {
      const browser = await this.createBrowser()
      const page = await browser.newPage()
      await page.setUserAgent(this.config.userAgent)
      await page.setViewport({ width: 1920, height: 1080 })
      this.pageCounts.set(browser, 1)
      return page
    }
    
    // Wait for a page to become available
    return this.waitForAvailablePage()
  }
  
  async releasePage(page: Page): Promise<void> {
    try {
      const browser = page.browser()
      const count = this.pageCounts.get(browser) || 0
      
      if (!page.isClosed()) {
        await page.close()
      }
      
      if (count > 0) {
        this.pageCounts.set(browser, count - 1)
      }
    } catch (error) {
      console.error('[BrowserPool] Error releasing page:', error)
    }
  }
  
  private async createBrowser(): Promise<Browser> {
    const browser = await puppeteer.launch({
      headless: this.config.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
      ],
    })
    
    this.browsers.push(browser)
    
    // Handle browser disconnection
    browser.on('disconnected', () => {
      this.removeBrowser(browser).catch(console.error)
    })
    
    return browser
  }
  
  private async removeBrowser(browser: Browser): Promise<void> {
    const index = this.browsers.indexOf(browser)
    if (index > -1) {
      this.browsers.splice(index, 1)
      this.pageCounts.delete(browser)
    }
    
    try {
      if (browser.isConnected()) {
        await browser.close()
      }
    } catch (error) {
      console.error('[BrowserPool] Error closing browser:', error)
    }
  }
  
  private async waitForAvailablePage(): Promise<Page> {
    // Poll for available page (simple implementation)
    // In production, use a queue or event-based system
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      for (const browser of this.browsers) {
        const count = this.pageCounts.get(browser) || 0
        if (count < this.config.maxPagesPerBrowser) {
          try {
            const page = await browser.newPage()
            await page.setUserAgent(this.config.userAgent)
            await page.setViewport({ width: 1920, height: 1080 })
            this.pageCounts.set(browser, count + 1)
            return page
          } catch (error) {
            console.error('[BrowserPool] Error creating page in wait:', error)
          }
        }
      }
    }
    
    throw new Error('Browser pool exhausted, no pages available')
  }
  
  async close(): Promise<void> {
    await Promise.all(
      this.browsers.map(browser => this.removeBrowser(browser))
    )
  }
  
  async cleanup(): Promise<void> {
    // Close all browsers and clear state
    await this.close()
    this.browsers = []
    this.pageCounts.clear()
  }
}

// Singleton instance
let browserPoolInstance: BrowserPool | null = null

export function getBrowserPool(config?: BrowserPoolConfig): BrowserPool {
  if (!browserPoolInstance) {
    browserPoolInstance = new BrowserPool(config)
  }
  return browserPoolInstance
}

