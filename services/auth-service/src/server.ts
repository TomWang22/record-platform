/* cspell:ignore healthz */
import express, { type Request, type Response, type NextFunction } from "express";
import { PrismaClient } from "../prisma/generated/client";
import { register, httpCounter } from "@common/utils/metrics";
import { signJwt, verifyJwt } from "@common/utils/auth";
import bcrypt from "bcryptjs";

const app = express();
const prisma = new PrismaClient();

app.use(express.json({ limit: "1mb" }));

// metrics
app.use((req: Request, res: Response, next: NextFunction) => {
  res.on("finish", () =>
    httpCounter.inc({ service: "auth", route: req.path, method: req.method, code: res.statusCode })
  );
  next();
});

app.get("/metrics", async (_req: Request, res: Response) => {
  res.setHeader("Content-Type", register.contentType);
  res.end(await register.metrics());
});

app.get("/healthz", async (_req: Request, res: Response) => {
  try {
    // Basic DB probe
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || "db error" });
  }
});

app.post("/register", async (req: Request, res: Response) => {
  try {
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
    if (!email || !password) return res.status(400).json({ error: "email/password required" });

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: "email already exists" });

    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, passwordHash: hash }, // <-- matches Prisma model
    });

    const token = signJwt({ sub: user.id, email: user.email });
    res.status(201).json({ token });
  } catch (e: any) {
    console.error("register error:", e);
    res.status(500).json({ error: "internal" });
  }
});

app.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
    if (!email || !password) return res.status(400).json({ error: "email/password required" });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) return res.status(401).json({ error: "invalid credentials" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "invalid credentials" });

    const token = signJwt({ sub: user.id, email: user.email });
    res.json({ token });
  } catch (e: any) {
    console.error("login error:", e);
    res.status(500).json({ error: "internal" });
  }
});

app.get("/me", (req: Request, res: Response) => {
  const auth = req.headers.authorization?.split(" ")[1];
  if (!auth) return res.status(401).json({ error: "missing token" });
  try {
    res.json(verifyJwt(auth));
  } catch {
    res.status(401).json({ error: "invalid token" });
  }
});

// safety net
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("auth service error:", msg);
  if (!res.headersSent) res.status(500).json({ error: "internal" });
});

app.listen(process.env.AUTH_PORT || 4001, () => console.log("auth up"));
