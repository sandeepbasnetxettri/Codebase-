import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
export interface AuthRequest extends Request { userId?: string }
export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as jwt.JwtPayload;
    if (!payload.sub) return res.status(401).json({ error: "Invalid session" });
    req.userId = payload.sub;
    next();
  } catch { return res.status(401).json({ error: "Authentication required" }); }
}
