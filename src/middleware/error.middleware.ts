import type { ErrorRequestHandler } from "express";

export const errorMiddleware: ErrorRequestHandler = (error, _req, res, _next) => {
  console.error("[ErrorMiddleware]", error);
  const status = typeof error.status === "number" ? error.status : 500;

  res.status(status).json({
    success: false,
    message: status === 500 ? "Internal server error" : error.message,
    // Include error details in non-production for debugging
    ...(process.env.NODE_ENV !== "production" && {
      debug: error.message,
      stack: error.stack?.split("\n").slice(0, 5),
    }),
  });
};
