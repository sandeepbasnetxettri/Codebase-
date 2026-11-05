import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { PrismaClient } from "@prisma/client";
import authRoutes from "./routes/auth";
import walletRoutes from "./routes/wallet";
const app = express();
export const prisma = new PrismaClient();
const port = Number(process.env.PORT || 4000);
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error("JWT_SECRET must be at least 32 characters");
app.use(helmet());
app.use(cors({ origin: (process.env.CORS_ORIGIN || "http://localhost:8081").split(",").map(s => s.trim()) }));
app.use(express.json({ limit: "20kb" }));
app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false }));
app.get("/health", (_req, res) => res.json({ status: "ok", mode: "demo-only" }));
app.use("/api/auth", authRoutes);
app.use("/api/wallet", walletRoutes);
app.use((_req, res) => res.status(404).json({ error: "Route not found" }));
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});
const server = app.listen(port, () => console.log(`Wallet API listening on :${port}`));
async function shutdown() { server.close(); await prisma.$disconnect(); }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
