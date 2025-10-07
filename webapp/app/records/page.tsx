'use client'
import { useEffect, useState } from 'react'
const GW = process.env.NEXT_PUBLIC_GATEWAY_URL!
type Rec = { id:string, artist:string, name:string, format:string, catalogNumber?:string }
export default function Records() {
  const [items,setItems]=useState<Rec[]>([])
  const [q,setQ]=useState('')
  const [msg,setMsg]=useState('')
  async function load() {
    const r=await fetch(`${GW}/records/records?`+new URLSearchParams(q?{q}:{}) ,{ headers: { Authorization: 'Bearer '+localStorage.getItem('token') }})
    if(r.status===401){ location.href='/login'; return }
    setItems(await r.json())
  }
  async function exportCsv(){
    const r=await fetch(`${GW}/records/export`, { method:'POST', headers: { Authorization: 'Bearer '+localStorage.getItem('token') }})
    const j=await r.json(); setMsg(j?.key ? `Exported to s3://${j.bucket}/${j.key}` : (j.error||'export failed'))
  }
  useEffect(()=>{load()},[])
  return (
    <main>
      <h2>Your Records</h2>
      <input placeholder="search..." value={q} onChange={e=>setQ(e.target.value)} />
      <button onClick={load}>Search</button>
      <button onClick={exportCsv} style={{marginLeft:8}}>Export CSV → S3/R2</button>
      <div style={{opacity:.8}}>{msg}</div>
      <ul>{items.map(x=> <li key={x.id}>{x.artist} — {x.name} [{x.format}] {x.catalogNumber??''}</li>)}</ul>
    </main>
  )
}
