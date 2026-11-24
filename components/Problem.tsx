"use client";

import { useEffect, useState } from "react";

/** The message for a page that couldn't be shown. Tries again by itself when the connection is back. */
export default function Problem() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const off = () => setOffline(true), on = () => location.reload();
    setOffline(navigator.onLine === false);
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    return () => { window.removeEventListener("offline", off); window.removeEventListener("online", on); };
  }, []);
  return (
    <main className="msg" role="alert">
      <h1>{offline ? "You're offline" : "We couldn't load this video"}</h1>
      <p>{offline ? "Check your internet connection. We'll try again when you're back." : "Something went wrong on our side. Please try again in a moment."}</p>
      <button type="button" className="retry" onClick={() => location.reload()}>Try again</button>
    </main>
  );
}
