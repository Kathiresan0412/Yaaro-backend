import type { IncomingMessage, ServerResponse } from "node:http";

type VercelRequest = IncomingMessage;

type VercelResponse = ServerResponse & {
  status: (code: number) => VercelResponse;
  setHeader: (name: string, value: string) => void;
  json: (body: unknown) => void;
};

function sendStatus(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
    
  }

  res.status(200).json({
    success: true,
    service: "yaro0-api",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

  if (pathname === "/" || pathname === "/api" || pathname === "/status" || pathname === "/api/status") {
    sendStatus(req, res);
    return;
  }

  try {
    const { app } = await import("../src/app");
    app(req, res);
  } catch (error) {
    console.error("Failed to load API app", error);
    res.status(500).json({
      success: false,
      message: "API function failed to start.",
    });
  }
}
