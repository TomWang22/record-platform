import { Router } from 'express'
import { PrismaClient } from '../../generated/records-client'
import { verifyJwt } from '@common/utils/auth'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const r = Router()
const prisma = new PrismaClient()

function s3() {
  const endpoint = process.env.S3_ENDPOINT || undefined
  const region = process.env.S3_REGION || 'auto'
  const forcePathStyle = String(process.env.S3_FORCE_PATH_STYLE || '').toLowerCase() === 'true'
  return new S3Client({
    region,
    endpoint,
    forcePathStyle,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || ''
    }
  })
}

function toCsv(rows: any[]) {
  const headers = ["id","artist","name","format","catalogNumber","recordGrade","sleeveGrade","hasInsert","hasBooklet","hasObiStrip","hasFactorySleeve","isPromo","purchasedAt","pricePaid","notes"]
  const escape = (v:any) => {
    if (v===null||v===undefined) return ''
    const s = String(v).replace(/"/g,'""')
    return /[,"\n]/.test(s) ? `"${s}"` : s
  }
  const body = [headers.join(',')].concat(rows.map(row=>headers.map(h=>escape(row[h])).join(','))).join('\n')
  return body
}

r.post('/export', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) return res.status(401).json({ error: 'auth required' })
  let userId: string
  try { userId = (verifyJwt(token) as any).sub } catch { return res.status(401).json({ error: 'invalid token' }) }

  const data = await prisma.record.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } })
  const csv = toCsv(data)
  const bucket = process.env.S3_BUCKET
  if (!bucket) return res.status(500).json({ error: 'S3_BUCKET not configured' })
  const key = `exports/${userId}/${Date.now()}-records.csv`
  const client = s3()
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: csv, ContentType: 'text/csv' }))
  const url = await getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 60 }) // PUT pre-sign (optional)
  res.json({ bucket, key, presign_put: url })
})

export default r
