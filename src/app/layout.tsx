import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Colowo", template: "%s · Colowo" },
  description: "Cooperative savings, loans and deductions",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-NG">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
