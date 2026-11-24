"use client";

import Problem from "@/components/Problem";
import "./globals.css";

// Last resort: the layout itself failed.
export default function GlobalError() {
  return <html lang="en"><body><Problem /></body></html>;
}
