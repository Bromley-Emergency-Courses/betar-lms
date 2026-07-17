import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BETAR LMS",
  description: "Admin LMS for BETAR PGCert POCUS delivery"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
