import express from 'express'
import os from 'os'
import { Worker } from 'worker_threads'
import path from 'path'
import { register, httpCounter } from '@common/utils/src/metrics'

const app = express()
app.use(express.json())
app.use((req, res, next) => { res.on('finish', () => httpCounter.inc({ service: 'analytics', route: req.path, method: req.method, code: res.statusCode })); next() })
app.get('/metrics', async (_req, res) => { res.setHeader('Content-Type', register.contentType); res.end(await register.metrics()) })
app.get('/healthz', (_req,res)=>res.json({ok:true}))

app.post('/analytics/predict-price', async (req, res) => {
  const items = (req.body?.items as any[]) ?? []
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items required' })
  const cores = os.cpus().length
  const chunkSize = Math.ceil(items.length / cores)
  const chunks = Array.from({ length: cores }, (_, i) => items.slice(i * chunkSize, (i + 1) * chunkSize)).filter(c => c.length)
  const results = await Promise.all(chunks.map(c => new Promise<number[]>((resolve, reject) => {
    const w = new Worker(path.join(__dirname, 'worker.js'), { workerData: { items: c } })
    w.on('message', (m) => resolve(m)); w.on('error', reject)
  })))
  const flat = results.flat()
  const avg = flat.reduce((a, b) => a + b, 0) / flat.length
  res.json({ suggested: Math.round(avg * 100) / 100, samples: flat.length })
})
app.listen(process.env.ANALYTICS_PORT || 4004, () => console.log('analytics up'))
