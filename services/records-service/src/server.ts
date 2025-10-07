import express from 'express'
import { PrismaClient } from '../generated/records-client'
import { register, httpCounter } from '@common/utils/metrics'
import { recordsRouter } from './routes/records'
import exportRouter from './routes/export'

const app = express()
const prisma = new PrismaClient()
app.use(express.json())
app.use((req, res, next) => { res.on('finish', () => httpCounter.inc({ service: 'records', route: req.path, method: req.method, code: res.statusCode })); next() })
app.get('/metrics', async (_req, res) => { res.setHeader('Content-Type', register.contentType); res.end(await register.metrics()) })
app.get('/healthz', (_req,res)=>res.json({ok:true}))
app.use('/records', recordsRouter(prisma))
app.use('/records', exportRouter)
app.listen(process.env.RECORDS_PORT || 4002, () => console.log('records up'))
