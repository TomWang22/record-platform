/**
 * Catalog Enricher
 * 
 * Enriches auction listings by matching them with Discogs catalog data.
 * Improves confidence scores and data completeness by:
 * - Matching catalog numbers to Discogs releases
 * - Fuzzy matching by artist + album + format
 * - Enriching missing fields (artist, album, format, year, label)
 * 
 * This enables better price analysis and recommendations by linking
 * listings to authoritative catalog data.
 */

import axios, { AxiosInstance } from 'axios'
import { getCache } from '../lib/redis-cache'
import type { NormalizedListing } from '../normalizers/listing-normalizer'

export interface DiscogsRelease {
  id: number
  title: string
  artists?: Array<{ name: string }>
  formats?: Array<{ name: string; qty?: string; descriptions?: string[] }>
  labels?: Array<{ name: string; catno?: string }>
  year?: number
  genres?: string[]
  styles?: string[]
  tracklist?: Array<{ position: string; title: string; duration?: string }>
  images?: Array<{ uri: string; type: string }>
  uri: string
}

export interface EnrichmentResult {
  discogsReleaseId?: number
  catalogMatchConfidence: number  // 0.0-1.0
  enrichedFields: string[]  // Fields that were enriched
}

export class CatalogEnricher {
  private client: AxiosInstance
  private cache = getCache()
  private userToken: string
  private userAgent: string
  
  constructor(config: { userToken: string; userAgent?: string }) {
    this.userToken = config.userToken
    this.userAgent = config.userAgent || 'RecordPlatform/1.0'
    
    this.client = axios.create({
      baseURL: 'https://api.discogs.com',
      timeout: 10000,
      headers: {
        'User-Agent': this.userAgent,
        'Authorization': `Discogs token=${this.userToken}`,
      }
    })
  }
  
  /**
   * Enrich a normalized listing with Discogs catalog data
   * @param listing - Normalized listing to enrich
   * @returns EnrichmentResult with Discogs release ID and confidence
   */
  async enrich(listing: NormalizedListing): Promise<EnrichmentResult> {
    const enrichedFields: string[] = []
    let discogsReleaseId: number | undefined
    let catalogMatchConfidence = 0.0
    
    // Strategy 1: Exact catalog number match (highest confidence)
    if (listing.catalogNumber) {
      const exactMatch = await this.matchByCatalogNumber(listing.catalogNumber)
      if (exactMatch) {
        discogsReleaseId = exactMatch.id
        catalogMatchConfidence = 0.95  // High confidence for exact catalog match
        
        // Enrich missing fields
        if (!listing.artist && exactMatch.artists?.[0]?.name) {
          listing.artist = exactMatch.artists[0].name
          enrichedFields.push('artist')
        }
        if (!listing.album && exactMatch.title) {
          listing.album = exactMatch.title
          enrichedFields.push('album')
        }
        if (!listing.format && exactMatch.formats?.[0]?.name) {
          listing.format = this.normalizeFormat(exactMatch.formats[0].name)
          enrichedFields.push('format')
        }
        if (!listing.year && exactMatch.year) {
          listing.year = exactMatch.year
          enrichedFields.push('year')
        }
        if (!listing.label && exactMatch.labels?.[0]?.name) {
          listing.label = exactMatch.labels[0].name
          enrichedFields.push('label')
        }
      }
    }
    
    // Strategy 2: Fuzzy match by artist + album + format (if no exact match)
    if (!discogsReleaseId && listing.artist && listing.album) {
      const fuzzyMatch = await this.fuzzyMatch(listing.artist, listing.album, listing.format)
      if (fuzzyMatch) {
        discogsReleaseId = fuzzyMatch.id
        catalogMatchConfidence = 0.75  // Lower confidence for fuzzy match
        
        // Enrich missing fields
        if (!listing.catalogNumber && fuzzyMatch.labels?.[0]?.catno) {
          listing.catalogNumber = fuzzyMatch.labels[0].catno
          enrichedFields.push('catalogNumber')
        }
        if (!listing.format && fuzzyMatch.formats?.[0]?.name) {
          listing.format = this.normalizeFormat(fuzzyMatch.formats[0].name)
          enrichedFields.push('format')
        }
        if (!listing.year && fuzzyMatch.year) {
          listing.year = fuzzyMatch.year
          enrichedFields.push('year')
        }
        if (!listing.label && fuzzyMatch.labels?.[0]?.name) {
          listing.label = fuzzyMatch.labels[0].name
          enrichedFields.push('label')
        }
      }
    }
    
    return {
      discogsReleaseId,
      catalogMatchConfidence,
      enrichedFields,
    }
  }
  
  /**
   * Match by exact catalog number (highest confidence)
   */
  private async matchByCatalogNumber(catalogNumber: string): Promise<DiscogsRelease | null> {
    const cacheKey = `discogs:catalog:${catalogNumber}`
    
    return this.cache.getOrSet(
      cacheKey,
      async () => {
        try {
          // Search Discogs by catalog number
          const response = await this.client.get('/database/search', {
            params: {
              catno: catalogNumber,
              type: 'release',
              per_page: 1,
            }
          })
          
          const results = response.data.results || []
          if (results.length === 0) {
            return null
          }
          
          // Get full release details
          const releaseId = results[0].id
          const releaseResponse = await this.client.get(`/releases/${releaseId}`)
          
          return releaseResponse.data as DiscogsRelease
        } catch (error) {
          console.error(`[CatalogEnricher] Error matching catalog number ${catalogNumber}:`, error)
          return null
        }
      },
      { ttl: 86400 }  // Cache for 24 hours
    )
  }
  
  /**
   * Fuzzy match by artist + album + format (lower confidence)
   */
  private async fuzzyMatch(artist: string, album: string, format?: string): Promise<DiscogsRelease | null> {
    const cacheKey = `discogs:fuzzy:${artist}:${album}:${format || 'any'}`
    
    return this.cache.getOrSet(
      cacheKey,
      async () => {
        try {
          // Search Discogs by artist and album
          const query = `${artist} ${album}`
          const response = await this.client.get('/database/search', {
            params: {
              q: query,
              type: 'release',
              per_page: 10,
            }
          })
          
          const results = response.data.results || []
          if (results.length === 0) {
            return null
          }
          
          // Find best match (prefer exact artist/album match)
          for (const result of results) {
            const title = result.title?.toLowerCase() || ''
            const artistMatch = title.includes(artist.toLowerCase())
            const albumMatch = title.includes(album.toLowerCase())
            
            if (artistMatch && albumMatch) {
              // Get full release details
              const releaseId = result.id
              const releaseResponse = await this.client.get(`/releases/${releaseId}`)
              const release = releaseResponse.data as DiscogsRelease
              
              // Check format match if format specified
              if (format) {
                const releaseFormat = release.formats?.[0]?.name?.toLowerCase() || ''
                const formatMatch = releaseFormat.includes(format.toLowerCase()) ||
                                  format.toLowerCase().includes(releaseFormat)
                if (!formatMatch) {
                  continue  // Format doesn't match, try next result
                }
              }
              
              return release
            }
          }
          
          return null
        } catch (error) {
          console.error(`[CatalogEnricher] Error fuzzy matching ${artist} - ${album}:`, error)
          return null
        }
      },
      { ttl: 86400 }  // Cache for 24 hours
    )
  }
  
  /**
   * Normalize Discogs format to our standard format values
   */
  private normalizeFormat(discogsFormat: string): string {
    const normalized = discogsFormat.toUpperCase()
    
    if (normalized.includes('LP') || normalized.includes('12"')) return 'LP'
    if (normalized.includes('7"') || normalized.includes('45')) return '7"'
    if (normalized.includes('CD')) return 'CD'
    if (normalized.includes('CASSETTE') || normalized.includes('TAPE')) return 'Cassette'
    
    return discogsFormat
  }
}

