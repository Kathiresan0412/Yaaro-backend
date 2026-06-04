import { Router } from "express";
import {
  adminLogin,
  changePassword,
  forgotPassword,
  login,
  logout,
  oauthLogin,
  passwordStatus,
  refresh,
  register,
  resetPassword,
  sendOtp,
  setPassword,
  verifyEmail,
  verifyOtp,
} from "../controllers/auth.controller";
import { requireAuth } from "../middleware/auth.middleware";

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

// Password management (requires authentication)
authRouter.get("/password-status", requireAuth, passwordStatus);
authRouter.post("/set-password", requireAuth, setPassword);
authRouter.post("/change-password", requireAuth, changePassword);
