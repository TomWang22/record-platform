import { Router } from "express";
import { Pool } from "pg";
import { verifyJwt } from "@common/utils/auth";

const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
const r: Router = Router();

r.use((req,res,next)=>{
  const token = req.headers.authorization?.split(" ")[1];
  if(!token) return res.status(401).json({error:"auth required"});
  try { (req as any).user = verifyJwt(token); next(); }
  catch { return res.status(401).json({error:"invalid token"}); }
});

r.get("/", async (req,res)=>{
  const uid = (req as any).user.sub;
  const { rows } = await pool.query(
    `SELECT country_code, currency, fee_rate, duty_rate, timezone, 
            auction_deadline_reminder, auction_deadline_hours_before, preferred_auction_end_time
     FROM listings.user_settings WHERE user_id=$1`,
    [uid]
  );
  res.json(rows[0] || { 
    country_code:"US", 
    currency:"USD", 
    fee_rate:0, 
    duty_rate:0,
    timezone: "UTC",
    auction_deadline_reminder: true,
    auction_deadline_hours_before: 24,
    preferred_auction_end_time: "20:00:00"
  });
});

r.put("/", async (req,res)=>{
  const uid = (req as any).user.sub;
  const { 
    country_code="US", 
    currency="USD", 
    fee_rate=0, 
    duty_rate=0,
    timezone="UTC",
    auction_deadline_reminder=true,
    auction_deadline_hours_before=24,
    preferred_auction_end_time="20:00:00"
  } = req.body || {};
  await pool.query(`
    INSERT INTO listings.user_settings(
      user_id, country_code, currency, fee_rate, duty_rate,
      timezone, auction_deadline_reminder, auction_deadline_hours_before, preferred_auction_end_time
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (user_id) DO UPDATE SET 
      country_code=EXCLUDED.country_code, 
      currency=EXCLUDED.currency,
      fee_rate=EXCLUDED.fee_rate, 
      duty_rate=EXCLUDED.duty_rate,
      timezone=EXCLUDED.timezone,
      auction_deadline_reminder=EXCLUDED.auction_deadline_reminder,
      auction_deadline_hours_before=EXCLUDED.auction_deadline_hours_before,
      preferred_auction_end_time=EXCLUDED.preferred_auction_end_time
  `,[uid, country_code, currency, fee_rate, duty_rate, timezone, auction_deadline_reminder, auction_deadline_hours_before, preferred_auction_end_time]);
  res.status(204).end();
});

export default r;
