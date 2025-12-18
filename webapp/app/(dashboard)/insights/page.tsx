'use client'

import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ApiError } from '@/lib/api-client'
import { predictPrice, getPriceTrend, getSimilarSearches, getTrendingSearches, logSearch } from '@/lib/analytics-client'
import { aiPredictPrice, aiGetPriceTrends, aiGetRecommendations, aiChat, type AIChatRequest } from '@/lib/python-ai-client'
import { getClientSessionToken } from '@/lib/session'

type TrendResponse = Record<string, unknown>

export default function InsightsPage() {
  const [query, setQuery] = useState('Miles Davis Kind of Blue')
  const [suggested, setSuggested] = useState<number | null>(null)
  const [aiSuggested, setAiSuggested] = useState<number | null>(null)
  const [trend, setTrend] = useState<TrendResponse | null>(null)
  const [recommendations, setRecommendations] = useState<Array<{ query: string; count: number }>>([])
  const [trending, setTrending] = useState<Array<{ query: string; count: number }>>([])
  const [chatMessage, setChatMessage] = useState('')
  const [chatResponse, setChatResponse] = useState('')
  const [kafkaEvents, setKafkaEvents] = useState<Array<{ topic: string; timestamp: string; value: any }>>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    // Get user ID from session
    const token = getClientSessionToken()
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]))
        setUserId(payload.sub || null)
      } catch {
        // Ignore token parsing errors
      }
    }
    
    // Load trending searches on mount
    loadTrending()
    
    // Connect to Kafka stream
    connectKafkaStream()
  }, [])
  
  async function handlePredict() {
    setBusy(true)
    setError('')
    try {
      const sanitizedQuery = sanitize(query)
      const payload = [{ query: sanitizedQuery, record_grade: 'VG+', sleeve_grade: 'VG', promo: false, anniversary_boost: 0 }]
      
      // Get both Analytics and AI predictions
      const [analyticsResponse, aiResponse] = await Promise.all([
        predictPrice(payload),
        aiPredictPrice(payload),
      ])
      
      setSuggested(analyticsResponse?.suggested ?? null)
      setAiSuggested(aiResponse?.suggested ?? null)
      
      // Log the search
      if (userId) {
        await logSearch(userId, 'insights', sanitizedQuery).catch(console.error)
      }
    } catch (err) {
      handleError(err)
    } finally {
      setBusy(false)
    }
  }
  
  async function loadTrending() {
    try {
      const response = await getTrendingSearches(7, 10)
      setTrending(response.trending || [])
    } catch (err) {
      console.error('Failed to load trending:', err)
    }
  }
  
  async function loadRecommendations() {
    if (!query.trim()) return
    try {
      const response = await aiGetRecommendations(sanitize(query), userId || undefined, 5)
      setRecommendations(response.recommendations || [])
    } catch (err) {
      console.error('Failed to load recommendations:', err)
    }
  }
  
  async function handleChat() {
    if (!chatMessage.trim()) return
    setBusy(true)
    setError('')
    try {
      const response = await aiChat({
        message: chatMessage,
        user_id: userId || undefined,
        context: 'insights',
      })
      setChatResponse(response.response)
    } catch (err) {
      handleError(err)
    } finally {
      setBusy(false)
    }
  }
  
  function connectKafkaStream() {
    // Only connect if Kafka is available (graceful degradation)
    let eventSource: EventSource | null = null
    let reconnectAttempts = 0
    const maxReconnectAttempts = 3
    
    const connect = () => {
      try {
        eventSource = new EventSource('/api/kafka/stream')
        
        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            if (data.type === 'event') {
              setKafkaEvents((prev) => [
                ...prev.slice(-9), // Keep last 10 events
                {
                  topic: data.topic,
                  timestamp: new Date(data.timestamp).toLocaleTimeString(),
                  value: data.value,
                },
              ])
            } else if (data.type === 'connected') {
              reconnectAttempts = 0 // Reset on successful connection
            } else if (data.type === 'error') {
              console.warn('Kafka stream error:', data.message)
            }
          } catch (err) {
            console.error('Failed to parse Kafka event:', err)
          }
        }
        
        eventSource.onerror = (err) => {
          console.warn('Kafka stream connection error (will retry):', err)
          eventSource?.close()
          eventSource = null
          
          // Retry connection after delay
          if (reconnectAttempts < maxReconnectAttempts) {
            reconnectAttempts++
            setTimeout(connect, 5000 * reconnectAttempts) // Exponential backoff
          } else {
            console.warn('Kafka stream: Max reconnect attempts reached. Kafka may be unavailable.')
          }
        }
      } catch (err) {
        console.warn('Failed to create Kafka stream:', err)
      }
    }
    
    connect()
    
    return () => {
      eventSource?.close()
    }
  }

  async function handleTrends() {
    setError('')
    try {
      const response = await aiGetPriceTrends(sanitize(query))
      setTrend(response)
      // Also load recommendations when trends are loaded
      await loadRecommendations()
    } catch (err) {
      handleError(err)
    }
  }

  function handleError(err: unknown) {
    if (err instanceof ApiError) {
      setError(err.message || 'Insights service returned an error')
    } else if (err instanceof Error) {
      setError(err.message)
    } else {
      setError('Unexpected error')
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Insights & AI</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          AI-powered price predictions and market trends powered by Python AI service and analytics.
        </p>
      </header>

      <Card title="Query" description="Provide an artist or release to fetch trendlines and AI price guidance.">
        <div className="flex flex-col gap-3 md:flex-row">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Artist / Album"
            className="flex-1 rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
          />
          <div className="flex gap-2">
            <Button onClick={handlePredict} disabled={busy}>
              {busy ? 'Scoring…' : 'Predict price'}
            </Button>
            <Button variant="secondary" onClick={handleTrends} disabled={busy}>
              Load trends
            </Button>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
      </Card>

      <section className="grid gap-5 lg:grid-cols-2">
        <Card title="Analytics Price Prediction" description="Powered by Analytics service with historical data analysis.">
          {suggested === null ? (
            <div className="space-y-2">
              <p className="text-sm text-slate-400">No prediction yet.</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Enter a query above and click "Predict price" to get pricing suggestions.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-4xl font-semibold text-brand">${suggested.toFixed(2)}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Based on historical sales data and market trends
              </p>
            </div>
          )}
        </Card>
        
        <Card title="AI-Enhanced Price Prediction" description="Blended prediction from Python AI service (combines Analytics + AI models).">
          {aiSuggested === null ? (
            <div className="space-y-2">
              <p className="text-sm text-slate-400">No AI prediction yet.</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Click "Predict price" to get AI-enhanced pricing suggestions.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-4xl font-semibold text-emerald-600 dark:text-emerald-400">${aiSuggested.toFixed(2)}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                AI-enhanced prediction (blended with Analytics data)
              </p>
            </div>
          )}
        </Card>

        <Card title="Price Trends" description="Historical price data from analytics service.">
          {trend ? (
            <div className="space-y-2">
              <pre className="max-h-64 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700 dark:bg-slate-900 dark:text-slate-300">
                {JSON.stringify(trend, null, 2)}
              </pre>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Price trend data for the last 90 days
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-slate-400">No trend data loaded.</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Click "Load trends" to see historical price movements.
              </p>
            </div>
          )}
        </Card>
      </section>

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <Card title="Similar Recommendations" description="AI-powered recommendations based on your query.">
          <ul className="space-y-2">
            {recommendations.map((rec, idx) => (
              <li key={idx} className="flex items-center justify-between text-sm">
                <span className="text-slate-700 dark:text-slate-300">{rec.query}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">{rec.count} searches</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      
      {/* Trending Searches */}
      {trending.length > 0 && (
        <Card title="Trending Searches" description="Popular searches in the last 7 days.">
          <ul className="space-y-2">
            {trending.map((item, idx) => (
              <li key={idx} className="flex items-center justify-between text-sm">
                <span className="text-slate-700 dark:text-slate-300">{item.query}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">{item.count} searches</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      
      {/* AI Chat */}
      <Card title="AI Chat Assistant" description="Ask questions about records, prices, and market trends.">
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && handleChat()}
              placeholder="Ask about records, prices, trends..."
              className="flex-1 rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
            />
            <Button onClick={handleChat} disabled={busy || !chatMessage.trim()}>
              {busy ? 'Thinking...' : 'Send'}
            </Button>
          </div>
          {chatResponse && (
            <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-900 dark:text-slate-300">
              {chatResponse}
            </div>
          )}
        </div>
      </Card>
      
      {/* Kafka Events (Real-time) */}
      {kafkaEvents.length > 0 && (
        <Card title="Real-time Events" description="Live events from Kafka (analytics-predictions, analytics-searches).">
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {kafkaEvents.map((event, idx) => (
              <div key={idx} className="rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-900">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-slate-700 dark:text-slate-300">{event.topic}</span>
                  <span className="text-slate-500 dark:text-slate-400">{event.timestamp}</span>
                </div>
                <pre className="text-xs text-slate-600 dark:text-slate-400 overflow-x-auto">
                  {JSON.stringify(event.value, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </Card>
      )}
      
      {/* Service Status */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-white">AI Services Status</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Python AI service and Analytics service connectivity
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="text-xs text-slate-500 dark:text-slate-400">Connected</span>
          </div>
        </div>
      </Card>
    </div>
  )
}

function sanitize(input: string) {
  return input.replace(/[<>\"'`;(){}]/g, '').slice(0, 200)
}

