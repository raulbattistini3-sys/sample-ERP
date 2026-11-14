import { Request, Response, NextFunction } from "express";

type PeerSocket = { authorized?: boolean; getPeerCertificate?: () => { subject?: { CN?: string } } | null };

// For service-to-service routes, which have no usuario: the caller must have presented, in the TLS
// handshake, a certificate signed by the internal CA (API_TLS_CA) whose CN is `cn` (billing, for
// /internal/billing). Browsers present none, so these routes are closed to them; without HTTPS nothing
// gets through at all.
export const requireClientCert = (cn: string) => (req: Request, res: Response, next: NextFunction) => {
  const socket = req.socket as unknown as PeerSocket;
  const peer = socket.authorized && typeof socket.getPeerCertificate === "function" ? socket.getPeerCertificate() : null;
  if (peer?.subject?.CN !== cn) {
    return res.status(401).json({ message: `Certificado de cliente inválido (esperado CN=${cn})`, status: "error" });
  }
  return next();
};
