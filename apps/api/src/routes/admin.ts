import { Router } from "express";
import { z } from "zod";
import { prisma } from "../index";
import { AuthRequest, requireAuth } from "../middleware/auth";
const router = Router();
router.use(requireAuth);
router.use(async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { role: true } });
    if (user?.role !== "ADMIN") return res.status(403).json({ error: "Admin access required" });
    next();
  } catch (e) { next(e); }
});
router.get("/overview", async (_req, res, next) => {
  try {
    const [users, pendingKyc, payments] = await Promise.all([
      prisma.user.count(), prisma.kycApplication.count({ where: { status: "PENDING" } }),
      prisma.paymentRequest.count({ where: { status: "PENDING" } })
    ]);
    res.json({ users, pendingKyc, pendingQrPayments: payments, mode: "DEMO" });
  } catch (e) { next(e); }
});
router.get("/kyc", async (_req, res, next) => {
  try {
    const applications = await prisma.kycApplication.findMany({ include: { user: { select: { email: true, name: true } } }, orderBy: { createdAt: "asc" }, take: 100 });
    res.json({ applications });
  } catch (e) { next(e); }
});
router.patch("/kyc/:id", async (req, res, next) => {
  const parsed = z.object({ status: z.enum(["APPROVED", "REJECTED"]), reviewNote: z.string().max(300).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid review decision" });
  try {
    const application = await prisma.kycApplication.update({ where: { id: req.params.id }, data: parsed.data });
    res.json({ id: application.id, status: application.status });
  } catch (e) { next(e); }
});
router.get("/users", async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, createdAt: true, wallet: { select: { balancePaisa: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
    res.json({ users: users.map(u => ({ ...u, wallet: u.wallet ? { balancePaisa: u.wallet.balancePaisa.toString() } : null })) });
  } catch (e) { next(e); }
});
export default router;
