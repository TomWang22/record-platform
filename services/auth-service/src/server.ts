import express from 'express'
import { PrismaClient } from '@prisma/client'
import { register, httpCounter } from '@common/utils/metrics'
import { signJwt, verifyJwt } from '@common/utils/auth'
import bcrypt from 'bcryptjs'

const app = express()
const prisma = new PrismaClient()
app.use(express.json())
app.use((req, res, next) => { res.on('finish', () => httpCounter.inc({ service: 'auth', route: req.path, method: req.method, code: res.statusCode })); next() })
app.get('/metrics', async (_req, res) => { res.setHeader('Content-Type', register.contentType); res.end(await register.metrics()) })
app.get('/healthz', (_req,res)=>res.json({ok:true}))

app.post('/register', async (req, res) => {
  const { email, password } = req.body ?? {}
  if (!email || !password) return res.status(400).json({ error: 'email/password required' })
  const hash = await bcrypt.hash(password, 10)
  const user = await prisma.user.create({ data: { email, password: hash } })
  const token = signJwt({ sub: user.id, email: user.email })
  res.json({ token })
})
app.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {}
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) return res.status(401).json({ error: 'invalid credentials' })
  const ok = await bcrypt.compare(password, user.password)
  if (!ok) return res.status(401).json({ error: 'invalid credentials' })
  const token = signJwt({ sub: user.id, email: user.email })
  res.json({ token })
})
app.get('/me', (req, res) => {
  const auth = req.headers.authorization?.split(' ')[1]
  if (!auth) return res.status(401).json({ error: 'missing token' })
  try { res.json(verifyJwt(auth)) } catch { res.status(401).json({ error: 'invalid token' }) }
})
app.listen(process.env.AUTH_PORT || 4001, () => console.log('auth up'))
