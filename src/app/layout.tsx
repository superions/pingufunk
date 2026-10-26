import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { SettingsProvider } from "@/contexts/settings-context";
import { PRODUCT_NAME, PRODUCT_DESCRIPTION } from "@/lib/brand";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description: PRODUCT_DESCRIPTION,
  applicationName: PRODUCT_NAME,
  icons: {
    icon: [
      { url: "/branding/pingufunk-mark.svg", type: "image/svg+xml" },
      { url: "/branding/pingufunk-icon.png", type: "image/png", sizes: "64x64" },
    ],
    apple: "/logo.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                const darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
                if (darkMode) {
                  document.documentElement.classList.add('dark');
                }
              })();
            `,
          }}
        />
      </head>
      <body className={inter.className}>
        <SettingsProvider>
          <div className="flex h-screen overflow-hidden">
            {/* Desktop/Tablet Sidebar */}
            <Sidebar />

            {/* Main content area */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Mobile Navigation */}
              <MobileNav />

              {/* Page Content */}
              <main className="flex-1 overflow-y-auto">{children}</main>
            </div>
          </div>
        </SettingsProvider>
      </body>
    </html>
  );
}
