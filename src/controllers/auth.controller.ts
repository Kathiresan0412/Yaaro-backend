import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import nodemailer from "nodemailer";
import { env } from "../config/env";
import { prisma } from "../config/database";
import { hashPassword, verifyPassword } from "../utils/password";
import { createAccessToken } from "../utils/token";

const accessCookie = "yaaro0_access";
const refreshCookie = "yaaro0_refresh";
const refreshDays = 30;

type GenderInput = "male" | "female" | "non_binary" | "other";

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown) {
  return cleanText(value).toLowerCase();
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isStrongPassword(value: string) {
  return /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(value);
}

function isAdult(dateValue: string) {
  const birthDate = new Date(`${dateValue}T00:00:00.000Z`);

  if (Number.isNaN(birthDate.getTime())) {
    return false;
  }

  const today = new Date();
  const age = today.getUTCFullYear() - birthDate.getUTCFullYear();
  const birthdayThisYear = new Date(Date.UTC(today.getUTCFullYear(), birthDate.getUTCMonth(), birthDate.getUTCDate()));
  const hasHadBirthday = today.getTime() >= birthdayThisYear.getTime();

  return age > 18 || (age === 18 && hasHadBirthday);
}

function randomToken() {
  return randomBytes(32).toString("base64url");
}

function expiresIn(minutes: number) {
  return new Date(Date.now() + minutes * 60 * 1000);
}

function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  const secure = env.nodeEnv === "production";

  res.cookie(accessCookie, accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: 15 * 60 * 1000,
    path: "/",
  });
  res.cookie(refreshCookie, refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: refreshDays * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

function clearAuthCookies(res: Response) {
  res.clearCookie(accessCookie, { path: "/" });
  res.clearCookie(refreshCookie, { path: "/" });
}

function getCookie(req: Request, name: string) {
  const cookieHeader = req.headers.cookie;

  if (!cookieHeader) {
    return "";
  }

  const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));

  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

function publicUser(user: {
  id: bigint;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  emailVerified: boolean;
  onboardingCompleted: boolean;
  role: string;
}) {
  return {
    id: user.id.toString(),
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    emailVerified: user.emailVerified,
    onboardingCompleted: user.onboardingCompleted,
    role: user.role,
  };
}

async function createSession(user: {
  id: bigint;
  email: string | null;
  role: string;
  onboardingCompleted: boolean;
}) {
  if (!env.jwtSecret) {
    throw new Error("JWT_SECRET is not configured.");
  }

  const refreshToken = randomToken();
  const accessToken = createAccessToken(
    {
      sub: user.id.toString(),
      role: user.role,
      email: user.email,
      onboardingCompleted: user.onboardingCompleted,
    },
    env.jwtSecret,
  );

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      token: refreshToken,
      expiresAt: new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000),
    },
  });

  return { accessToken, refreshToken };
}

async function sendAccountEmail(kind: "verify" | "reset", email: string, url: string) {
  const label = kind === "verify" ? "Verify email" : "Reset password";
  const subject = kind === "verify" ? "Verify your Yaro0 email" : "Reset your Yaro0 password";
  const action = kind === "verify" ? "verify your email" : "reset your password";

  if (!env.smtpHost || !env.smtpUser || !env.smtpPassword || !env.mailFrom) {
    console.log(`[mail:${kind}] SMTP is not configured. ${label} for ${email}: ${url}`);
    return { sent: false, reason: "smtp-not-configured" as const };
  }

  const transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: {
      user: env.smtpUser,
      pass: env.smtpPassword,
    },
  });

  await transporter.sendMail({
    from: env.mailFrom,
    to: email,
    subject,
    text: `Use this link to ${action}: ${url}`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
        <h1 style="font-size:22px;margin:0 0 12px">${subject}</h1>
        <p>Use the button below to ${action}.</p>
        <p>
          <a href="${url}" style="display:inline-block;background:#ea6f61;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700">
            ${label}
          </a>
        </p>
        <p>If the button does not work, open this link:</p>
        <p><a href="${url}">${url}</a></p>
      </div>
    `,
  });

  return { sent: true, reason: null };
}

export async function register(req: Request, res: Response) {
  const firstName = cleanText(req.body.firstName);
  const lastName = cleanText(req.body.lastName);
  const email = normalizeEmail(req.body.email);
  const password = cleanText(req.body.password);
  const dateOfBirth = cleanText(req.body.dateOfBirth);
  const gender = cleanText(req.body.gender) as GenderInput;

  if (!firstName || !lastName || !email || !password || !dateOfBirth || !gender) {
    return res.status(400).json({ success: false, message: "Complete all required fields." });
  }

  if (!isEmail(email)) {
    return res.status(400).json({ success: false, message: "Enter a valid email address." });
  }

  if (!isStrongPassword(password)) {
    return res.status(400).json({
      success: false,
      message: "Password must be 8+ characters with uppercase, number, and special character.",
    });
  }

  if (!isAdult(dateOfBirth)) {
    return res.status(400).json({ success: false, message: "You must be at least 18 years old." });
  }

  if (!["male", "female", "non_binary", "other"].includes(gender)) {
    return res.status(400).json({ success: false, message: "Choose a valid gender." });
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    return res.status(409).json({ success: false, message: "Email is already registered." });
  }

  const emailVerifyToken = randomToken();
  const user = await prisma.user.create({
    data: {
      email,
      firstName,
      lastName,
      passwordHash: hashPassword(password),
      passwordUpdatedAt: new Date(),
      emailVerifyToken,
      emailVerifyTokenExpires: expiresIn(24 * 60),
      profile: {
        create: {
          nameEn: `${firstName} ${lastName}`,
          gender,
          dateOfBirth: new Date(`${dateOfBirth}T00:00:00.000Z`),
        },
      },
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      emailVerified: true,
      onboardingCompleted: true,
      role: true,
    },
  });

  const verifyUrl = `${env.publicWebUrl}/verify-email/${emailVerifyToken}`;
  const emailResult = await sendAccountEmail("verify", email, verifyUrl);

  return res.status(201).json({
    success: true,
    message: emailResult.sent
      ? "Account created. Check your email to verify your account."
      : "Account created, but email sending is not configured. Use the verification link shown in the API response while developing.",
    user: publicUser(user),
    verificationToken: env.nodeEnv === "production" ? undefined : emailVerifyToken,
    verificationUrl: env.nodeEnv === "production" ? undefined : verifyUrl,
  });
}

export async function verifyEmail(req: Request, res: Response) {
  const token = cleanText(req.params.token);

  if (!token) {
    return res.status(400).json({ success: false, message: "Verification token is required." });
  }

  const user = await prisma.user.findUnique({ where: { emailVerifyToken: token } });

  if (!user || !user.emailVerifyTokenExpires || user.emailVerifyTokenExpires < new Date()) {
    return res.status(400).json({ success: false, message: "Verification link is invalid or expired." });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified: true,
      emailVerifyToken: null,
      emailVerifyTokenExpires: null,
    },
  });

  return res.json({ success: true, message: "Email verified. You can now log in." });
}

export async function login(req: Request, res: Response) {
  const email = normalizeEmail(req.body.email);
  const password = typeof req.body.password === "string" ? req.body.password : "";

  if (!email || !isEmail(email) || !password) {
    return res.status(400).json({ success: false, message: "Email and password are required." });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      emailVerified: true,
      onboardingCompleted: true,
      role: true,
      passwordHash: true,
      isActive: true,
      isBanned: true,
      status: true,
    },
  });

  if (
    !user ||
    !user.passwordHash ||
    !user.isActive ||
    user.isBanned ||
    user.status !== "active" ||
    !verifyPassword(password, user.passwordHash)
  ) {
    return res.status(401).json({ success: false, message: "Invalid email or password." });
  }

  if (!user.emailVerified) {
    return res.status(403).json({ success: false, message: "Verify your email before logging in." });
  }

  const session = await createSession(user);
  setAuthCookies(res, session.accessToken, session.refreshToken);

  await prisma.user.update({
    where: { id: user.id },
    data: { lastActiveAt: new Date(), lastSeenAt: new Date() },
  });

  return res.json({
    success: true,
    message: "Logged in successfully.",
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    user: publicUser(user),
    redirectTo: user.onboardingCompleted ? "/app/discover" : "/onboarding",
  });
}

export async function logout(req: Request, res: Response) {
  const token = cleanText(req.body.refreshToken) || getCookie(req, refreshCookie);

  if (token) {
    await prisma.refreshToken.deleteMany({ where: { token } });
  }

  clearAuthCookies(res);
  return res.json({ success: true, message: "Logged out successfully." });
}

export async function refresh(req: Request, res: Response) {
  const token = cleanText(req.body.refreshToken) || getCookie(req, refreshCookie);

  if (!token) {
    return res.status(401).json({ success: false, message: "Refresh token is required." });
  }

  const storedToken = await prisma.refreshToken.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!storedToken || storedToken.expiresAt < new Date() || storedToken.user.status !== "active") {
    return res.status(401).json({ success: false, message: "Refresh token is invalid or expired." });
  }

  const deleted = await prisma.refreshToken.deleteMany({ where: { id: storedToken.id } });

  if (deleted.count === 0) {
    clearAuthCookies(res);
    return res.status(401).json({ success: false, message: "Refresh token is invalid or expired." });
  }

  const session = await createSession(storedToken.user);
  setAuthCookies(res, session.accessToken, session.refreshToken);

  return res.json({
    success: true,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    user: publicUser(storedToken.user),
  });
}

export async function forgotPassword(req: Request, res: Response) {
  const email = normalizeEmail(req.body.email);

  if (!email || !isEmail(email)) {
    return res.status(400).json({ success: false, message: "Enter a valid email address." });
  }

  const user = await prisma.user.findUnique({ where: { email } });

  if (user) {
    const token = randomToken();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordToken: token,
        resetTokenExpires: expiresIn(15),
      },
    });

    const resetUrl = `${env.publicWebUrl}/reset-password/${token}`;
    await sendAccountEmail("reset", email, resetUrl);
  }

  return res.json({ success: true, message: "If that email exists, a password reset link has been sent." });
}

export async function resetPassword(req: Request, res: Response) {
  const token = cleanText(req.params.token || req.body.token);
  const password = typeof req.body.password === "string" ? req.body.password : "";

  if (!token) {
    return res.status(400).json({ success: false, message: "Reset token is required." });
  }

  if (!isStrongPassword(password)) {
    return res.status(400).json({
      success: false,
      message: "Password must be 8+ characters with uppercase, number, and special character.",
    });
  }

  const user = await prisma.user.findUnique({ where: { resetPasswordToken: token } });

  if (!user || !user.resetTokenExpires || user.resetTokenExpires < new Date()) {
    return res.status(400).json({ success: false, message: "Reset link is invalid or expired." });
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: hashPassword(password),
        passwordUpdatedAt: new Date(),
        resetPasswordToken: null,
        resetTokenExpires: null,
      },
    }),
    prisma.refreshToken.deleteMany({ where: { userId: user.id } }),
  ]);

  return res.json({ success: true, message: "Your password has been updated." });
}

export async function oauthLogin(req: Request, res: Response) {
  const provider = cleanText(req.params.provider);

  if (!["google", "facebook"].includes(provider)) {
    return res.status(400).json({ success: false, message: "Unsupported OAuth provider." });
  }

  const email = normalizeEmail(req.body.email);
  const oauthId = cleanText(req.body.oauthId);
  const firstName = cleanText(req.body.firstName) || "Yaaro0";
  const lastName = cleanText(req.body.lastName) || "Member";

  if (!email || !isEmail(email) || !oauthId) {
    return res.status(400).json({
      success: false,
      message: "OAuth email and provider id are required.",
    });
  }

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      oauthProvider: provider,
      oauthId,
      emailVerified: true,
      lastActiveAt: new Date(),
    },
    create: {
      email,
      firstName,
      lastName,
      oauthProvider: provider,
      oauthId,
      emailVerified: true,
      onboardingCompleted: false,
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      emailVerified: true,
      onboardingCompleted: true,
      role: true,
    },
  });

  const session = await createSession(user);
  setAuthCookies(res, session.accessToken, session.refreshToken);

  return res.json({
    success: true,
    message: "OAuth login successful.",
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    user: publicUser(user),
    redirectTo: user.onboardingCompleted ? "/app/discover" : "/onboarding",
  });
}

export async function sendOtp(_req: Request, res: Response) {
  res.json({ success: true, message: "OTP send endpoint ready" });
}

export async function verifyOtp(_req: Request, res: Response) {
  res.json({ success: true, message: "OTP verify endpoint ready" });
}

export async function adminLogin(req: Request, res: Response) {
  const email = typeof req.body.email === "string" ? req.body.email.trim() : "";
  const password =
    typeof req.body.password === "string" ? req.body.password : "";

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Email and password are required.",
    });
  }

  if (!env.jwtSecret) {
    return res.status(500).json({
      success: false,
      message: "JWT_SECRET is not configured.",
    });
  }

  const admin = await prisma.user.findFirst({
    where: {
      email: email.toLowerCase(),
      role: { in: ["admin", "super_admin"] },
    },
    select: {
      id: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
      isBanned: true,
      passwordHash: true,
    },
  });

  if (
    !admin ||
    !admin.passwordHash ||
    !admin.isActive ||
    admin.isBanned ||
    !verifyPassword(password, admin.passwordHash)
  ) {
    return res.status(401).json({
      success: false,
      message: "Invalid email or password.",
    });
  }

  const token = createAccessToken(
    {
      sub: admin.id.toString(),
      role: admin.role,
      email: admin.email,
    },
    env.jwtSecret,
  );

  return res.json({
    success: true,
    token,
    admin: {
      id: admin.id.toString(),
      email: admin.email,
      phone: admin.phone,
      role: admin.role,
    },
  });
}
