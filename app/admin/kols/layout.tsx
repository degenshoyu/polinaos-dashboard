// app/admin/kols/layout.tsx
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import AdminSidebar from "@/components/admin/AdminSidebar";

export default async function AdminKolsLayout({ children }: { children: ReactNode }) {
  // same semantics as your existing admin layout
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/dashboard?signin=1");
  if (!(session.user as any).isAdmin) redirect("/dashboard?denied=1");

  return (
    <div className="min-h-dvh flex">
      <AdminSidebar />
      <main className="flex-1">{children}</main>
    </div>
  );
}
