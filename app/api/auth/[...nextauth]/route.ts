// app/api/auth/[...nextauth]/route.ts

import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bs58 from "bs58";
import nacl from "tweetnacl";

export const authOptions = {
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
        if (
          !credentials?.publicKey ||
          !credentials?.message ||
          !credentials?.signature
        )
          return null;

        const msgBytes = new TextEncoder().encode(credentials.message);
        const sigBytes = bs58.decode(credentials.signature);
        const pubKeyBytes = bs58.decode(credentials.publicKey);

        const ok = nacl.sign.detached.verify(msgBytes, sigBytes, pubKeyBytes);
        if (!ok) return null;

        return { id: credentials.publicKey, name: credentials.publicKey };
      },
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
