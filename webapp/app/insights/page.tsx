'use client'
import { useState } from 'react'
const GW = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:8080'
function sanitize(s: string){ return s.replace(/[<>\"'`;(){}]/g,'').slice(0,200) }
export default function Insights(){
  const [q,setQ] = useState('Miles Davis Kind of Blue')
  const [suggested,setSuggested]=useState<number|undefined>()
  const [trend,setTrend]=useState<any>()
  const [busy,setBusy]=useState(false)
  async function predict(){
    setBusy(true)
    const body = { items: [{ query: sanitize(q), record_grade: 'VG+', sleeve_grade: 'VG', promo: false, anniversary_boost: 0 }] }
    const r = await fetch(`${GW}/ai/predict-price`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) })
    const j = await r.json(); setSuggested(j.suggested); setBusy(false)
  }
  async function loadTrends(){
    const r = await fetch(`${GW}/ai/price-trends?`+new URLSearchParams({ q: sanitize(q) }))
    setTrend(await r.json())
  }
  return (
    <main style={{ maxWidth: 680 }}>
      <h2>Insights</h2>
      <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Artist / Album" />
      <button onClick={predict} disabled={busy}>{busy?'…':'Predict price'}</button>
      <button onClick={loadTrends}>Load trends</button>
      {suggested!==undefined && <p>Suggested: ${suggested}</p>}
      {trend && <pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(trend, null, 2)}</pre>}
    </main>
  )
}
