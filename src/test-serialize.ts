import { prisma } from "./config/database";
import { getConversationForMatch, serializeMessage } from "./services/messaging.service";

async function run() {
  try {
    const userId = 30n;
    const matchId = 2n;

    console.log(`Running test for userId: ${userId}, matchId: ${matchId}`);
    const conversation = await getConversationForMatch(userId, matchId);
    console.log("Conversation:", conversation);

    if (conversation) {
      console.log("Querying messages...");
      const messages = await prisma.message.findMany({
        where: {
          conversationId: conversation.id,
        },
        orderBy: { id: "desc" },
        include: { conversation: { select: { matchId: true } } },
      });
      console.log(`Fetched ${messages.length} messages.`);
      
      const serialized = messages.map(m => serializeMessage(m, userId));
      console.log("Successfully serialized messages:", serialized);
    }
  } catch (error) {
    console.error("Serialization test failed:", error);
  } finally {
    await prisma.$disconnect();
  }
}

run();
