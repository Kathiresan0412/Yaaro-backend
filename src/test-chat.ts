import { prisma } from "./config/database";
import { getConversationForMatch } from "./services/messaging.service";

async function run() {
  try {
    console.log("Connecting to database...");
    const matches = await prisma.match.findMany({
      take: 5,
    });
    console.log("Fetched matches:", matches);

    if (matches.length > 0) {
      const match = matches[0];
      console.log(`Testing getConversationForMatch for matchId: ${match.id}, user1Id: ${match.user1Id}`);
      const conv = await getConversationForMatch(match.user1Id, match.id);
      console.log("Conversation result:", conv);
    } else {
      console.log("No matches found in the database.");
    }
  } catch (error) {
    console.error("Test failed with error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

run();
