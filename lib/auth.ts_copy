// lib/auth.ts
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/** Verify a Solana signature against a plaintext message. */
function verifySolanaSignature(
  publicKey: string,
  message: string,
  signatureB58: string,
): boolean {
  try {
    const sig = bs58.decode(signatureB58);
    const msg = new TextEncoder().encode(message);
    const pub = bs58.decode(publicKey);
    return nacl.sign.detached.verify(msg, sig, pub);
  } catch {
    return false;
  }
}

/** Find or create a user by walletAddress (lowercased). */
async function findOrCreateUserByWallet(walletAddressRaw: string) {
  const walletAddress = walletAddressRaw.toLowerCase();

  // Try to find first
  const existing = await db.query.users.findFirst({
    where: eq(users.walletAddress, walletAddress),
  });
  if (existing) {
    // Optional: update lastLoginAt/updatedAt
    await db
      .update(users)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, existing.id));
    return existing;
  }

  // Insert new (unique on wallet_address prevents duplicates)
  const [inserted] = await db
    .insert(users)
    .values({
      walletAddress,
      lastLoginAt: new Date(),
    })
    .onConflictDoNothing({ target: users.walletAddress })
    .returning();

  if (inserted) return inserted;

  // If conflict happened concurrently, fetch again
  const fallback = await db.query.users.findFirst({
    where: eq(users.walletAddress, walletAddress),
  });
  if (!fallback) throw new Error("Failed to upsert user");
  return fallback;
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" as const },
  providers: [
    CredentialsProvider({
      name: "Solana",
      credentials: {
        publicKey: { label: "publicKey", type: "text" },
        message: { label: "message", type: "text" },
        signature: { label: "signature(base58)", type: "text" },
      },
      async authorize(credentials) {
        const publicKey = (credentials?.publicKey || "").trim();
        const message = (credentials?.message || "").trim();
        const signature = (credentials?.signature || "").trim();

        if (!publicKey || !message || !signature) return null;
        const ok = verifySolanaSignature(publicKey, message, signature);
        if (!ok) return null;

        // ✅ Persist user (find-or-create) in Postgres
        const user = await findOrCreateUserByWallet(publicKey);

        // Return a compact user object; id will flow into jwt/session callbacks.
        return {
          id: user.id, // <-- database user id (uuid)
          name: user.walletAddress, // Navbar fallback
          address: user.walletAddress, // explicit address field
        } as any;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // First login: copy from `user`; subsequent calls keep existing token
      if (user) {
        token.id = (user as any).id;
        token.address = (user as any).address || (user as any).name;
      }
      return token;
    },
    async session({ session, token }) {
      // Expose id/address to the client
      (session.user as any).id = token.id;
      (session.user as any).address = token.address || session.user?.name;
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
