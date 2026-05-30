import { prisma } from "./config/database";

function calculateAge(dateOfBirth: Date) {
  const today = new Date();
  let age = today.getFullYear() - dateOfBirth.getFullYear();
  const monthDifference = today.getMonth() - dateOfBirth.getMonth();

  if (monthDifference < 0 || (monthDifference === 0 && today.getDate() < dateOfBirth.getDate())) {
    age -= 1;
  }
  return age;
}

function displayName(user: any) {
  return (
    user.onboardingProfile?.displayName ||
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    "Yaaro member"
  );
}

async function main() {
  const userId = 30n;
  console.log(`Testing API responses for userId: ${userId}`);

  try {
    console.log("\n--- SIMULATING GET /api/matches ---");
    const matches = await prisma.match.findMany({
      where: {
        isActive: true,
        OR: [{ user1Id: userId }, { user2Id: userId }],
      },
      orderBy: { matchedAt: "desc" },
      include: {
        user1: {
          include: {
            onboardingProfile: true,
            onboardingPhotos: { orderBy: [{ isPrimary: "desc" }, { orderIndex: "asc" }, { id: "asc" }] },
            profile: true,
          },
        },
        user2: {
          include: {
            onboardingProfile: true,
            onboardingPhotos: { orderBy: [{ isPrimary: "desc" }, { orderIndex: "asc" }, { id: "asc" }] },
            profile: true,
          },
        },
        conversations: {
          where: { isActive: true },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
      },
    });

    const matchesItems = matches.map((match) => {
      const matchedUser = match.user1Id === userId ? match.user2 : match.user1;
      const conversation = match.conversations[0] ?? null;

      return {
        id: match.id.toString(),
        matchedAt: match.matchedAt.toISOString(),
        isNew: Date.now() - match.matchedAt.getTime() < 24 * 60 * 60 * 1000,
        compatibilityScore: Number(match.compatibilityScore),
        user: {
          id: matchedUser.id.toString(),
          displayName: displayName(matchedUser),
          age: matchedUser.profile ? calculateAge(matchedUser.profile.dateOfBirth) : null,
          mainPhotoUrl: matchedUser.onboardingPhotos[0]?.url ?? null,
          lastActiveAt: matchedUser.lastActiveAt?.toISOString() ?? null,
          isVerified: matchedUser.profile?.isVerified ?? false,
        },
        lastMessage: conversation?.lastMessagePreview
          ? {
              preview: conversation.lastMessagePreview,
              sentAt: conversation.lastMessageAt?.toISOString() ?? null,
            }
          : null,
        unreadCount:
          conversation && conversation.user1Id === userId
            ? conversation.user1UnreadCount
            : conversation?.user2UnreadCount ?? 0,
      };
    });

    const itemsByUser = new Map<string, any>();
    for (const item of matchesItems) {
      if (!itemsByUser.has(item.user.id)) {
        itemsByUser.set(item.user.id, item);
      }
    }
    const finalMatches = Array.from(itemsByUser.values());
    console.log("Serialized Matches count:", finalMatches.length);
    console.log("Serialized Matches JSON:", JSON.stringify(finalMatches, null, 2));

    console.log("\n--- SIMULATING GET /api/conversations ---");
    const conversations = await prisma.conversation.findMany({
      where: {
        isActive: true,
        OR: [{ user1Id: userId }, { user2Id: userId }],
      },
      orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
      include: {
        match: { select: { id: true, matchedAt: true, compatibilityScore: true, isActive: true } },
        user1: {
          include: {
            onboardingProfile: true,
            onboardingPhotos: { orderBy: [{ isPrimary: "desc" }, { orderIndex: "asc" }, { id: "asc" }] },
            profile: true,
          },
        },
        user2: {
          include: {
            onboardingProfile: true,
            onboardingPhotos: { orderBy: [{ isPrimary: "desc" }, { orderIndex: "asc" }, { id: "asc" }] },
            profile: true,
          },
        },
      },
    });

    const blocks = await prisma.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    });
    const blockedIds = new Set(
      blocks.map((block) =>
        block.blockerId === userId ? block.blockedId.toString() : block.blockerId.toString(),
      ),
    );

    const conversationsItems = conversations.flatMap((conversation) => {
      const otherUser = conversation.user1Id === userId ? conversation.user2 : conversation.user1;
      if (blockedIds.has(otherUser.id.toString())) {
        return [];
      }

      return [
        {
          id: conversation.matchId.toString(),
          conversationId: conversation.id.toString(),
          matchedAt: conversation.match.matchedAt.toISOString(),
          isNew: false,
          isActiveMatch: conversation.match.isActive,
          compatibilityScore: Number(conversation.match.compatibilityScore),
          user: {
            id: otherUser.id.toString(),
            displayName: displayName(otherUser),
            age: otherUser.profile ? calculateAge(otherUser.profile.dateOfBirth) : null,
            mainPhotoUrl: otherUser.onboardingPhotos[0]?.url ?? null,
            lastActiveAt: otherUser.lastActiveAt?.toISOString() ?? null,
            isVerified: otherUser.profile?.isVerified ?? false,
          },
          lastMessage: conversation.lastMessagePreview
            ? {
                preview: conversation.lastMessagePreview,
                sentAt: conversation.lastMessageAt?.toISOString() ?? null,
              }
            : null,
          unreadCount:
            conversation.user1Id === userId ? conversation.user1UnreadCount : conversation.user2UnreadCount,
        },
      ];
    });

    console.log("Serialized Conversations count:", conversationsItems.length);
    console.log("Serialized Conversations JSON:", JSON.stringify(conversationsItems, null, 2));

  } catch (error) {
    console.error("API response test failed:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
