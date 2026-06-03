import "dotenv/config";

// Helper to get active Stripe keys based on mode
function getStripeConfig() {
  const mode = (process.env.STRIPE_MODE ?? "sandbox") as "sandbox" | "production";
  const isSandbox = mode !== "production";

  return {
    mode,
    publishableKey: isSandbox
      ? process.env.STRIPE_PUBLISHABLE_KEY_SANDBOX ?? process.env.STRIPE_PUBLISHABLE_KEY ?? ""
      : process.env.STRIPE_PUBLISHABLE_KEY_PRODUCTION ?? "",
    secretKey: isSandbox
      ? process.env.STRIPE_SECRET_KEY_SANDBOX ?? process.env.STRIPE_SECRET_KEY ?? ""
      : process.env.STRIPE_SECRET_KEY_PRODUCTION ?? "",
    webhookSecret: isSandbox
      ? process.env.STRIPE_WEBHOOK_SECRET_SANDBOX ?? process.env.STRIPE_WEBHOOK_SECRET ?? ""
      : process.env.STRIPE_WEBHOOK_SECRET_PRODUCTION ?? "",
    pricePlus: isSandbox
      ? process.env.STRIPE_PRICE_PLUS_SANDBOX ?? process.env.STRIPE_PRICE_PLUS ?? ""
      : process.env.STRIPE_PRICE_PLUS_PRODUCTION ?? "",
    priceGold: isSandbox
      ? process.env.STRIPE_PRICE_GOLD_SANDBOX ?? process.env.STRIPE_PRICE_GOLD ?? ""
      : process.env.STRIPE_PRICE_GOLD_PRODUCTION ?? "",
    pricePlatinum: isSandbox
      ? process.env.STRIPE_PRICE_PLATINUM_SANDBOX ?? process.env.STRIPE_PRICE_PLATINUM ?? ""
      : process.env.STRIPE_PRICE_PLATINUM_PRODUCTION ?? "",
  };
}

const stripeConfig = getStripeConfig();

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 8000),
  databaseUrl: process.env.DATABASE_URL ?? "",
  databasePoolMax: Number(process.env.DATABASE_POOL_MAX ?? 1),
  jwtSecret: process.env.JWT_SECRET ?? "",
  adminJwtSecret: process.env.ADMIN_JWT_SECRET ?? process.env.JWT_SECRET ?? "",
  publicWebUrl: process.env.PUBLIC_WEB_URL ?? "http://localhost:3000",
  redisUrl: process.env.REDIS_URL ?? "",
  cdnUrl: process.env.CDN_URL ?? "",
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME ?? "",
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY ?? "",
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET ?? "",
  smtpHost: process.env.SMTP_HOST ?? "",
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpSecure: process.env.SMTP_SECURE === "true",
  smtpUser: process.env.SMTP_USER ?? "",
  smtpPassword: process.env.SMTP_PASSWORD ?? "",
  mailFrom: process.env.MAIL_FROM ?? process.env.SMTP_USER ?? "",
  moderationAdminEmail: process.env.MODERATION_ADMIN_EMAIL ?? process.env.MAIL_FROM ?? process.env.SMTP_USER ?? "",
  // Active Stripe keys (resolved from STRIPE_MODE at startup — see getStripeConfig above)
  stripeMode: stripeConfig.mode,
  stripePublishableKey: stripeConfig.publishableKey,
  stripeSecretKey: stripeConfig.secretKey,
  stripeWebhookSecret: stripeConfig.webhookSecret,
  stripePricePlus: stripeConfig.pricePlus,
  stripePriceGold: stripeConfig.priceGold,
  stripePricePlatinum: stripeConfig.pricePlatinum,
  sendgridApiKey: process.env.SENDGRID_API_KEY ?? "",
  sendgridFromEmail: process.env.SENDGRID_FROM_EMAIL ?? process.env.MAIL_FROM ?? process.env.SMTP_USER ?? "",
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? "",
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? "",
  vapidSubject: process.env.VAPID_SUBJECT ?? process.env.PUBLIC_WEB_URL ?? "mailto:admin@yaro0.com",
  spotifyClientId: process.env.SPOTIFY_CLIENT_ID ?? "",
  spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET ?? "",
  tiktokClientKey: process.env.TIKTOK_CLIENT_KEY ?? "",
  tiktokClientSecret: process.env.TIKTOK_CLIENT_SECRET ?? "",
};
