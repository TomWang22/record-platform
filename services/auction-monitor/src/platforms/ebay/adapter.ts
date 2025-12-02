// eBay API Adapter
// Uses eBay Finding API and Browse API

import axios, { AxiosInstance } from 'axios'
import { BaseAdapter, type RawListing, type SearchCriteria, type CompletedSale } from '../base/adapter'

interface eBayConfig {
  appId: string
  certId?: string
  devId?: string
  authToken?: string
  sandbox?: boolean
}

interface eBayFindingResponse {
  findItemsAdvancedResponse?: Array<{
    searchResult?: Array<{
      item?: Array<{
        itemId: string[]
        title: string[]
        globalId: string[]
        primaryCategory?: Array<{ categoryId: string[]; categoryName: string[] }>
        galleryURL?: string[]
        viewItemURL: string[]
        location: string[]
        country: string[]
        shippingInfo?: Array<{
          shippingServiceCost?: Array<{ '@currencyId': string[]; __value__: string[] }>
          shippingType: string[]
          shipToLocations: string[]
        }>
        sellingStatus?: Array<{
          currentPrice: Array<{ '@currencyId': string[]; __value__: string[] }>
          bidCount?: string[]
          timeLeft: string[]
          listingStatus: string[]
        }>
        listingInfo?: Array<{
          listingType: string[]
          gift: string[]
          watchCount?: string[]
        }>
        condition?: Array<{
          conditionId: string[]
          conditionDisplayName: string[]
        }>
        sellerInfo?: Array<{
          sellerUserName: string[]
          feedbackScore: string[]
          positiveFeedbackPercent: string[]
        }>
      }>
    }>
    paginationOutput?: Array<{
      totalPages: string[]
      totalEntries: string[]
    }>
  }>
}

export class eBayAdapter extends BaseAdapter {
  readonly platform = 'ebay'
  private client: AxiosInstance
  private config: eBayConfig
  private baseUrl: string
  
  constructor(config: eBayConfig) {
    super()
    this.config = config
    // Use Buy API base URL (modern API with Bearer token support)
    this.baseUrl = config.sandbox
      ? 'https://api.sandbox.ebay.com'
      : 'https://api.ebay.com'
    
    // Create client with Bearer token authentication for Buy API
    if (!config.authToken) {
      throw new Error('eBay authToken is required for Buy API')
    }
    
    // eBay User Tokens (v^1.1# format) may need URL encoding
    // Try both encoded and unencoded versions
    const encodedToken = encodeURIComponent(config.authToken)
    
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'Authorization': `Bearer ${config.authToken}`, // Try unencoded first
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'Content-Type': 'application/json',
      }
    })
    
    // Add request interceptor to try encoded token if unencoded fails
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 401 && error.config && !error.config._retry) {
          error.config._retry = true
          error.config.headers['Authorization'] = `Bearer ${encodedToken}`
          return this.client.request(error.config)
        }
        return Promise.reject(error)
      }
    )
  }
  
  async search(criteria: SearchCriteria): Promise<RawListing[]> {
    try {
      if (!this.config.authToken) {
        throw new Error('eBay auth token is required for Buy API')
      }

      // Use Buy API item_summary/search endpoint
      const params = new URLSearchParams({
        'q': criteria.query,
        'limit': String(criteria.limit || 50),
        'offset': String(criteria.offset || 0),
      })
      
      if (criteria.priceRange?.min) {
        params.append('filter', `price:[${criteria.priceRange.min}..]`)
      }
      
      if (criteria.priceRange?.max) {
        params.append('filter', `price:[..${criteria.priceRange.max}]`)
      }
      
      const response = await this.client.get('/buy/browse/v1/item_summary/search', {
        params,
      })
      
      const items = response.data.itemSummaries || []
      
      // Map Buy API response to RawListing format
      return items.map((item: any) => this.mapBuyApiToRawListing(item))
    } catch (error: any) {
      // If Buy API fails with 401 (invalid token), fall back to Finding API
      if (error.response?.status === 401) {
        console.warn('[eBay] Buy API authentication failed, falling back to Finding API')
        return this.searchWithFindingAPI(criteria)
      }
      // Log full error details for debugging
      if (error.response) {
        console.error(`[eBay] Search error response:`, error.response.status, error.response.data)
      }
      console.error(`[eBay] Search error:`, error.message)
      throw new Error(`eBay search failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async searchWithFindingAPI(criteria: SearchCriteria): Promise<RawListing[]> {
    // Fallback to Finding API (uses App ID in URL params, no Bearer token needed)
    const findingBaseUrl = this.config.sandbox
      ? 'https://svcs.sandbox.ebay.com'
      : 'https://svcs.ebay.com'
    
    const params = new URLSearchParams({
      'OPERATION-NAME': 'findItemsAdvanced',
      'SERVICE-VERSION': '1.0.0',
      'SECURITY-APPNAME': this.config.appId,
      'RESPONSE-DATA-FORMAT': 'JSON',
      'REST-PAYLOAD': '',
      'keywords': criteria.query,
      'paginationInput.entriesPerPage': String(criteria.limit || 50),
      'paginationInput.pageNumber': String(Math.floor((criteria.offset || 0) / (criteria.limit || 50)) + 1),
    })
    
    if (criteria.priceRange?.min) {
      params.append('itemFilter(0).name', 'MinPrice')
      params.append('itemFilter(0).value', String(criteria.priceRange.min))
    }
    
    if (criteria.priceRange?.max) {
      params.append('itemFilter(1).name', 'MaxPrice')
      params.append('itemFilter(1).value', String(criteria.priceRange.max))
    }
    
    const response = await axios.get<eBayFindingResponse>(
      `${findingBaseUrl}/services/search/FindingService/v1?${params.toString()}`,
      { timeout: 30000 }
    )
    
    const items = response.data.findItemsAdvancedResponse?.[0]?.searchResult?.[0]?.item || []
    
    return Promise.all(
      items.map(async (item) => {
        const itemId = item.itemId?.[0] || ''
        const details = await this.getDetails(itemId)
        return details || this.mapToRawListing(item)
      })
    )
  }
  
  async getDetails(externalId: string): Promise<RawListing | null> {
    try {
      // Use Browse API for detailed information
      const browseUrl = this.config.sandbox
        ? 'https://api.sandbox.ebay.com/buy/browse/v1'
        : 'https://api.ebay.com/buy/browse/v1'
      
      const response = await axios.get(`${browseUrl}/item/v1/${externalId}`, {
        headers: {
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
          'Authorization': `Bearer ${this.config.authToken || ''}`,
        },
        timeout: 30000,
      })
      
      return this.mapBrowseToRawListing(response.data)
    } catch (error) {
      console.error(`[eBay] Get details error:`, error)
      // Fallback to Finding API data if Browse API fails
      return null
    }
  }
  
  async getCompletedSales(criteria: SearchCriteria): Promise<CompletedSale[]> {
    try {
      const params = new URLSearchParams({
        'OPERATION-NAME': 'findCompletedItems',
        'SERVICE-VERSION': '1.0.0',
        'SECURITY-APPNAME': this.config.appId,
        'RESPONSE-DATA-FORMAT': 'JSON',
        'REST-PAYLOAD': '',
        'keywords': criteria.query,
        'paginationInput.entriesPerPage': String(criteria.limit || 50),
      })
      
      const response = await this.client.get<eBayFindingResponse>(`/services/search/FindingService/v1?${params.toString()}`)
      
      const items = response.data.findItemsAdvancedResponse?.[0]?.searchResult?.[0]?.item || []
      
      return items
        .filter(item => item.sellingStatus?.[0]?.listingStatus?.[0] === 'EndedWithSales')
        .map(item => ({
          platform: this.platform,
          externalId: item.itemId?.[0] || '',
          title: item.title?.[0] || '',
          soldPrice: parseFloat(item.sellingStatus?.[0]?.currentPrice?.[0]?.__value__?.[0] || '0'),
          currency: item.sellingStatus?.[0]?.currentPrice?.[0]?.['@currencyId']?.[0] || 'USD',
          soldDate: new Date(), // eBay Finding API doesn't provide sold date
          condition: item.condition?.[0]?.conditionDisplayName?.[0],
          url: item.viewItemURL?.[0],
          rawData: item as unknown as Record<string, unknown>,
        }))
    } catch (error) {
      console.error(`[eBay] Get completed sales error:`, error)
      throw new Error(`eBay completed sales failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  
  private mapToRawListing(item: any): RawListing {
    const itemId = item?.itemId?.[0] || ''
    const title = item?.title?.[0] || ''
    const price = parseFloat(item?.sellingStatus?.[0]?.currentPrice?.[0]?.__value__?.[0] || '0')
    const currency = item?.sellingStatus?.[0]?.currentPrice?.[0]?.['@currencyId']?.[0] || 'USD'
    
    return {
      platform: this.platform,
      externalId: itemId,
      url: item?.viewItemURL?.[0] || '',
      title,
      price,
      currency,
      condition: item?.condition?.[0]?.conditionDisplayName?.[0],
      sellerName: item?.sellerInfo?.[0]?.sellerUserName?.[0],
      sellerFeedbackScore: parseInt(item?.sellerInfo?.[0]?.feedbackScore?.[0] || '0', 10),
      sellerLocation: item?.location?.[0],
      listingType: item?.listingInfo?.[0]?.listingType?.[0] === 'Auction' ? 'auction' : 'buy_it_now',
      bidCount: parseInt(item?.sellingStatus?.[0]?.bidCount?.[0] || '0', 10),
      watcherCount: parseInt(item?.listingInfo?.[0]?.watchCount?.[0] || '0', 10),
      timeRemaining: item?.sellingStatus?.[0]?.timeLeft?.[0],
      shippingCost: parseFloat(item?.shippingInfo?.[0]?.shippingServiceCost?.[0]?.__value__?.[0] || '0'),
      thumbnailUrl: item?.galleryURL?.[0],
      images: item?.galleryURL ? [item.galleryURL[0]] : [],
      rawData: item as unknown as Record<string, unknown>,
    }
  }
  
  private mapBuyApiToRawListing(item: any): RawListing {
    return {
      platform: this.platform,
      externalId: item.itemId || '',
      url: item.itemWebUrl || '',
      title: item.title || '',
      description: item.shortDescription || '',
      price: parseFloat(item.price?.value || '0'),
      currency: item.price?.currency || 'USD',
      condition: item.condition || item.conditionDisplayName,
      format: this.extractFormat(item.title, item.shortDescription),
      artist: this.extractArtist(item.title),
      album: this.extractAlbum(item.title),
      catalogNumber: this.extractCatalogNumber(item.title, item.shortDescription),
      listingType: item.buyingOptions?.includes('AUCTION') ? 'auction' : 'buy_it_now',
      shippingCost: parseFloat(item.shippingOptions?.[0]?.shippingCost?.value || '0'),
      images: item.image?.imageUrls || [],
      thumbnailUrl: item.image?.imageUrl,
      sellerName: item.seller?.username,
      sellerFeedbackScore: item.seller?.feedbackScore,
      sellerLocation: item.seller?.location,
      bidCount: item.bidCount,
      timeRemaining: item.timeAgo,
      rawData: item,
    }
  }

  private mapBrowseToRawListing(data: any): RawListing {
    return {
      platform: this.platform,
      externalId: data.itemId || '',
      url: data.itemWebUrl || '',
      title: data.title || '',
      description: data.description || '',
      price: parseFloat(data.price?.value || '0'),
      currency: data.price?.currency || 'USD',
      condition: data.condition || data.conditionDisplayName,
      format: this.extractFormat(data.title, data.description),
      artist: this.extractArtist(data.title),
      album: this.extractAlbum(data.title),
      catalogNumber: this.extractCatalogNumber(data.title, data.description),
      listingType: data.buyingOptions?.includes('AUCTION') ? 'auction' : 'buy_it_now',
      shippingCost: parseFloat(data.shippingOptions?.[0]?.shippingCost?.value || '0'),
      images: data.image?.imageUrls || [],
      thumbnailUrl: data.image?.imageUrl,
      rawData: data,
    }
  }
  
  private extractFormat(title: string, description?: string): string | undefined {
    const text = `${title} ${description || ''}`.toUpperCase()
    if (text.includes('LP') || text.includes('12"')) return 'LP'
    if (text.includes('7"') || text.includes('45')) return '7"'
    if (text.includes('CD')) return 'CD'
    if (text.includes('CASSETTE')) return 'Cassette'
    return undefined
  }
  
  private extractArtist(title: string): string | undefined {
    // Simple heuristic: first part before dash or comma
    const match = title.match(/^([^-–—,]+)/)
    return match ? match[1].trim() : undefined
  }
  
  private extractAlbum(title: string): string | undefined {
    // Simple heuristic: part after dash
    const match = title.match(/[-–—]\s*(.+?)(?:\s*\(|\s*\[|$)/)
    return match ? match[1].trim() : undefined
  }
  
  private extractCatalogNumber(title: string, description?: string): string | undefined {
    const text = `${title} ${description || ''}`
    // Look for catalog number patterns like "ABC-123", "ABC123", etc.
    const match = text.match(/\b([A-Z]{2,}\s*-?\s*\d{2,})\b/i)
    return match ? match[1].replace(/\s+/g, '') : undefined
  }
}

