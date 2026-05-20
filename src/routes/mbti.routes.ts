import { Router } from "express";
import { prisma } from "../config/database";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.middleware";

export const mbtiRouter = Router();

mbtiRouter.use(requireAuth);

const TYPE_DESCRIPTIONS: Record<string, string> = {
  ISTJ: "Grounded, loyal, and steady. You value trust, routine, and showing up.",
  ISFJ: "Warm, observant, and caring. You notice what people need and make love feel practical.",
  INFJ: "Insightful, idealistic, and deep. You want connection with meaning and emotional honesty.",
  INTJ: "Strategic, independent, and focused. You admire ambition, clarity, and shared growth.",
  ISTP: "Calm, practical, and adaptable. You like easy chemistry and space to be yourself.",
  ISFP: "Gentle, creative, and present. You connect through small moments and genuine feeling.",
  INFP: "Romantic, principled, and imaginative. You look for sincerity and emotional depth.",
  INTP: "Curious, analytical, and original. You enjoy clever conversation and low-pressure connection.",
  ESTP: "Bold, playful, and spontaneous. You bring energy, charm, and a taste for adventure.",
  ESFP: "Expressive, generous, and fun. You make dates feel alive and memorable.",
  ENFP: "Enthusiastic, open, and inventive. You seek sparks, stories, and room to grow.",
  ENTP: "Quick, witty, and exploratory. You love chemistry with banter and big ideas.",
  ESTJ: "Decisive, dependable, and direct. You value effort, honesty, and real commitment.",
  ESFJ: "Social, thoughtful, and devoted. You build connection through care and consistency.",
  ENFJ: "Charismatic, empathetic, and encouraging. You bring warmth and big-hearted intention.",
  ENTJ: "Confident, driven, and decisive. You respect ambition, honesty, and partnership with momentum.",
};

function currentUserId(req: AuthenticatedRequest) {
  if (!req.auth?.userId) {
    throw new Error("Authenticated user missing.");
  }

  return req.auth.userId;
}

function calculateType(
  questions: Array<{ id: bigint; yesValue: string; noValue: string }>,
  answers: Record<string, boolean>,
) {
  const scores: Record<string, number> = { E: 0, I: 0, S: 0, N: 0, T: 0, F: 0, J: 0, P: 0 };

  for (const question of questions) {
    const answer = answers[question.id.toString()];
    if (typeof answer === "boolean") {
      scores[answer ? question.yesValue : question.noValue] += 1;
    }
  }

  return [
    scores.E >= scores.I ? "E" : "I",
    scores.S >= scores.N ? "S" : "N",
    scores.T >= scores.F ? "T" : "F",
    scores.J >= scores.P ? "J" : "P",
  ].join("");
}

mbtiRouter.get("/mbti/questions", async (_req, res, next) => {
  try {
    const questions = await prisma.mbtiQuizQuestion.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { id: true, prompt: true, dimension: true, sortOrder: true },
    });

    res.json({
      success: true,
      questions: questions.map((question) => ({
        id: question.id.toString(),
        prompt: question.prompt,
        dimension: question.dimension,
        sortOrder: question.sortOrder,
      })),
    });
  } catch (error) {
    next(error);
  }
});

mbtiRouter.post("/mbti/submit", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const rawAnswers = req.body.answers;

    if (!rawAnswers || typeof rawAnswers !== "object" || Array.isArray(rawAnswers)) {
      return res.status(400).json({ success: false, message: "Answers must be an object keyed by question id." });
    }

    const questions = await prisma.mbtiQuizQuestion.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { id: true, yesValue: true, noValue: true },
    });
    const answers = rawAnswers as Record<string, unknown>;
    const normalizedAnswers: Record<string, boolean> = {};

    for (const question of questions) {
      const value = answers[question.id.toString()];
      if (typeof value === "boolean") {
        normalizedAnswers[question.id.toString()] = value;
      }
    }

    if (Object.keys(normalizedAnswers).length !== questions.length) {
      return res.status(400).json({ success: false, message: "Please answer every MBTI question." });
    }

    const mbti = calculateType(questions, normalizedAnswers);

    await prisma.$transaction(async (tx) => {
      await tx.mbtiQuizAnswer.createMany({
        data: questions.map((question) => ({
          userId,
          questionId: question.id,
          answer: normalizedAnswers[question.id.toString()],
        })),
      });
      await tx.userProfile.upsert({
        where: { userId },
        update: { mbti },
        create: { userId, mbti },
      });
    });

    res.json({
      success: true,
      mbti,
      description: TYPE_DESCRIPTIONS[mbti] ?? "A distinctive personality blend for dating with intention.",
    });
  } catch (error) {
    next(error);
  }
});
