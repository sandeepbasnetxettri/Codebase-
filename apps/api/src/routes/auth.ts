import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../index";
const router = Router();
const base = z.object({
  email: z.string().trim().email().max(190).transform(v => v.toLowerCase()),
  password: z.string().min(10).max(72)
});
const tokenFor = (id: string) => jwt.sign({ sub: id }, process.env.JWT_SECRET!, { expiresIn: "20m" });
router.post("/register", async (req, res, next) => {
  try {
    const parsed = base.extend({ name: z.string().trim().min(2).max(70) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid registration details", details: parsed.error.flatten() });
    const { name, email, password } = parsed.data;
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        name, email, passwordHash,
        wallet: { create: { currency: "NPR", balancePaisa: 100000n } },
        sentEntries: { create: { transferRef: `WELCOME-${Date.now()}`, amountPaisa: 100000n, direction: "CREDIT", description: "Demo welcome credits" } }
      },
      select: { id: true, name: true, email: true, wallet: { select: { balancePaisa: true, currency: true } } }
    });
    res.status(201).json({ accessToken: tokenFor(user.id), user: { ...user, wallet: user.wallet ? { ...user.wallet, balancePaisa: user.wallet.balancePaisa.toString() } : null } });
  } catch (error: any) {
    if (error?.code === "P2002") return res.status(409).json({ error: "Email is already registered" });
    next(error);
  }
});
router.post("/login", async (req, res, next) => {
  try {
    const parsed = base.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid email or password" });
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email }, include: { wallet: true } });
    if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) return res.status(401).json({ error: "Email or password is incorrect" });
    res.json({ accessToken: tokenFor(user.id), user: { id: user.id, name: user.name, email: user.email, wallet: user.wallet ? { currency: user.wallet.currency, balancePaisa: user.wallet.balancePaisa.toString() } : null } });
  } catch (error) { next(error); }
});
export default router;
