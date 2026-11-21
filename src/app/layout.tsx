import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "OpenBid",
  description: "Tell us what you need. We'll ask the city who can fulfill it.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <header className="sticky top-0 z-20 border-b border-stone-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-emerald-600 text-sm font-bold text-white">OB</span>
              OpenBid
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <Link href="/order/new" className="rounded-md px-3 py-1.5 hover:bg-stone-100">New order</Link>
              <Link href="/runs" className="rounded-md px-3 py-1.5 hover:bg-stone-100">Runs</Link>
              <Link href="/insights" className="rounded-md px-3 py-1.5 hover:bg-stone-100">History</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
