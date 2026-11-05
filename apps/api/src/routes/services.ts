import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { prisma } from "../index";
import { AuthRequest, requireAuth } from "../middleware/auth";
import { checkEsewaStatus, createEsewaForm, decodeAndVerifyEsewaResponse, getEsewaProductCode } from "../payments/esewa";
const router = Router();

function paisaToAmount(paisa: bigint) {
  return `${paisa / 100n}.${String(paisa % 100n).padStart(2, "0")}`;
}

// Public eSewa return URL. A browser redirect is not trusted as payment proof:
// verify the signed payload and independently query eSewa's status API.
router.get("/esewa/success", async (req, res) => {
  try {
    const encoded = typeof req.query.data === "string" ? req.query.data : "";
    if (!encoded) return res.status(400).send("Missing eSewa response data");
    const response = decodeAndVerifyEsewaResponse(encoded);
    const payment = await prisma.esewaPayment.findUnique({ where: { transactionUuid: response.transaction_uuid } });
    if (!payment) return res.status(404).send("Payment reference not found");
    if (response.product_code !== payment.productCode || response.product_code !== getEsewaProductCode() ||
        Math.round(Number(response.total_amount) * 100) !== Number(payment.amountPaisa)) {
      return res.status(400).send("eSewa response does not match the stored payment");
    }
    const verified = await checkEsewaStatus({ transactionUuid: payment.transactionUuid, totalAmount: paisaToAmount(payment.amountPaisa) });
    if (verified.status === "COMPLETE") {
      await prisma.esewaPayment.updateMany({
        where: { id: payment.id, status: "PENDING" },
        data: { status: "COMPLETE", providerRef: verified.refId || response.transaction_code || null }
      });
      return res.status(200).send("eSewa payment verified. You may return to the app and refresh payment status.");
    }
    await prisma.esewaPayment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: verified.status } });
    return res.status(200).send(`eSewa payment status: ${verified.status}`);
  } catch (error) {
    console.error("eSewa success verification failed", error);
    return res.status(400).send("Could not verify eSewa payment. Contact support with your transaction reference.");
  }
});

router.get("/esewa/failure", (_req, res) => res.status(200).send("eSewa payment was cancelled, failed, or is still pending. Check the payment status in the app."));


router.get("/esewa/checkout/:transactionUuid", async (req, res) => {
  try {
    const payment = await prisma.esewaPayment.findUnique({ where: { transactionUuid: req.params.transactionUuid } });
    if (!payment || payment.status !== "PENDING") return res.status(404).send("Pending eSewa payment not found");
    const checkout = createEsewaForm({ amount: paisaToAmount(payment.amountPaisa), transactionUuid: payment.transactionUuid });
    const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const inputs = Object.entries(checkout.fields).map(([name, value]) =>
      `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`
    ).join("");
    res.setHeader("Cache-Control", "no-store");
    res.type("html").send(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Continue to eSewa</title></head><body style="font-family:system-ui;max-width:480px;margin:48px auto;padding:20px"><h2>Continue to eSewa</h2><p>Amount: NPR ${paisaToAmount(payment.amountPaisa)}</p><p>Transaction: ${escapeHtml(payment.transactionUuid)}</p><form method="POST" action="${checkout.actionUrl}">${inputs}<button style="padding:14px 22px;background:#087d55;color:white;border:0;border-radius:8px;font-size:16px">Pay with eSewa</button></form><p>After payment, return to the app and check the transaction status.</p></body></html>`);
  } catch (error) {
    console.error("eSewa checkout page failed", error);
    res.status(500).send("Could not prepare eSewa checkout");
  }
});

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


router.post("/esewa/initiate", async (req: AuthRequest, res, next) => {
  const parsed = z.object({ amount: amountSchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid payment amount (maximum NPR 50,000)." });
  try {
    const amountPaisa = BigInt(Math.round(parsed.data.amount * 100));
    const transactionUuid = randomUUID();
    const productCode = getEsewaProductCode();
    const payment = await prisma.esewaPayment.create({
      data: { userId: req.userId!, transactionUuid, amountPaisa, productCode }
    });
    const checkout = createEsewaForm({ amount: paisaToAmount(amountPaisa), transactionUuid });
    res.status(201).json({
      paymentId: payment.id,
      transactionUuid,
      amount: paisaToAmount(amountPaisa),
      status: payment.status,
      actionUrl: checkout.actionUrl,
      method: "POST",
      fields: checkout.fields,
      message: "Submit these form fields to eSewa checkout. Payment remains pending until server-side verification."
    });
  } catch (error) { next(error); }
});

router.get("/esewa/status/:transactionUuid", async (req: AuthRequest, res, next) => {
  try {
    const payment = await prisma.esewaPayment.findFirst({
      where: { transactionUuid: req.params.transactionUuid, userId: req.userId! }
    });
    if (!payment) return res.status(404).json({ error: "Payment not found" });
    if (payment.status === "PENDING") {
      const verified = await checkEsewaStatus({
        transactionUuid: payment.transactionUuid,
        totalAmount: paisaToAmount(payment.amountPaisa)
      });
      const nextStatus = verified.status;
      if (["COMPLETE", "PENDING", "FULL_REFUND", "PARTIAL_REFUND", "AMBIGUOUS", "NOT_FOUND", "CANCELED"].includes(nextStatus)) {
        await prisma.esewaPayment.updateMany({
          where: { id: payment.id, status: "PENDING" },
          data: { status: nextStatus, providerRef: verified.refId || null }
        });
      }
    }
    const latest = await prisma.esewaPayment.findUnique({ where: { id: payment.id } });
    res.json({
      transactionUuid: payment.transactionUuid,
      amount: paisaToAmount(payment.amountPaisa),
      status: latest?.status || payment.status,
      providerReference: latest?.providerRef || null,
      note: "This records merchant checkout status only; it does not credit a regulated wallet balance."
    });
  } catch (error) { next(error); }
});

router.post("/cash-in", async (req: AuthRequest, res, next) => {
 const p=z.object({amount:amountSchema,method:z.enum(["BANK_TRANSFER","COUNTER_DEPOSIT"]),reference:z.string().max(80).optional()}).safeParse(req.body);
 if(!p.success)return res.status(400).json({error:"Invalid cash-in request"});
 try{const amountPaisa=BigInt(Math.round(p.data.amount*100));const item=await prisma.cashRequest.create({data:{userId:req.userId!,type:"CASH_IN",amountPaisa,method:p.data.method,reference:p.data.reference}});
 if(p.data.amount>=100000)await prisma.amlCase.create({data:{userId:req.userId!,reason:"High-value cash-in request",riskLevel:"HIGH",details:"Manual review required"}});
 res.status(201).json({id:item.id,status:item.status,message:"Queued for review. No funds credited."});}catch(e){next(e);}
});
router.post("/cash-out", async (req: AuthRequest, res, next) => {
 const p=z.object({amount:amountSchema,method:z.enum(["BANK_TRANSFER","COUNTER_PICKUP"]),destination:z.string().min(4).max(120)}).safeParse(req.body);
 if(!p.success)return res.status(400).json({error:"Invalid cash-out request"});
 try{const amountPaisa=BigInt(Math.round(p.data.amount*100));const w=await prisma.wallet.findUnique({where:{userId:req.userId!}});
 if(!w||w.balancePaisa<amountPaisa)return res.status(400).json({error:"Insufficient demo balance"});
 const item=await prisma.cashRequest.create({data:{userId:req.userId!,type:"CASH_OUT",amountPaisa,method:p.data.method,reference:p.data.destination}});
 if(p.data.amount>=100000)await prisma.amlCase.create({data:{userId:req.userId!,reason:"High-value cash-out request",riskLevel:"HIGH",details:"Manual review required"}});
 res.status(201).json({id:item.id,status:item.status,message:"Queued for review. No cash is disbursed."});}catch(e){next(e);}
});
router.get("/cash-requests",async(req:AuthRequest,res,next)=>{try{const items=await prisma.cashRequest.findMany({where:{userId:req.userId!},orderBy:{createdAt:"desc"},take:30});res.json({requests:items.map(x=>({...x,amountPaisa:x.amountPaisa.toString()}))});}catch(e){next(e);}});

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
      const claimed = await tx.paymentRequest.updateMany({ where: { id: request.id, status: "PENDING", expiresAt: { gt: new Date() } }, data: { status: "PROCESSING" } });
      if (claimed.count !== 1) throw new Error("QR_UNAVAILABLE");
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
  } catch (e: any) { if (e.message === "INSUFFICIENT_FUNDS") return res.status(400).json({ error: "Insufficient demo balance" }); if (e.message === "QR_UNAVAILABLE") return res.status(409).json({ error: "QR request was already paid or expired" }); next(e); }
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
