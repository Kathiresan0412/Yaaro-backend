import { createHmac } from "node:crypto";

type TokenPayload = {
  sub: string;
  role: string;
  email: string | null;
  onboardingCompleted?: boolean;
  exp: number;
  iat: number;
};

function base64UrlEncode(value: object | string) {
  const input = typeof value === "string" ? value : JSON.stringify(value);

  return Buffer.from(input).toString("base64url");
}

export function createAccessToken(
  payload: Omit<TokenPayload, "exp" | "iat">,
  secret: string,
) {
  const now = Math.floor(Date.now() / 1000);
  const tokenPayload: TokenPayload = {
    ...payload,
    iat: now,
    exp: now + 60 * 60 * 24 * 7,
  };

  const header = base64UrlEncode({ alg: "HS256", typ: "JWT" });
  const body = base64UrlEncode(tokenPayload);
  const signature = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");

  return `${header}.${body}.${signature}`;
}

export function verifyAccessToken(token: string, secret: string) {
  try {
    const [header, body, signature] = token.split(".");

    if (!header || !body || !signature) {
      return null;
    }

    const expectedSignature = createHmac("sha256", secret)
      .update(`${header}.${body}`)
      .digest("base64url");

    if (signature !== expectedSignature) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;

    if (
      typeof payload.sub !== "string" ||
      typeof payload.exp !== "number" ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
