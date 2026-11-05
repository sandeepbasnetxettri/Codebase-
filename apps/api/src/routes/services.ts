import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { prisma } from "../index";
import { AuthRequest, requireAuth } from "../middleware/auth";
const router = Router();
router.use(requireAuth);
const amountSchema = z.number().positive().max(50000).refine(v => Math.abs(v * 100 - Math.round(v * 100)) < 1e-8);
async function debit(userId: string, amount: number, description: string) {
  const paisa = BigInt(Math.round(amount * 100));
  return prisma.$transaction(async tx => {
    const wallet = await tx.wallet.findUnique({ where: { userId } });
    if (!wallet || wallet.balancePaisa < paisa) throw new Error("INSUFFICIENT_FUNDS");
    await tx.wallet.update({ where: { userId }, data: { balancePaisa: { decrement: paisa } } });
    const ref = "DEMO-" + randomUUID();
    await tx.ledgerEntry.create({ data: { transferRef: ref, userId, amountPaisa: paisa, direction: "DEBIT", description } });
    return ref;
  });
}
router.post("/qr/create", async (req: AuthRequest, res, next) => {
  const parsed = z.object({ amount: amountSchema, note: z.string().max(100).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid amount (maximum two decimals)." });
  try {
    const request = await prisma.paymentRequest.create({ data: { code: randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase(), userId: req.userId!, amountPaisa: BigInt(Math.round(parsed.data.amount * 100)), note: parsed.data.note, expiresAt: new Date(Date.now() + 10 * 60 * 1000) } });
    res.status(201).json({ code: request.code, amount: parsed.data.amount, expiresAt: request.expiresAt, status: request.status, demo: true });
  } catch (e) { next(e); }
});
router.post("/qr/pay", async (req: AuthRequest, res, next) => {
  const parsed = z.object({ code: z.string().min(8).max(32) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid QR payment code" });
  try {
    const request = await prisma.paymentRequest.findUnique({ where: { code: parsed.data.code.toUpperCase() } });
    if (!request || request.status !== "PENDING" || request.expiresAt < new Date()) return res.status(404).json({ error: "QR request unavailable or expired" });
    if (request.userId === req.userId) return res.status(400).json({ error: "You cannot pay your own QR request" });
    await prisma.$transaction(async tx => {
      const payer = await tx.wallet.findUnique({ where: { userId: req.userId! } });
      if (!payer || payer.balancePaisa < request.amountPaisa) throw new Error("INSUFFICIENT_FUNDS");
      await tx.wallet.update({ where: { userId: req.userId! }, data: { balancePaisa: { decrement: request.amountPaisa } } });
      await tx.wallet.update({ where: { userId: request.userId }, data: { balancePaisa: { increment: request.amountPaisa } } });
      const ref = "QR-" + randomUUID();
      await tx.ledgerEntry.createMany({ data: [
        { transferRef: ref, userId: req.userId!, counterpartyId: request.userId, amountPaisa: request.amountPaisa, direction: "DEBIT", description: "Demo QR payment" },
        { transferRef: ref, userId: request.userId, counterpartyId: req.userId!, amountPaisa: request.amountPaisa, direction: "CREDIT", description: "Demo QR received" }
      ] });
      await tx.paymentRequest.update({ where: { id: request.id }, data: { status: "PAID" } });
    });
    res.json({ status: "DEMO_PAID", amountPaisa: request.amountPaisa.toString(), message: "No real money moved." });
  } catch (e: any) { if (e.message === "INSUFFICIENT_FUNDS") return res.status(400).json({ error: "Insufficient demo balance" }); next(e); }
});
router.post("/recharge", async (req: AuthRequest, res, next) => {
  const parsed = z.object({ operator: z.enum(["NTC", "Ncell", "SmartCell"]), phone: z.string().regex(/^(\+977)?9[0-9]{9}$/), amount: amountSchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid operator, phone number, or amount" });
  try { const ref = await debit(req.userId!, parsed.data.amount, `Demo ${parsed.data.operator} recharge ${parsed.data.phone}`); res.status(201).json({ status: "DEMO_SUBMITTED", ref, message: "No airtime was delivered. Connect an operator API for real recharge." }); }
  catch (e: any) { if (e.message === "INSUFFICIENT_FUNDS") return res.status(400).json({ error: "Insufficient demo balance" }); next(e); }
});
router.post("/bills", async (req: AuthRequest, res, next) => {
  const parsed = z.object({ category: z.enum(["NEA_ELECTRICITY", "KHANEPANI", "INTERNET"]), customerRef: z.string().min(3).max(40), amount: amountSchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid bill details" });
  try { const ref = await debit(req.userId!, parsed.data.amount, `Demo bill: ${parsed.data.category} / ${parsed.data.customerRef}`); res.status(201).json({ status: "DEMO_SUBMITTED", ref, message: "Bill was not paid. Integrate the provider before real use." }); }
  catch (e: any) { if (e.message === "INSUFFICIENT_FUNDS") return res.status(400).json({ error: "Insufficient demo balance" }); next(e); }
});
router.post("/kyc", async (req: AuthRequest, res, next) => {
  const parsed = z.object({ fullName: z.string().min(3).max(100), dateOfBirth: z.string().min(8).max(20), documentType: z.enum(["CITIZENSHIP", "PASSPORT", "NATIONAL_ID"]), documentNumber: z.string().min(4).max(40), address: z.string().min(5).max(200) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Complete all KYC fields correctly" });
  try {
    const app = await prisma.kycApplication.upsert({ where: { userId: req.userId! }, create: { ...parsed.data, userId: req.userId! }, update: { ...parsed.data, status: "PENDING", reviewNote: null } });
    res.status(201).json({ status: app.status, message: "KYC submitted for demo review. Do not upload real identity documents to this prototype." });
  } catch (e) { next(e); }
});
router.get("/kyc", async (req: AuthRequest, res, next) => {
  try { const app = await prisma.kycApplication.findUnique({ where: { userId: req.userId! }, select: { fullName: true, documentType: true, status: true, reviewNote: true, createdAt: true } }); res.json({ application: app }); }
  catch (e) { next(e); }
});
export default router;
