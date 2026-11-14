// Generates every secret the stack shares between its services, into this folder:
//
//   jwt_secret               JWT_SECRET: the API's HS256 signing key, made by jose's generateSecret("HS256")
//   network_token            NETWORK_TOKEN: api, billing and the importer <-> the network service
//                            (`bun run network-token` prints a fresh one without touching anything)
//   vault_token              VAULT_TOKEN: api -> vault (the vault only gets its SHA-256, VAULT_TOKEN_SHA256)
//   vault_admin_token        the token for the vault's POST /v1/keys/rotate (VAULT_ADMIN_TOKEN_SHA256)
//   vault_db_password        the password of the vault's own Postgres (vault-db in docker-compose.yml)
//   vault/kek-1.key          the vault's first key-encryption key (hex); `vault keys new` adds kek-2...
//   vault/index.key          the vault's blind-index HMAC key (hex). Never rotated by --force: losing it
//                            or the KEKs makes every vault record unreadable
//   secrets.env              the values above as KEY=value, the env_file docker-compose.yml loads
//   tls/ca.crt, ca.key       the private CA of every TLS link: api -> importer, api -> vault, api <-> billing
//                            (mutual TLS) and browser -> web / api (TLS 1.3; import ca.crt to trust it)
//   tls/importer.crt, .key   the importer's server certificate (also clientAuth, for its own healthcheck)
//   tls/vault.crt, .key      the vault's server certificate (also clientAuth, for its own healthcheck)
//   tls/billing.crt, .key    billing's certificate: server (api -> billing) and client (billing -> api)
//   tls/api.crt, api.key     the API's certificate: HTTPS server for the browser and billing, client to the
//                            importer, the vault and billing (names api, localhost, 127.0.0.1)
//   tls/web.crt, web.key     the web app's HTTPS certificate (nginx, vite dev)
//   tls/network.crt, .key    the network gateway's HTTPS certificate (NETWORK_TLS_CERT/KEY)
//
//   cd secrets && bun install && bun generate.ts             creates what is missing, keeps the rest
//   bun generate.ts --force                                  replaces everything but the vault keys
//   bun generate.ts --rotate jwt,network,vault,tls     replaces only those
//
// One random value per trust boundary: a leaked network token doesn't let anyone mint login tokens. The API
// and billing need no shared token: each one proves itself with its certificate (CN api / CN billing).
// The service tokens are the SHA-256 (hex) of 32 random bytes; JWT_SECRET is a 256-bit HS256 key.
// Nothing here is committed (.gitignore) or copied into an image (.dockerignore).
import "reflect-metadata";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, webcrypto } from "node:crypto";
import { exportJWK, generateSecret, jwtVerify, SignJWT } from "jose";
import * as x509 from "@peculiar/x509";

const crypto = webcrypto as unknown as Crypto;
x509.cryptoProvider.set(crypto);

const DIR = dirname(fileURLToPath(import.meta.url));
const TLS_DIR = join(DIR, "tls");
// the same claims the API puts in and checks (api/src/utils/helpers/token.util.ts)
const JWT_ISSUER = "sample-erp-api";
const JWT_AUDIENCE = "sample-erp-web";

// "vault" rotates the vault tokens and database password, never its keys (see the header)
type Grupo = "jwt" | "network" | "vault" | "tls";
const GRUPOS: Grupo[] = ["jwt", "network", "vault", "tls"];

const args = process.argv.slice(2);
const force = args.includes("--force");
const rotateArg = args[args.indexOf("--rotate") + 1];
const rotate = new Set<Grupo>(
  force ? GRUPOS : args.includes("--rotate") && rotateArg ? (rotateArg.split(",").filter((g) => GRUPOS.includes(g as Grupo)) as Grupo[]) : [],
);

const ler = (file: string) => (existsSync(join(DIR, file)) ? readFileSync(join(DIR, file), "utf8").trim() : "");

// directory 0700, files 0644: other users of the host can't reach them, and a container running as a
// different uid (distroless nonroot, node) can still read the ones mounted into it
const escrever = (path: string, body: string) => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, body, { mode: 0o644 });
  chmodSync(path, 0o644);
};

// JWT_SECRET through jose: an HS256 key, exported as a JWK whose "k" is its base64url bytes. The API
// signs with the UTF-8 bytes of this string, so the value works as-is in any .env.
const novoJwtSecret = async () => {
  const key = await generateSecret("HS256", { extractable: true });
  const { k } = await exportJWK(key);
  if (!k) throw new Error("jose returned an HS256 key without k");
  return k;
};

// service tokens: the SHA-256 of 32 random bytes, as 64 hex characters. Hex keeps it safe unquoted in any
// .env, header or connection string, and the verifiers compare SHA-256 digests in constant time.
// network-token.ts makes NETWORK_TOKEN the same way.
export const novoToken = async () => {
  const digest = await crypto.subtle.digest("SHA-256", crypto.getRandomValues(new Uint8Array(32)));
  return Buffer.from(digest).toString("hex");
};

// proves the key round-trips with the API's settings before anything is written
const conferirJwt = async (secret: string) => {
  const key = new TextEncoder().encode(secret);
  const token = await new SignJWT({ ver: 0 })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject("generate-ts-self-test")
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
  await jwtVerify(token, key, { algorithms: ["HS256"], issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
};

const segredo = async (grupo: Grupo, file: string, gerar: () => string | Promise<string>) => {
  const atual = ler(file);
  if (atual && !rotate.has(grupo)) return { valor: atual, novo: false };
  const valor = await gerar();
  escrever(join(DIR, file), valor);
  return { valor, novo: true };
};

// --- mutual TLS between the API (client) and the importer (server) ---

const EC: EcKeyGenParams & EcdsaParams = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" };
const DIA = 24 * 60 * 60 * 1000;

const pemChave = async (key: CryptoKey) => {
  const der = Buffer.from(await crypto.subtle.exportKey("pkcs8", key)).toString("base64");
  return `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
};

const serial = () => Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex").replace(/^[89a-f]/, "1");

const gerarTls = async () => {
  const agora = new Date(Date.now() - 5 * 60 * 1000); // a little clock skew between containers
  const caKeys = (await crypto.subtle.generateKey(EC, true, ["sign", "verify"])) as CryptoKeyPair;
  const ca = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: serial(),
    name: "CN=sample-erp internal mTLS CA",
    notBefore: agora,
    notAfter: new Date(agora.getTime() + 3650 * DIA),
    keys: caKeys,
    signingAlgorithm: EC,
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true),
      await x509.SubjectKeyIdentifierExtension.create(caKeys.publicKey),
    ],
  });

  const folha = async (cn: string, usos: string[], sans: { type: "dns" | "ip"; value: string }[]) => {
    const keys = (await crypto.subtle.generateKey(EC, true, ["sign", "verify"])) as CryptoKeyPair;
    const extensions: x509.Extension[] = [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
      new x509.ExtendedKeyUsageExtension(usos, false),
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
      await x509.AuthorityKeyIdentifierExtension.create(caKeys.publicKey),
    ];
    if (sans.length) extensions.push(new x509.SubjectAlternativeNameExtension(sans, false));
    const cert = await x509.X509CertificateGenerator.create({
      serialNumber: serial(),
      subject: `CN=${cn}`,
      issuer: ca.subject,
      notBefore: agora,
      notAfter: new Date(agora.getTime() + 825 * DIA),
      publicKey: keys.publicKey,
      signingKey: caKeys.privateKey,
      signingAlgorithm: EC,
      extensions,
    });
    return { cert: cert.toString("pem") + "\n", key: await pemChave(keys.privateKey) };
  };

  // the names the API dials: importer:50051 in compose, 127.0.0.1 from the launcher or a local run
  const importer = await folha("importer", [x509.ExtendedKeyUsage.serverAuth, x509.ExtendedKeyUsage.clientAuth], [
    { type: "dns", value: "importer" },
    { type: "dns", value: "localhost" },
    { type: "ip", value: "127.0.0.1" },
  ]);
  // the vault: vault:8200 in compose, 127.0.0.1 from the launcher
  const vault = await folha("vault", [x509.ExtendedKeyUsage.serverAuth, x509.ExtendedKeyUsage.clientAuth], [
    { type: "dns", value: "vault" },
    { type: "dns", value: "localhost" },
    { type: "ip", value: "127.0.0.1" },
  ]);
  // billing: billing:8081 in compose, 127.0.0.1 locally; also the client of its notifications to the API
  const billing = await folha("billing", [x509.ExtendedKeyUsage.serverAuth, x509.ExtendedKeyUsage.clientAuth], [
    { type: "dns", value: "billing" },
    { type: "dns", value: "localhost" },
    { type: "ip", value: "127.0.0.1" },
  ]);
  // the API: a server to the browser (localhost:3333) and billing (api:3333), a client to everyone else
  const api = await folha("api", [x509.ExtendedKeyUsage.serverAuth, x509.ExtendedKeyUsage.clientAuth], [
    { type: "dns", value: "api" },
    { type: "dns", value: "localhost" },
    { type: "ip", value: "127.0.0.1" },
  ]);
  // the page the browser opens: nginx in compose, vite in development
  const web = await folha("web", [x509.ExtendedKeyUsage.serverAuth], [
    { type: "dns", value: "web" },
    { type: "dns", value: "localhost" },
    { type: "ip", value: "127.0.0.1" },
  ]);

  // the network gateway in front of the browser (and the registry's name inside compose)
  const network = await folha("network", [x509.ExtendedKeyUsage.serverAuth], [
    { type: "dns", value: "network" },
    { type: "dns", value: "localhost" },
    { type: "ip", value: "127.0.0.1" },
  ]);

  escrever(join(TLS_DIR, "ca.crt"), ca.toString("pem") + "\n");
  escrever(join(TLS_DIR, "ca.key"), await pemChave(caKeys.privateKey));
  escrever(join(TLS_DIR, "importer.crt"), importer.cert);
  escrever(join(TLS_DIR, "importer.key"), importer.key);
  escrever(join(TLS_DIR, "vault.crt"), vault.cert);
  escrever(join(TLS_DIR, "vault.key"), vault.key);
  escrever(join(TLS_DIR, "api.crt"), api.cert);
  escrever(join(TLS_DIR, "api.key"), api.key);
  escrever(join(TLS_DIR, "billing.crt"), billing.cert);
  escrever(join(TLS_DIR, "billing.key"), billing.key);
  escrever(join(TLS_DIR, "web.crt"), web.cert);
  escrever(join(TLS_DIR, "web.key"), web.key);
  escrever(join(TLS_DIR, "network.crt"), network.cert);
  escrever(join(TLS_DIR, "network.key"), network.key);
};

const sha256Hex = (v: string) => createHash("sha256").update(v).digest("hex");

// the vault's keys: created once, kept forever (only `vault keys new` + POST /v1/keys/rotate change them)
const chaveVault = (file: string) => {
  const path = join(DIR, "vault", file);
  if (existsSync(path)) return false;
  escrever(path, Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex") + "\n");
  return true;
};

const main = async () => {
  const jwt = await segredo("jwt", "jwt_secret", novoJwtSecret);
  await conferirJwt(jwt.valor);
  const network = await segredo("network", "network_token", novoToken);
  const vaultToken = await segredo("vault", "vault_token", novoToken);
  const vaultAdmin = await segredo("vault", "vault_admin_token", novoToken);
  const vaultDb = await segredo("vault", "vault_db_password", novoToken);
  const temKek = existsSync(join(DIR, "vault")) && readdirSync(join(DIR, "vault")).some((f) => /^kek-\d+\.key$/.test(f));
  const kekNova = temKek ? false : chaveVault("kek-1.key");
  const indexNova = chaveVault("index.key");

  escrever(
    join(DIR, "secrets.env"),
    [
      "# Generated by secrets/generate.ts; docker-compose.yml loads it after api/.env and billing/.env, so",
      "# these win. Copy the values into api/.env, billing/.env and vault/.env to run the services outside Docker.",
      `JWT_SECRET=${jwt.valor}`,
      `NETWORK_TOKEN=${network.valor}`,
      `VAULT_TOKEN=${vaultToken.valor}`,
      `VAULT_TOKEN_SHA256=${sha256Hex(vaultToken.valor)}`,
      `VAULT_ADMIN_TOKEN_SHA256=${sha256Hex(vaultAdmin.valor)}`,
      `VAULT_DB_PASSWORD=${vaultDb.valor}`,
      "",
    ].join("\n"),
  );

  const tlsExiste = ["ca.crt", "importer.crt", "importer.key", "vault.crt", "vault.key", "api.crt", "api.key", "billing.crt", "billing.key", "web.crt", "web.key", "network.crt", "network.key"].every((f) => existsSync(join(TLS_DIR, f)));
  const tlsNovo = !tlsExiste || rotate.has("tls");
  if (tlsNovo) await gerarTls();

  const linha = (nome: string, novo: boolean) => console.log(`  ${novo ? "created" : "kept   "}  ${nome}`);
  console.log(`secrets in ${DIR}`);
  linha("jwt_secret (JWT_SECRET, HS256 via jose)", jwt.novo);
  linha("network_token (NETWORK_TOKEN)", network.novo);
  linha("vault_token, vault_admin_token, vault_db_password", vaultToken.novo || vaultAdmin.novo || vaultDb.novo);
  linha("vault/kek-1.key, vault/index.key (never rotated here)", kekNova || indexNova);
  linha("tls/ (mutual TLS api <-> importer, vault, billing; HTTPS for web, api and the network gateway)", tlsNovo);
  if (tlsNovo) console.log("  note: new certificates; trust tls/ca.crt in the browser (README, \"Trusting the local CA\")");
  if (jwt.novo && rotate.has("jwt")) console.log("  note: the new JWT_SECRET signs everyone out");
};

// only when run, not when network-token.ts imports novoToken
if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
