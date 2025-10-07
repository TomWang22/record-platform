'use client'
import { useEffect, useState } from 'react'
const GW = process.env.NEXT_PUBLIC_GATEWAY_URL!

type Settings = { country_code: string; currency: string; fee_rate: number; duty_rate: number }
const defaults: Settings = { country_code: 'US', currency: 'USD', fee_rate: 0, duty_rate: 0 }

export default function SettingsPage() {
  const [s,setS]=useState<Settings>(defaults)
  const [msg,setMsg]=useState('')

  async function load() {
    const r = await fetch(`${GW}/listings/settings`, { headers: { Authorization: 'Bearer '+localStorage.getItem('token') }})
    if(r.status===401){ location.href='/login'; return }
    setS(await r.json())
  }
  async function save() {
    const r = await fetch(`${GW}/listings/settings`, {
      method:'PUT', headers: { 'Content-Type':'application/json', Authorization: 'Bearer '+localStorage.getItem('token') },
      body: JSON.stringify(s)
    })
    setMsg(r.ok ? 'Saved!' : 'Save failed')
  }
  useEffect(()=>{load()},[])

  return (
    <main style={{maxWidth:480}}>
      <h2>Settings</h2>
      <label>Country code <input value={s.country_code} onChange={e=>setS({...s,country_code:e.target.value.toUpperCase().slice(0,2)})}/></label><br/>
      <label>Currency <input value={s.currency} onChange={e=>setS({...s,currency:e.target.value.toUpperCase().slice(0,3)})}/></label><br/>
      <label>Marketplace fee % <input type="number" step="0.1" value={s.fee_rate} onChange={e=>setS({...s,fee_rate: Number(e.target.value)})}/></label><br/>
      <label>Customs/VAT % <input type="number" step="0.1" value={s.duty_rate} onChange={e=>setS({...s,duty_rate: Number(e.target.value)})}/></label><br/>
      <button onClick={save}>Save</button> <span>{msg}</span>
      <p style={{marginTop:12,opacity:.8}}>Totals prefer eBay import charges; otherwise apply duty% to (price + shipping).</p>
    </main>
  )
}
