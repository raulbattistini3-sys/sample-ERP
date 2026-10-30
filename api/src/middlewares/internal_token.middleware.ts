import { createHash, timingSafeEqual } from "crypto";
import { Request, Response, NextFunction } from "express";

const hash = (value: string) => createHash("sha256").update(value).digest();

// for service-to-service routes, which have no usuario. Without a configured token nothing gets through.
export const requireInternalToken = (expected: string | undefined) => (req: Request, res: Response, next: NextFunction) => {
  const received = req.headers.authorization?.replace(/^Bearer /, "");
  if (!expected || !received || !timingSafeEqual(hash(received), hash(expected))) {
    return res.status(401).json({ message: "Token interno inválido", status: "error" });
  }
  return next();
};
