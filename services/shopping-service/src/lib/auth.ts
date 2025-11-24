import { Request, Response, NextFunction } from 'express'
import { verifyJwt } from '@common/utils/auth'

export interface AuthedRequest extends Request {
  user?: {
    sub: string
    email?: string
  }
}

export function requireUser(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  const token = authHeader.substring(7)
  try {
    req.user = verifyJwt(token)
    next()
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' })
  }
}

export function getUserId(req: AuthedRequest): string {
  if (!req.user?.sub) {
    throw new Error('User ID not found in request')
  }
  return req.user.sub
}

