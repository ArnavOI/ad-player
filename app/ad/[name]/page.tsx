import { notFound } from "next/navigation";
import { preconnect } from "react-dom";
import AdView from "@/components/AdView";
import { cdnOrigin, loadAd } from "@/lib/ads";

// /ad/<id>: the ad in ads/<id>/ on the CDN. The manifest is read here on the server
// (so no CORS is needed); the videos and photos stream straight from the CDN to the viewer.
// Options: ?theme=dark · ?bg=transparent (in an iframe) · ?sound=1
export default async function AdPage({ params, searchParams }: {
  params: Promise<{ name: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ name }, q] = await Promise.all([params, searchParams]);
  const ad = await loadAd(name);
  if (!ad) notFound();
  preconnect(cdnOrigin());
  return (
    <main className={`root ${q.theme === "dark" ? "dark" : "light"} ${q.bg === "transparent" ? "clear" : ""}`}>
      <h1 className="sr">Product video</h1>
      <noscript><p className="noscript">Please turn on JavaScript in your browser to watch this video.</p></noscript>
      <AdView ad={ad} sound={q.sound === "1"} />
    </main>
  );
}
