import { prisma } from "./config/database";
import { hashPassword } from "./utils/password";

async function main() {
  console.log("=== CREATING TEST USER ===");
  const email = "testuser@gmail.com";
  const password = "Jampu@1234";
  const passwordHash = hashPassword(password);

  try {
    // Delete if existing
    const existing = await prisma.user.findFirst({ where: { email } });
    if (existing) {
      await prisma.user.delete({ where: { id: existing.id } });
      console.log("Deleted existing test user.");
    }

    const user = await prisma.user.create({
      data: {
        email,
        phone: "+94700000001",
        firstName: "Test",
        lastName: "User",
        role: "user",
        isActive: true,
        isBanned: false,
        onboardingCompleted: true,
        emailVerified: true,
        passwordHash,
        passwordUpdatedAt: new Date(),
        profile: {
          create: {
            gender: "male",
            dateOfBirth: new Date("1998-05-15"),
            nameEn: "Test User",
            isVerified: true,
            isActive: true,
            profileCompletionPct: 100,
          }
        },
        onboardingProfile: {
          create: {
            displayName: "Testy",
            bio: "I am a test user to verify matches, chats, and subscriptions.",
            headline: "Verification account",
            relationshipGoal: "long-term",
            loveLanguage: "words",
          }
        },
        onboardingPhotos: {
          create: [
            {
              url: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=500&auto=format&fit=crop",
              isPrimary: true,
              orderIndex: 0,
              status: "approved"
            }
          ]
        }
      }
    });

    console.log(`Successfully created test user!`);
    console.log(`Email: ${user.email}`);
    console.log(`Password: ${password}`);

  } catch (err) {
    console.error("Failed to create test user:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
