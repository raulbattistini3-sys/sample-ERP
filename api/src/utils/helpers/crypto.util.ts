import "dotenv/config";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// AES-256-GCM for secrets kept in the database (integration tokens). The key is 32 random bytes,
// base64, in INTEGRATIONS_ENCRYPTION_KEY; generate one with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// Stored format: v1:<iv>:<auth tag>:<ciphertext>, all base64.
const VERSION = "v1";

const encryptionKey = () => {
  const raw = process.env.INTEGRATIONS_ENCRYPTION_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
};

export const encryptionConfigured = () => encryptionKey() !== null;

export function encryptSecret(plain: string): string {
  const key = encryptionKey();
  if (!key) throw new Error("INTEGRATIONS_ENCRYPTION_KEY ausente ou inválida (32 bytes em base64)");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(":");
}

// throws if the payload was tampered with or encrypted with another key
export function decryptSecret(payload: string): string {
  const key = encryptionKey();
  if (!key) throw new Error("INTEGRATIONS_ENCRYPTION_KEY ausente ou inválida (32 bytes em base64)");
  const [version, iv, tag, ciphertext] = payload.split(":");
  if (version !== VERSION || !iv || !tag || !ciphertext) throw new Error("segredo cifrado em formato desconhecido");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
}
