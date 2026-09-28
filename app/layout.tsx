import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Untitled - Jupyter Notebook",
  description: "A prompt-driven Jupyter notebook: describe code, get a full notebook back.",
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" style={{ colorScheme: "light" }}>
      <body data-jp-theme-light="true" data-jp-theme-name="JupyterLab Light">
        {children}
      </body>
    </html>
  );
}
