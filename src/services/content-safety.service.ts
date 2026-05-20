const bannedTerms = [
  "fuck",
  "shit",
  "bitch",
  "cunt",
  "dick",
  "pussy",
  "slut",
  "whore",
  "asshole",
  "bastard",
  "nigger",
  "faggot",
  "retard",
  "kike",
  "chink",
  "spic",
];

const bannedPatterns = bannedTerms.map(
  (term) => new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i"),
);

export function findUnsafeTerm(value: string) {
  const normalized = value
    .normalize("NFKC")
    .replace(/[@]/g, "a")
    .replace(/[!1|]/g, "i")
    .replace(/[$5]/g, "s")
    .replace(/[0]/g, "o")
    .toLowerCase();

  return bannedTerms.find((_term, index) => bannedPatterns[index].test(normalized)) ?? null;
}

export function hasUnsafeContent(value: unknown) {
  return typeof value === "string" && Boolean(findUnsafeTerm(value));
}

export function assertSafeText(value: unknown, label: string) {
  if (hasUnsafeContent(value)) {
    const error = new Error(`${label} contains language that is not allowed.`);
    (error as Error & { status?: number }).status = 422;
    throw error;
  }
}
