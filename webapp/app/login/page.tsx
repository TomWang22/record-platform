'use client'
import { useState } from 'react'
const GW = process.env.NEXT_PUBLIC_GATEWAY_URL!
export default function Login() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [msg, setMsg] = useState('')
  async function submit(path: 'login'|'register') {
    const r = await fetch(`${GW}/auth/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
    const j = await r.json(); if (j.token) { localStorage.setItem('token', j.token); location.href='/records' } else setMsg(j.error||'failed')
  }
  return (
    <main>
      <h2>Login</h2>
      <input placeholder="email" value={email} onChange={e=>setEmail(e.target.value)} /><br/>
      <input placeholder="password" type="password" value={password} onChange={e=>setPassword(e.target.value)} /><br/>
      <button onClick={()=>submit('login')}>Login</button>
      <button onClick={()=>submit('register')}>Register</button>
      <div>{msg}</div>
    </main>
  )
}
