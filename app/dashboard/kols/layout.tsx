import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function AdminOnlyLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/dashboard?signin=1");
  if (!(session.user as any).isAdmin) redirect("/dashboard?denied=1");

  return <>{children}</>;
}
