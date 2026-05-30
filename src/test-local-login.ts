import { prisma } from "./config/database";
import { verifyPassword } from "./utils/password";

async function main() {
  console.log("=== TESTING PASSWORD FOR e125812@esoft.academy ===");
  try {
    const user = await prisma.user.findFirst({
      where: { email: "e125812@esoft.academy" }
    });

    if (!user) {
      console.log("User e125812@esoft.academy NOT FOUND in database!");
      return;
    }

    console.log(`User found: ${user.firstName} ${user.lastName}`);
    console.log(`Password Hash in DB: ${user.passwordHash}`);

    if (!user.passwordHash) {
      console.log("User has no password hash set!");
      return;
    }

    const testPassword = "Jampu@1234";
    const isMatch = verifyPassword(testPassword, user.passwordHash);
    console.log(`Is password '${testPassword}' correct? ${isMatch}`);

    // Let's also check thuraijathusan@gmail.com
    const admin = await prisma.user.findFirst({
      where: { email: "thuraijathusan@gmail.com" }
    });
    if (admin) {
      console.log("Admin thuraijathusan@gmail.com exists!");
      console.log(`Is admin password 'Jampu@1234' correct? ${verifyPassword("Jampu@1234", admin.passwordHash || "")}`);
    } else {
      console.log("Admin thuraijathusan@gmail.com does NOT exist in this DB.");
    }
  } catch (err) {
    console.error("Test failed:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
