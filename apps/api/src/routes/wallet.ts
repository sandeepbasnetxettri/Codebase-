import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "../index";
import { AuthRequest, requireAuth } from "../middleware/auth";
const router = Router();
router.use(requireAuth);
router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const wallet = await prisma.wallet.findUnique({ where: { userId: req.userId! } });
    if (!wallet) return res.status(404).json({ error: "Wallet not found" });
    res.json({ currency: wallet.currency, balancePaisa: wallet.balancePaisa.toString(), balanceNpr: Number(wallet.balancePaisa) / 100 });
  } catch (error) { next(error); }
});
router.get("/transactions", async (req: AuthRequest, res, next) => {
  try {
    const entries = await prisma.ledgerEntry.findMany({
      where: { userId: req.userId! }, orderBy: { createdAt: "desc" }, take: 50,
      select: { id: true, transferRef: true, amountPaisa: true, direction: true, description: true, createdAt: true, counterparty: { select: { name: true, email: true } } }
    });
    res.json({ transactions: entries.map(e => ({ ...e, amountPaisa: e.amountPaisa.toString() })) });
  } catch (error) { next(error); }
});
router.post("/transfers", async (req: AuthRequest, res, next) => {
  const parsed = z.object({
    recipientEmail: z.string().email().transform(v => v.toLowerCase()),
    amount: z.number().positive().max(100000).refine(v => Math.abs(v * 100 - Math.round(v * 100)) < 1e-8, "Maximum two decimal places"),
    note: z.string().trim().max(120).optional()
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid transfer details", details: parsed.error.flatten() });
  const amountPaisa = BigInt(Math.round(parsed.data.amount * 100));
  try {
    const recipient = await prisma.user.findUnique({ where: { email: parsed.data.recipientEmail }, select: { id: true } });
    if (!recipient) return res.status(404).json({ error: "Recipient not found" });
    if (recipient.id === req.userId) return res.status(400).json({ error: "Cannot transfer to yourself" });
    const transferRef = `TR-${randomUUID()}`;
    await prisma.$transaction(async tx => {
      const sender = await tx.wallet.findUnique({ where: { userId: req.userId! } });
      if (!sender || sender.balancePaisa < amountPaisa) throw new Error("INSUFFICIENT_FUNDS");
      await tx.wallet.update({ where: { userId: req.userId! }, data: { balancePaisa: { decrement: amountPaisa } } });
      await tx.wallet.update({ where: { userId: recipient.id }, data: { balancePaisa: { increment: amountPaisa } } });
      await tx.ledgerEntry.createMany({ data: [
        { transferRef, userId: req.userId!, counterpartyId: recipient.id, amountPaisa, direction: "DEBIT", description: parsed.data.note || "Wallet transfer" },
        { transferRef, userId: recipient.id, counterpartyId: req.userId!, amountPaisa, direction: "CREDIT", description: parsed.data.note || "Wallet transfer" }
      ] });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const wallet = await prisma.wallet.findUnique({ where: { userId: req.userId! } });
    res.status(201).json({ status: "DEMO_COMPLETED", transferRef, balancePaisa: wallet!.balancePaisa.toString() });
  } catch (error: any) {
    if (error?.message === "INSUFFICIENT_FUNDS") return res.status(400).json({ error: "Insufficient demo balance" });
    if (error?.code === "P2034") return res.status(409).json({ error: "Concurrent wallet update; retry" });
    next(error);
  }
});
export default router;
