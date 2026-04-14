import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cross Borders Rule Reviewer",
  description: "Research and review rule assumptions with Perplexity-backed verification.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen font-[family-name:var(--font-sans)] antialiased">{children}</body>
    </html>
  );
}
