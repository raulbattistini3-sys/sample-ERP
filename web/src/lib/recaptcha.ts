// reCAPTCHA v3, asked for by the network service (network/gateway/recaptcha.go): on the login, and for a
// client that flooded the gateway, it answers 428 { captcha: true, siteKey }. The api-client interceptor then
// gets a token here and repeats the request once with X-Recaptcha-Token. v3 is invisible: no puzzle, Google
// scores the visit and the gateway checks the score.

export const CAPTCHA_HEADER = "X-Recaptcha-Token";

type Grecaptcha = {
  ready(cb: () => void): void;
  execute(siteKey: string, options: { action: string }): Promise<string>;
};

declare global {
  interface Window {
    grecaptcha?: Grecaptcha;
  }
}

let carregando: Promise<Grecaptcha> | null = null;

function carregar(siteKey: string): Promise<Grecaptcha> {
  if (carregando) return carregando;
  carregando = new Promise<Grecaptcha>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
    script.async = true;
    script.onload = () => {
      const g = window.grecaptcha;
      if (!g) return reject(new Error("reCAPTCHA não carregou."));
      g.ready(() => resolve(g));
    };
    script.onerror = () => reject(new Error("Não foi possível carregar a verificação de segurança (reCAPTCHA)."));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    carregando = null; // let the next attempt try again
    throw error;
  });
  return carregando;
}

// the site key comes with the 428; /_network/config (same origin, the gateway) is the fallback
async function chaveDoSite(daResposta?: string): Promise<string> {
  if (daResposta) return daResposta;
  const res = await fetch("/_network/config");
  const { recaptchaSiteKey } = (await res.json()) as { recaptchaSiteKey?: string };
  if (!recaptchaSiteKey) throw new Error("Verificação de segurança indisponível.");
  return recaptchaSiteKey;
}

// actions are letters and underscores only: "POST /user/login" → "post_user_login"
export const acaoDe = (method = "get", url = "") =>
  `${method}_${url.split("?")[0]}`.toLowerCase().replace(/[^a-z_]/g, "_").replace(/_+/g, "_").slice(0, 100);

export async function tokenHumano(acao: string, siteKey?: string): Promise<string> {
  const chave = await chaveDoSite(siteKey);
  const g = await carregar(chave);
  return g.execute(chave, { action: acao });
}
