"use client";

import { useCallback, useState } from "react";
import GridPlayer from "@/components/GridPlayer";
import Player from "@/components/Player";
import type { Ad } from "@/lib/ads";

/** The combined video when there is one that plays here, else the separate videos. */
export default function AdView({ ad, sound }: { ad: Ad; sound: boolean }) {
  const [separate, setSeparate] = useState(false);
  const fail = useCallback(() => setSeparate(true), []);
  return ad.grid && !separate ? <GridPlayer ad={ad} pages={ad.grid} sound={sound} onFail={fail} /> : <Player ad={ad} sound={sound} />;
}
