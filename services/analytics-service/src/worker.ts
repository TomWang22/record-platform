import { parentPort, workerData } from 'worker_threads'
type Inputs = { price: number, recordGrade?: string, sleeveGrade?: string, promo?: boolean, anniversaryBoost?: number }
function scoreOne(x: Inputs) {
  let s = x.price
  if (x.recordGrade === 'NM') s *= 1.25
  else if (x.recordGrade === 'VG+') s *= 1.10
  if (x.sleeveGrade === 'NM') s *= 1.10
  if (x.promo) s *= 1.05
  if (x.anniversaryBoost) s *= (1 + x.anniversaryBoost)
  return s
}
const out = (workerData.items as Inputs[]).map(scoreOne)
parentPort?.postMessage(out)
