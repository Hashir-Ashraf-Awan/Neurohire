import { Public_Sans } from "next/font/google";
import "./globals.css";

const publicSans = Public_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-public-sans",
});

export const metadata = {
  title: "NeuroHire",
  description: "Entry-level software & AI/ML jobs from the last 72 hours: Lahore on-site and worldwide remote.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={publicSans.variable}>
      <body>{children}</body>
    </html>
  );
}
