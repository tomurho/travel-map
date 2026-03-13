import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Travel Map",
  description: "A personal map of places visited and places still calling.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
