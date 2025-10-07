import { Router } from "express";
import { Pool } from "pg";
import { verifyJwt } from "@common/utils/auth";

const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
const r = Router();

r.use((req,res,next)=>{
  const token = req.headers.authorization?.split(" ")[1];
  if(!token) return res.status(401).json({error:"auth required"});
  try { (req as any).user = verifyJwt(token); next(); }
  catch { return res.status(401).json({error:"invalid token"}); }
});

r.get("/", async (req,res)=>{
  const uid = (req as any).user.sub;
  const { rows } = await pool.query("SELECT country_code,currency,fee_rate,duty_rate FROM listings.user_settings WHERE user_id=$1",[uid]);
  res.json(rows[0] || { country_code:"US", currency:"USD", fee_rate:0, duty_rate:0 });
});

r.put("/", async (req,res)=>{
  const uid = (req as any).user.sub;
  const { country_code="US", currency="USD", fee_rate=0, duty_rate=0 } = req.body || {};
  await pool.query(`
    INSERT INTO listings.user_settings(user_id,country_code,currency,fee_rate,duty_rate)
    VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (user_id) DO UPDATE SET country_code=EXCLUDED.country_code, currency=EXCLUDED.currency,
      fee_rate=EXCLUDED.fee_rate, duty_rate=EXCLUDED.duty_rate
  `,[uid, country_code, currency, fee_rate, duty_rate]);
  res.status(204).end();
});

export default r;
