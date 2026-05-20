type VercelRequest = {
  method?: string;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  setHeader: (name: string, value: string) => void;
  json: (body: unknown) => void;
  end: () => void;
};

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method && req.method !== "GET") {
    res.status(405).json({
      success: false,
      message: "Method not allowed.",
    });
    return;
  }

  res.status(200).json({
    success: true,
    service: "yaro0-api",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
}
