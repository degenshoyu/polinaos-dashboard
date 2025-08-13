// app/dashboard/layout.tsx

import Navbar from "@/components/dashboard/Navbar";
import Sidebar from "@/components/dashboard/Sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen text-white">
      <Navbar />
      <div className="mx-auto max-w-7xl px-4 py-6 flex gap-6">
        <Sidebar />
        <main className="flex-1">{children}</main>
      </div>
      <footer className="text-center text-sm text-gray-500 pb-8">
        © {new Date().getFullYear()} PolinaOS
      </footer>
    </div>
  );
}
