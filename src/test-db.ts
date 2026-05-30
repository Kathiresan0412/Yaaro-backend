import { prisma } from "./config/database";

async function main() {
  console.log("=== DIAGNOSING DATABASE ===");
  try {
    const userCount = await prisma.user.count();
    const matchCount = await prisma.match.count();
    const conversationCount = await prisma.conversation.count();
    const messageCount = await prisma.message.count();
    const subscriptionCount = await prisma.subscription.count();
    const paymentCount = await prisma.payment.count();

    console.log(`Users: ${userCount}`);
    console.log(`Matches: ${matchCount}`);
    console.log(`Conversations: ${conversationCount}`);
    console.log(`Messages: ${messageCount}`);
    console.log(`Subscriptions: ${subscriptionCount}`);
    console.log(`Payments: ${paymentCount}`);

    // Print some users
    const users = await prisma.user.findMany({
      take: 5,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        onboardingCompleted: true,
      }
    });
    console.log("\nSample Users:");
    for (const u of users) {
      console.log(`- ID: ${u.id}, Email: ${u.email}, Name: ${u.firstName} ${u.lastName}, Onboarding: ${u.onboardingCompleted}`);
    }

    // Print some matches
    const matches = await prisma.match.findMany({
      take: 5,
      include: {
        conversations: {
          select: {
            id: true,
            lastMessagePreview: true,
          }
        }
      }
    });
    console.log("\nSample Matches:");
    for (const m of matches) {
      console.log(`- Match ID: ${m.id}, User1: ${m.user1Id}, User2: ${m.user2Id}, Active: ${m.isActive}, Conversations: ${m.conversations.length}`);
    }

    // Print some conversations
    const convs = await prisma.conversation.findMany({
      take: 5,
    });
    console.log("\nSample Conversations:");
    for (const c of convs) {
      console.log(`- Conv ID: ${c.id}, Match ID: ${c.matchId}, User1: ${c.user1Id}, User2: ${c.user2Id}, LastMsg: ${c.lastMessagePreview}, Active: ${c.isActive}`);
    }
  } catch (err) {
    console.error("Database connection failed:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
