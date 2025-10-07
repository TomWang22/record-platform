import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { verifyJwt } from '@common/utils/src/auth'

export function recordsRouter(prisma: PrismaClient) {
  const r = Router()

  r.use((req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1]
    if (!token) return res.status(401).json({ error: 'auth required' })
    try { (req as any).user = verifyJwt(token); next() }
    catch { return res.status(401).json({ error: 'invalid token' }) }
  })

  r.get('/', async (req, res) => {
    const userId = (req as any).user.sub
    const { q } = req.query as any
    const where: any = { userId }
    if (q) where.OR = [
      { artist: { contains: q as string, mode: 'insensitive' } },
      { name: { contains: q as string, mode: 'insensitive' } },
      { catalogNumber: { contains: q as string, mode: 'insensitive' } },
    ]
    const items = await prisma.record.findMany({ where, take: 100, orderBy: { updatedAt: 'desc' } })
    res.json(items)
  })

  r.post('/', async (req, res) => {
    const userId = (req as any).user.sub
    const created = await prisma.record.create({ data: { ...req.body, userId } })
    res.status(201).json(created)
  })

  r.patch('/:id', async (req, res) => {
    const userId = (req as any).user.sub
    const id = req.params.id
    const rec = await prisma.record.findUnique({ where: { id } })
    if (!rec || rec.userId !== userId) return res.status(404).json({ error: 'not found' })
    const updated = await prisma.record.update({ where: { id }, data: req.body })
    res.json(updated)
  })

  r.delete('/:id', async (req, res) => {
    const userId = (req as any).user.sub
    const id = req.params.id
    const rec = await prisma.record.findUnique({ where: { id } })
    if (!rec || rec.userId !== userId) return res.status(404).json({ error: 'not found' })
    await prisma.record.delete({ where: { id } })
    res.status(204).end()
  })

  return r
}
