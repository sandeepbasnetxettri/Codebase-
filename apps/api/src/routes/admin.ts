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

router.get("/cash-requests",async(_req,res,next)=>{try{const items=await prisma.cashRequest.findMany({include:{user:{select:{name:true,email:true}}},orderBy:{createdAt:"asc"},take:100});res.json({requests:items.map(x=>({...x,amountPaisa:x.amountPaisa.toString()}))});}catch(e){next(e);}});
router.patch("/cash-requests/:id",async(req:AuthRequest,res,next)=>{
 const p=z.object({status:z.enum(["APPROVED","REJECTED"]),reviewNote:z.string().max(300).optional()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid decision"});
 try{const item=await prisma.$transaction(async tx=>{const x=await tx.cashRequest.findUnique({where:{id:req.params.id}});if(!x||x.status!=="PENDING")throw new Error("NOT_PENDING");
 if(p.data.status==="APPROVED"&&x.type==="CASH_IN"){await tx.wallet.update({where:{userId:x.userId},data:{balancePaisa:{increment:x.amountPaisa}}});await tx.ledgerEntry.create({data:{transferRef:"CASHIN-"+x.id,userId:x.userId,amountPaisa:x.amountPaisa,direction:"CREDIT",description:"Admin-approved demo cash-in"}});}
 if(p.data.status==="APPROVED"&&x.type==="CASH_OUT"){const w=await tx.wallet.findUnique({where:{userId:x.userId}});if(!w||w.balancePaisa<x.amountPaisa)throw new Error("NO_BALANCE");await tx.wallet.update({where:{userId:x.userId},data:{balancePaisa:{decrement:x.amountPaisa}}});await tx.ledgerEntry.create({data:{transferRef:"CASHOUT-"+x.id,userId:x.userId,amountPaisa:x.amountPaisa,direction:"DEBIT",description:"Admin-approved demo cash-out"}});}
 const updated=await tx.cashRequest.update({where:{id:x.id},data:p.data});await tx.auditEvent.create({data:{actorId:req.userId!,action:"REVIEW_CASH_REQUEST",targetType:"CashRequest",targetId:x.id,details:p.data.status}});return updated;});
 res.json({id:item.id,status:item.status});}catch(e:any){if(e.message==="NOT_PENDING")return res.status(409).json({error:"Already reviewed"});if(e.message==="NO_BALANCE")return res.status(400).json({error:"Insufficient balance"});next(e);}
});
router.get("/aml-cases",async(_req,res,next)=>{try{res.json({cases:await prisma.amlCase.findMany({include:{user:{select:{name:true,email:true}}},orderBy:{createdAt:"asc"},take:100})});}catch(e){next(e);}});
router.patch("/aml-cases/:id",async(req:AuthRequest,res,next)=>{const p=z.object({status:z.enum(["UNDER_REVIEW","CLEARED","ESCALATED"]),details:z.string().max(500).optional()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid AML update"});try{const x=await prisma.amlCase.update({where:{id:req.params.id},data:p.data});await prisma.auditEvent.create({data:{actorId:req.userId!,action:"UPDATE_AML_CASE",targetType:"AmlCase",targetId:x.id,details:p.data.status}});res.json({id:x.id,status:x.status});}catch(e){next(e);}});
router.patch("/users/:id/status",async(req:AuthRequest,res,next)=>{const p=z.object({status:z.enum(["ACTIVE","SUSPENDED","FROZEN"])}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid status"});if(req.params.id===req.userId)return res.status(400).json({error:"Cannot change your own status"});try{const u=await prisma.user.update({where:{id:req.params.id},data:{status:p.data.status},select:{id:true,status:true}});await prisma.auditEvent.create({data:{actorId:req.userId!,action:"CHANGE_USER_STATUS",targetType:"User",targetId:u.id,details:u.status}});res.json(u);}catch(e){next(e);}});
router.get("/audit",async(_req,res,next)=>{try{res.json({events:await prisma.auditEvent.findMany({include:{actor:{select:{name:true,email:true}}},orderBy:{createdAt:"desc"},take:100})});}catch(e){next(e);}});

router.get("/users", async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, createdAt: true, wallet: { select: { balancePaisa: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
    res.json({ users: users.map(u => ({ ...u, wallet: u.wallet ? { balancePaisa: u.wallet.balancePaisa.toString() } : null })) });
  } catch (e) { next(e); }
});
export default router;
