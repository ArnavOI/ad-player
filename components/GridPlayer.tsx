"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GAP, Icon, layout, safely, tryPlay } from "@/components/Player";
import type { Ad, GridPage } from "@/lib/ads";

const SLOW = 6000; // after this, say that it's slow
const GET_READY = 12000; // longest wait for another page's video (ms)
const FADE = 140;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Resolves when ok(), or after `ms`, or soon after stop(). */
const until = (v: HTMLVideoElement, ok: () => boolean, events: string[], ms: number, stop: () => boolean = () => false) => new Promise<boolean>((r) => {
  if (ok()) return r(true);
  const done = () => { clearTimeout(t); clearInterval(poll); events.forEach((e) => v.removeEventListener(e, see)); r(ok()); };
  const see = () => { if (ok() || v.error) done(); };
  const t = setTimeout(done, ms);
  const poll = setInterval(() => { if (stop()) done(); else see(); }, 50);
  events.forEach((e) => v.addEventListener(e, see));
});
/** Resolves once a picture has really been drawn, or after `ms`. */
const drawn = (v: HTMLVideoElement, ms: number) => new Promise<void>((r) => {
  const from = v.currentTime, end = Date.now() + ms;
  const poll = setInterval(() => { if (Date.now() > end || (!v.requestVideoFrameCallback && v.currentTime - from > 0.08)) done(); }, 30); // older browsers
  const done = () => { clearInterval(poll); r(); };
  if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(done);
});

type Quality = "full" | "phone";
function pickQuality(stageW: number, tileW: number): Quality {
  const data = (navigator as { connection?: { saveData?: boolean } }).connection?.saveData;
  const phone = Math.min(screen.width, screen.height) < 600;
  return data || phone || stageW * Math.min(devicePixelRatio || 1, 2) <= tileW ? "phone" : "full";
}

// All products are in one video, side by side; the stage shows one of them, and switching only moves the picture. The
// browser plays and loops it by itself: no seeking, no speed changes, nothing to keep in step. Ads with many products
// have several such videos (pages). Only one page plays: on a change the old one holds its picture until the new one
// has drawn the same moment. When the combined video can't be played at all, `onFail` shows the separate videos.
export default function GridPlayer({ ad, pages, sound: startWithSound, onFail }: {
  ad: Ad; pages: Record<Quality, GridPage[]>; sound: boolean; onFail: () => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const videos = useRef<(HTMLVideoElement | null)[]>([]);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [quality, setQuality] = useState<Quality | null>(null);
  const [active, setActive] = useState(0); // the product chosen
  const [shown, setShown] = useState(0); // the product on screen: the chosen one, unless its page is still loading
  const [sound, setSound] = useState(startWithSound);
  const [started, setStarted] = useState(false);
  const [slow, setSlow] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [offline, setOffline] = useState(false);
  const [problem, setProblem] = useState<"video" | "page" | null>(null);
  const [round, setRound] = useState(0);
  const wanted = useRef(true); // the viewer hasn't pressed pause
  const soundRef = useRef(startWithSound);
  const pageRef = useRef(0); // the page on screen
  const under = useRef(-1); // the one before it, directly beneath
  const target = useRef(0); // the product chosen last
  const shownRef = useRef(0);
  const changing = useRef(false);
  const change = useRef(0); // one more whenever everything loads again

  const list = quality ? pages[quality] : pages.phone;
  const pageOf = (i: number) => pages.phone.findIndex((p) => p.items.includes(i));
  const current = () => videos.current[pageRef.current];

  const { below, side, strip, scale } = layout(box.w, box.h, ad);
  const w = Math.round(ad.width * scale), h = Math.round(ad.height * scale);

  // Size of the space we have (the iframe or window).
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Chosen once, when the size is known.
  useEffect(() => {
    if (!quality && w > 0) {
      let q: Quality = "phone";
      safely(() => { q = pickQuality(w, pages.phone[0].tileW); });
      setQuality(q);
    }
  }, [quality, w, pages]);

  const load = useCallback((page: number) => {
    const v = videos.current[page], p = quality && pages[quality][page];
    if (!v || !p || v.dataset.src === p.video) return;
    v.dataset.src = p.video;
    v.src = p.video;
    safely(() => v.load());
  }, [quality, pages]);

  /** Starts a video; without sound if the browser insists. */
  const start = useCallback(async (v: HTMLVideoElement) => {
    videos.current.forEach((x) => { if (x && x !== v && !x.paused) safely(() => x.pause()); });
    v.muted = !soundRef.current;
    let r = await tryPlay(v);
    if (r === "blocked" && soundRef.current) {
      soundRef.current = false;
      setSound(false);
      v.muted = true;
      r = await tryPlay(v);
    }
    setBlocked(r === "blocked");
    return r;
  }, []);

  // A broken or unsupported file: the smaller version, then the separate videos. Offline, nothing is given up.
  const giveUp = useCallback(() => {
    if (navigator.onLine === false) return setProblem("video");
    if (quality === "full") {
      change.current++;
      setQuality("phone");
    } else onFail();
  }, [quality, onFail]);

  // Load and start the first page (again after a change of quality or "Try again").
  useEffect(() => {
    if (!quality) return;
    let stop = false;
    change.current++;
    videos.current.forEach((v) => { if (v) { delete v.dataset.src; safely(() => v.pause()); } });
    setStarted(false);
    setSlow(false);
    setProblem(null);
    load(pageRef.current);
    const t = setTimeout(() => setSlow(true), SLOW);
    const v = current();
    let still = false;
    safely(() => { still = matchMedia("(prefers-reduced-motion: reduce)").matches; });
    if (still && round === 0) wanted.current = false;
    if (v) {
      void until(v, () => v.readyState >= 2, ["loadeddata", "canplay", "error"], SLOW * 5).then(() => { if (!stop && !v.error) setStarted(true); });
      if (wanted.current) void start(v);
    }
    return () => { stop = true; clearTimeout(t); };
  }, [quality, round, load, start]); // eslint-disable-line react-hooks/exhaustive-deps

  // The other pages are loaded ahead once the first plays, unless the viewer saves data.
  useEffect(() => {
    if (!started || !playing || list.length < 2) return;
    if ((navigator as { connection?: { saveData?: boolean } }).connection?.saveData) return;
    const t = setTimeout(() => list.forEach((_, i) => load(i)), 1500);
    return () => clearTimeout(t);
  }, [started, playing, list, load]);

  // A file that "plays" without ever drawing anything (a format the device can't decode) counts as broken.
  useEffect(() => {
    const v = current();
    if (!playing || !v?.requestVideoFrameCallback) return;
    let seen = false;
    const id = v.requestVideoFrameCallback(() => { seen = true; });
    const from = v.currentTime;
    const t = setTimeout(() => { if (!seen && !v.paused && !document.hidden && v.currentTime - from > 1.5) giveUp(); }, 4000);
    return () => { clearTimeout(t); safely(() => v.cancelVideoFrameCallback(id)); };
  }, [playing, quality, giveUp]); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = useCallback(() => { wanted.current = true; setProblem(null); setRound((r) => r + 1); }, []);
  useEffect(() => {
    const off = () => setOffline(true);
    const on = () => { setOffline(false); if (videos.current[pageRef.current]?.error) retry(); };
    const back = () => { const v = current(); if (!document.hidden && !changing.current && wanted.current && v?.paused) void start(v); };
    setOffline(navigator.onLine === false);
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    document.addEventListener("visibilitychange", back);
    return () => { window.removeEventListener("offline", off); window.removeEventListener("online", on); document.removeEventListener("visibilitychange", back); };
  }, [retry, start]);

  /** Moves to the page of the product chosen last. One change runs at a time, and every other video is stopped before one
   * starts, so two never play together however fast someone taps. */
  const changePage = async () => {
    if (changing.current) return; // the one under way picks up the newest choice
    changing.current = true;
    const life = change.current; // another quality or "Try again" ends this
    try {
      while (life === change.current) {
        const i = target.current, to = pageOf(i), from = pageRef.current;
        const same = () => life === change.current && pageOf(target.current) === to;
        const old = videos.current[from], v = videos.current[to];
        if (!old || !v || to === from) break;
        load(to);
        setBuffering(true);
        const ready = await until(v, () => v.readyState >= 2, ["loadeddata", "canplay", "progress", "error"], GET_READY, () => !same());
        if (!same()) continue;
        if (v.error || (!ready && v.readyState === 0)) { // the old product stays
          delete v.dataset.src;
          target.current = shownRef.current;
          setActive(shownRef.current);
          setProblem("page");
          break;
        }
        // The old one holds its picture while the new one gets to the same moment.
        safely(() => old.pause());
        const t = old.currentTime;
        safely(() => { v.currentTime = t; });
        await until(v, () => !v.seeking && v.readyState >= 2, ["seeked", "canplay", "error"], 2500, () => !same());
        if (!same()) continue;
        if (wanted.current) {
          const seen = drawn(v, 1200);
          await start(v);
          await seen;
          if (!wanted.current) safely(() => v.pause()); // paused meanwhile
        } else await wait(80);
        if (!same()) { safely(() => v.pause()); continue; }
        pageRef.current = to;
        under.current = from;
        shownRef.current = target.current;
        setShown(target.current);
        setPlaying(!v.paused);
        videos.current.forEach((x, k) => { if (x) x.style.zIndex = k === to ? "2" : k === from ? "1" : "0"; });
        safely(() => {
          if (!matchMedia("(prefers-reduced-motion: reduce)").matches) v.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE, easing: "linear" });
        });
      }
    } finally {
      changing.current = false;
      if (life === change.current) {
        if (!shownRef.current || pageOf(shownRef.current) === pageRef.current) setBuffering(false);
        if (pageOf(target.current) === pageRef.current) { shownRef.current = target.current; setShown(target.current); }
        const v = current();
        if (wanted.current && v?.paused) void start(v); // back on the page that was left
      }
    }
  };
  const select = (i: number) => {
    target.current = i;
    setActive(i);
    setProblem((p) => (p === "page" ? null : p));
    if (pageOf(i) !== pageRef.current) void changePage();
    else if (!changing.current) { shownRef.current = i; setShown(i); } // same page: just another part of the picture
  };

  const toggle = () => {
    const v = current();
    if (!v || problem === "video") return;
    wanted.current = !wanted.current || (v.paused && !changing.current);
    if (changing.current) return; // the page change starts it, or leaves it paused
    if (wanted.current) void start(v); else safely(() => v.pause());
  };
  const toggleSound = () => {
    soundRef.current = !soundRef.current;
    setSound(soundRef.current);
    const v = current();
    if (v) v.muted = !soundRef.current;
  };

  const onPlayState = (i: number, v: HTMLVideoElement) => {
    if (i !== pageRef.current) return;
    setPlaying(!v.paused);
    // A browser that stops by itself (some do at the loop) is started again, but not while a page changes.
    if (v.paused && wanted.current) {
      const mine = change.current;
      setTimeout(() => { if (mine === change.current && !changing.current && i === pageRef.current && wanted.current && v.paused && !v.error && !document.hidden) void start(v); }, 80);
    }
  };

  const loading = problem !== "video" && (!started || buffering);
  const message = problem === "video" ? (offline ? "You're offline. Check your internet connection." : "This video couldn't be loaded. Please try again.")
    : offline && loading ? "You're offline. We'll continue when you're back."
    : blocked ? "Tap to play"
    : problem === "page" ? "This product couldn't be loaded. Please try again."
    : !started && slow ? "Still loading. Your connection seems slow."
    : null;

  return (
    <div ref={wrap} className={`wrap ${below ? "below" : ""}`} style={{ gap: GAP }}>
      <div className={`stage grid ${playing ? "" : "paused"}`} style={{ width: w, height: h }} onClick={toggle}>
        {list.map((p, i) => {
          const n = Math.max(0, p.items.indexOf(p.items.includes(shown) ? shown : p.items.includes(active) ? active : p.items[0]));
          const s = w / p.tileW, x = (n % p.cols) * (p.tileW + 2 * p.pad) + p.pad, y = Math.floor(n / p.cols) * (p.tileH + 2 * p.pad) + p.pad;
          return (
            <video key={i} ref={(el) => { videos.current[i] = el; }} muted playsInline loop preload="auto" disablePictureInPicture
              aria-label={ad.items[p.items[n]]?.label} aria-hidden={!p.items.includes(shown)}
              style={{ width: p.cols * (p.tileW + 2 * p.pad) * s, height: p.rows * (p.tileH + 2 * p.pad) * s, transform: `translate3d(${-x * s}px, ${-y * s}px, 0)`,
                zIndex: i === pageRef.current ? 2 : i === under.current ? 1 : 0 }}
              onPlay={(e) => onPlayState(i, e.currentTarget)} onPause={(e) => onPlayState(i, e.currentTarget)}
              onPlaying={() => { if (i === pageRef.current) { setStarted(true); setBuffering(false); } }}
              onWaiting={(e) => {
                const v = e.currentTarget, at = v.currentTime; // a moment without data at the loop is normal
                setTimeout(() => { if (i === pageRef.current && !v.paused && v.readyState < 3 && v.currentTime === at) setBuffering(true); }, 700);
              }}
              onTimeUpdate={(e) => { if (i === pageRef.current && buffering && pageOf(active) === i && e.currentTarget.readyState >= 3) setBuffering(false); }}
              onError={(e) => { if (i === pageRef.current && e.currentTarget.dataset.src) giveUp(); }} />
          );
        })}
        {loading && <div className="loading"><span className="spinner" aria-hidden="true" /></div>}
        <div className={`notice ${problem === "video" ? "full" : ""} ${message ? "" : "empty"}`} role={problem ? "alert" : "status"}>
          {message && <span>{message}</span>}
          {loading && !message && <span className="sr">Loading</span>}
          {problem === "video" && <button type="button" onClick={(e) => { e.stopPropagation(); retry(); }}>Try again</button>}
        </div>
        {problem !== "video" && (
          <div className="controls" onClick={(e) => e.stopPropagation()}>
            <button type="button" aria-label={playing ? "Pause" : "Play"} onClick={toggle}><Icon name={playing ? "pause" : "play"} /></button>
            <button type="button" aria-label={sound ? "Mute" : "Unmute"} onClick={toggleSound}><Icon name={sound ? "sound" : "muted"} /></button>
          </div>
        )}
      </div>
      {ad.items.length > 1 && (
        <div className="products" role="group" aria-label="Choose a product"
          style={below ? { height: strip, width: "100%" } : { width: side, maxHeight: h || undefined }}>
          {ad.items.map((it, i) => (
            <button key={it.video} type="button" aria-pressed={i === active} aria-label={it.label} className={`product ${i === active ? "on" : ""}`} title={it.label}
              onClick={() => select(i)}>
              <span className="swatch" style={{ backgroundColor: it.color }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
