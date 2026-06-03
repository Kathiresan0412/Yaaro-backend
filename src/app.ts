import express from "express";
import { apiRouter } from "./routes";
import { adminRouter } from "./routes/admin.routes";
import { errorMiddleware } from "./middleware/error.middleware";

export const app = express();

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
  }

  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  return next();
});

// Capture raw body for Stripe webhook signature verification before JSON parsing
app.use((req, res, next) => {
  if (req.originalUrl === "/api/payments/webhook" || req.originalUrl === "/api/v1/payments/webhook") {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      (req as unknown as { rawBody: Buffer }).rawBody = Buffer.from(data, "utf8");
      next();
    });
  } else {
    next();
  }
});

app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/", (_req, res) => {
  res.json({
    success: true,
    service: "yaro0-api",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.get("/status", (_req, res) => {
  res.json({
    success: true,
    service: "yaro0-api",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.get("/tiktok-developers-site-verification.txt", (_req, res) => {
  res.type("text/plain").send("tiktok-developers-site-verification=RVosRKuewMbKrbuERGPqTojVH3kVnlWv");
});


app.use("/api", apiRouter);
app.use("/api/v1", apiRouter);
app.use("/admin/api", adminRouter);

app.use(errorMiddleware);
