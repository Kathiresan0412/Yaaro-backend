import { Router } from "express";
import {
  adminLogin,
  forgotPassword,
  login,
  logout,
  oauthLogin,
  refresh,
  register,
  resetPassword,
  sendOtp,
  verifyEmail,
  verifyOtp,
} from "../controllers/auth.controller";

export const authRouter = Router();

authRouter.post("/register", register);
authRouter.get("/verify-email/:token", verifyEmail);
authRouter.post("/login", login);
authRouter.post("/logout", logout);
authRouter.post("/refresh", refresh);
authRouter.post("/forgot-password", forgotPassword);
authRouter.post("/reset-password", resetPassword);
authRouter.post("/reset-password/:token", resetPassword);
authRouter.post("/oauth/:provider", oauthLogin);
authRouter.post("/admin/login", adminLogin);
authRouter.post("/otp/send", sendOtp);
authRouter.post("/otp/verify", verifyOtp);
