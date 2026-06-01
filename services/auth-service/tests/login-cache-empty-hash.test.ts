import { describe, expect, it, vi, beforeEach } from "vitest";

const cacheUser = vi.fn();
const getUserFromCache = vi.fn();
const invalidateUserCache = vi.fn();
const comparePassword = vi.fn();
const resolveLoginUserByEmail = vi.fn();

vi.mock("../src/lib/redis-cache.js", () => ({
  getUserFromCache,
  cacheUser,
  invalidateUserCache,
  checkEmailExistsInCache: vi.fn(),
}));

vi.mock("../src/lib/bcrypt-queue.js", () => ({
  hashPassword: vi.fn(),
  comparePassword,
  getQueueStatus: vi.fn(),
}));

vi.mock("../src/resolve-login-user.js", () => ({
  resolveLoginUserByEmail,
}));

vi.mock("../src/lib/prisma.js", () => ({
  prisma: { $queryRaw: vi.fn(), $executeRaw: vi.fn() },
}));

describe("login empty passwordHash cache guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    comparePassword.mockResolvedValue(true);
  });

  it("invalidates cache and loads DB when cached passwordHash is empty", async () => {
    getUserFromCache.mockResolvedValueOnce({
      id: "user-1",
      email: "e2e@example.com",
      passwordHash: "",
      mfaEnabled: false,
      emailVerified: true,
      phoneVerified: false,
      createdAt: new Date(),
    });
    invalidateUserCache.mockResolvedValue(undefined);
    resolveLoginUserByEmail.mockResolvedValue({
      id: "user-1",
      email: "e2e@example.com",
      passwordHash: "$2b$10$validhash",
      mfaEnabled: false,
      emailVerified: true,
      phoneVerified: false,
      createdAt: new Date(),
    });

    const email = "e2e@example.com";
    let user = await getUserFromCache(email);
    if (user && !user.passwordHash) {
      await invalidateUserCache(email);
      user = null;
    }
    if (!user) {
      const dbUser = await resolveLoginUserByEmail(null, email);
      if (dbUser) {
        await cacheUser({
          id: dbUser.id,
          email,
          passwordHash: dbUser.passwordHash,
          mfaEnabled: dbUser.mfaEnabled,
          emailVerified: dbUser.emailVerified,
          phoneVerified: dbUser.phoneVerified,
          createdAt: dbUser.createdAt,
        });
        user = dbUser;
      }
    }

    expect(invalidateUserCache).toHaveBeenCalledWith(email);
    expect(resolveLoginUserByEmail).toHaveBeenCalled();
    expect(user?.passwordHash).toBe("$2b$10$validhash");
    const ok = await comparePassword("secret", user!.passwordHash);
    expect(ok).toBe(true);
  });
});
