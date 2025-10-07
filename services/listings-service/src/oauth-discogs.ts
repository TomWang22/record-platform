import express from "express";
import axios from "axios";
import crypto from "crypto";
import { Pool } from "pg";

const router = express.Router();
const pool = new Pool({ connectionString: process.env.POSTGRES_URL });

const DISCOGS_REQUEST_TOKEN_URL = "https://api.discogs.com/oauth/request_token";
const DISCOGS_AUTHORIZE_URL = "https://discogs.com/oauth/authorize";
const DISCOGS_ACCESS_TOKEN_URL = "https://api.discogs.com/oauth/access_token";
const OAUTH_CALLBACK = process.env.LISTINGS_DISCOGS_CALLBACK || "http://localhost:8080/listings/oauth/discogs/callback";

function oauth1Header(url: string, method: string, extraParams: Record<string,string> = {}, tokenSecret="") {
  const params: Record<string,string> = {
    oauth_consumer_key: process.env.DISCOGS_CONSUMER_KEY || "",
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now()/1000).toString(),
    oauth_version: "1.0",
    ...extraParams,
  };
  const baseParams = Object.keys(params).sort().map(k=>`${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join("&");
  const base = [method.toUpperCase(), encodeURIComponent(url), encodeURIComponent(baseParams)].join("&");
  const key = `${encodeURIComponent(process.env.DISCOGS_CONSUMER_SECRET || "")}&${encodeURIComponent(tokenSecret)}`;
  const sig = crypto.createHmac("sha1", key).update(base).digest("base64");
  const header = `OAuth ${Object.entries({ ...params, oauth_signature: sig }).map(([k,v])=>`${encodeURIComponent(k)}="${encodeURIComponent(v)}"`).join(", ")}`;
  return header;
}

router.get("/discogs/start", async (_req, res) => {
  try {
    const authHeader = oauth1Header(DISCOGS_REQUEST_TOKEN_URL, "POST", { oauth_callback: OAUTH_CALLBACK });
    const r = await axios.post(DISCOGS_REQUEST_TOKEN_URL, undefined, { headers: { Authorization: authHeader } });
    const params = new URLSearchParams(r.data);
    const token = params.get("oauth_token");
    const authorizeUrl = `${DISCOGS_AUTHORIZE_URL}?oauth_token=${token}`;
    res.redirect(authorizeUrl);
  } catch {
    res.status(500).json({ error: "discogs oauth start failed" });
  }
});

router.get("/discogs/callback", async (req, res) => {
  const { oauth_token, oauth_verifier } = req.query as any;
  try {
    const authHeader = oauth1Header(DISCOGS_ACCESS_TOKEN_URL, "POST", { oauth_token: oauth_token as string, oauth_verifier: oauth_verifier as string });
    const r = await axios.post(DISCOGS_ACCESS_TOKEN_URL, undefined, { headers: { Authorization: authHeader } });
    const params = new URLSearchParams(r.data);
    const access = params.get("oauth_token");
    const secret = params.get("oauth_token_secret");

    const userId = req.header("x-user-id");
    if (!userId) return res.status(400).json({ error: "missing user" });

    await pool.query(
      `INSERT INTO listings.oauth_tokens(user_id, service, oauth_token, oauth_token_secret)
       VALUES ($1,'discogs',$2,$3)
       ON CONFLICT (user_id, service) DO UPDATE SET oauth_token = EXCLUDED.oauth_token, oauth_token_secret = EXCLUDED.oauth_token_secret`,
      [userId, access, secret]
    );
    res.send("Discogs linked. You can close this tab.");
  } catch {
    res.status(500).json({ error: "discogs oauth callback failed" });
  }
});

export default router;
