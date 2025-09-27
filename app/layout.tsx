import type React from "react"
import type { Metadata } from "next"
import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import { Analytics } from "@vercel/analytics/next"
import { Suspense } from "react"
import "./globals.css"

export const metadata: Metadata = {
  title: "Echo - WebRTC Room App",
  description: "Real-time video chat and file sharing",
  generator: "v0.app",
  other: {
    screenshot: "disabled",
    "screen-capture": "disabled",
    "format-detection": "telephone=no",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"
        />
        <meta name="screenshot" content="disabled" />
        <meta name="screen-capture" content="disabled" />
        <meta name="format-detection" content="telephone=no" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="theme-color" content="#4B2E2E" />

        <style
          dangerouslySetInnerHTML={{
            __html: `
            /* Enhanced screenshot and screen recording prevention */
            * {
              -webkit-touch-callout: none;
              -webkit-user-select: none;
              -khtml-user-select: none;
              -moz-user-select: none;
              -ms-user-select: none;
              user-select: none;
              -webkit-app-region: no-drag;
            }
            
            input, textarea {
              -webkit-user-select: text;
              -moz-user-select: text;
              -ms-user-select: text;
              user-select: text;
            }
            
            /* Prevent screenshot on mobile */
            @media screen and (-webkit-min-device-pixel-ratio: 0) {
              body {
                -webkit-user-select: none;
                -webkit-touch-callout: none;
              }
            }
            
            /* Hide content during print/screenshot attempts */
            @media print {
              * { 
                display: none !important; 
                visibility: hidden !important;
              }
              body::before {
                content: "Screenshot disabled";
                display: block !important;
                visibility: visible !important;
              }
            }
            
            /* Prevent context menu and long press */
            body {
              -webkit-touch-callout: none;
              -webkit-user-select: none;
              -khtml-user-select: none;
              -moz-user-select: none;
              -ms-user-select: none;
              user-select: none;
              overscroll-behavior: none;
            }
            
            /* Mobile-specific optimizations */
            @media (max-width: 768px) {
              body {
                overflow-x: hidden;
                -webkit-overflow-scrolling: touch;
              }
            }
          `,
          }}
        />
      </head>
      <body className={`font-sans ${GeistSans.variable} ${GeistMono.variable}`}>
        <Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
        <Analytics />
      </body>
    </html>
  )
}
