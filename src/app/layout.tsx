import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";

import "./globals.css";

/**
 * IBM Plex, diseñada para interfaces técnicas. La mono no es decorativa: esta
 * plataforma muestra teléfonos en E.164, identificadores de mensaje, horas y
 * costes, y ahí importa que el 0 no se confunda con la O y que las columnas de
 * cifras queden alineadas.
 */
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Agente de WhatsApp",
  description:
    "Inbox conversacional para WhatsApp con IA: atiende, responde y agenda sin que tengas que estar pendiente.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
