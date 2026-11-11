import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "ESL Listening Studio",
  description: "Create listening conversations for English learners.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
