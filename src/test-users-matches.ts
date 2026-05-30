import { prisma } from "./config/database";

async function main() {
  console.log("=== DETAIL ANALYSIS ===");
  try {
    const allUsers = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        onboardingCompleted: true,
      }
    });
    console.log("ALL USERS IN DB:");
    for (const u of allUsers) {
      console.log(`User ID: ${u.id}, Email: ${u.email}, Name: ${u.firstName} ${u.lastName}, Onboarded: ${u.onboardingCompleted}`);
    }

    const allMatches = await prisma.match.findMany({
      include: {
        user1: { select: { id: true, email: true } },
        user2: { select: { id: true, email: true } },
        conversations: true,
      }
    });
    console.log("\nALL MATCHES:");
    for (const m of allMatches) {
      console.log(`Match ID: ${m.id}`);
      console.log(`  User1: ID ${m.user1Id} (${m.user1?.email ?? "NOT FOUND"})`);
      console.log(`  User2: ID ${m.user2Id} (${m.user2?.email ?? "NOT FOUND"})`);
      console.log(`  Active: ${m.isActive}`);
      console.log(`  Conversations count: ${m.conversations.length}`);
      for (const c of m.conversations) {
        console.log(`    Conv ID: ${c.id}, User1: ${c.user1Id}, User2: ${c.user2Id}, Preview: ${c.lastMessagePreview}, Active: ${c.isActive}`);
      }
    }

    const allConvs = await prisma.conversation.findMany({
      include: {
        user1: { select: { id: true, email: true } },
        user2: { select: { id: true, email: true } },
        match: true,
      }
    });
    console.log("\nALL CONVERSATIONS:");
    for (const c of allConvs) {
      console.log(`Conv ID: ${c.id}`);
      console.log(`  Match ID: ${c.matchId} (Match exists: ${!!c.match})`);
      if (c.match) {
        console.log(`    Match User1: ${c.match.user1Id}, Match User2: ${c.match.user2Id}, Match Active: ${c.match.isActive}`);
      }
      console.log(`  Conv User1: ID ${c.user1Id} (${c.user1?.email ?? "NOT FOUND"})`);
      console.log(`  Conv User2: ID ${c.user2Id} (${c.user2?.email ?? "NOT FOUND"})`);
    }

    const allMessages = await prisma.message.findMany({
      select: {
        id: true,
        conversationId: true,
        senderId: true,
        content: true,
        messageType: true,
        createdAt: true,
      }
    });
    console.log("\nALL MESSAGES:");
    for (const msg of allMessages) {
      console.log(`Message ID: ${msg.id}, Conv ID: ${msg.conversationId}, Sender ID: ${msg.senderId}, Content: ${msg.content}, Type: ${msg.messageType}`);
    }

  } catch (err) {
    console.error("Error running detail analysis:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
