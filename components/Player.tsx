"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Ad } from "@/lib/ads";

export const GAP = 12;
const SWATCH = 58;
const WAIT = 20000; // longest wait for all videos to buffer before starting (ms)
const SLOW = 6000; // after this, say that it's slow
const STALL = 500; // a video without data for this long holds all of them, so they stay in step
const FADE = 140; // a switch fades the new video in over the old one (ms)
const GIVE_UP = 15000; // a video stalled this long is left out, so the others can go on

/** Products beside or below the video, whichever leaves the video larger. Never above its rendered size. */
export function layout(W: number, H: number, ad: Ad) {
  const fit = (w: number, h: number) => Math.max(0, Math.min(1, w / ad.width, h / ad.height));
  if (ad.items.length < 2) return { below: false, side: 0, strip: 0, scale: fit(W, H) };
  const side = SWATCH, strip = SWATCH; // the column / row of colors
  const beside = fit(W - side - GAP, H), under = fit(W, H - strip - GAP);
  return { below: under > beside, side, strip, scale: Math.max(beside, under) };
}

const ICONS = {
  play: "M8 5v14l11-7z", pause: "M6 5h4v14H6zm8 0h4v14h-4z",
  sound: "M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z",
  muted: "M3 9v6h4l5 5V4L7 9zm18.5.9-1.4-1.4-2.1 2.1-2.1-2.1-1.4 1.4 2.1 2.1-2.1 2.1 1.4 1.4 2.1-2.1 2.1 2.1 1.4-1.4-2.1-2.1z",
};
export const Icon = ({ name }: { name: keyof typeof ICONS }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d={ICONS[name]} /></svg>
);

// Browser calls that can throw or reject never may break the page.
export const safely = (f: () => void) => { try { f(); } catch { /* the next step copes without it */ } };
/** "ok" also when it hasn't started within 10 s: the stall handling takes over then. */
export const tryPlay = (v: HTMLVideoElement): Promise<"ok" | "blocked" | "failed"> => new Promise((r) => {
  const t = setTimeout(() => r("ok"), 10000);
  const done = (x: "ok" | "blocked" | "failed") => { clearTimeout(t); r(x); };
  try {
    Promise.resolve(v.play()).then(() => done("ok"), (e) => done(v.error ? "failed" : e?.name === "NotAllowedError" ? "blocked" : "failed"));
  } catch { done("failed"); }
});

// All videos are stacked in one frame, all painted, and play in lockstep; the selected one is on top (and audible), so
// switching product continues from the exact same moment. Autoplay waits until EVERY video can play through, then all
// start together and loop together. A video that fails to load is left out; the others still work.
export default function Player({ ad, sound: startWithSound }: { ad: Ad; sound: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const videos = useRef<(HTMLVideoElement | null)[]>([]);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [active, setActive] = useState(0);
  const [sound, setSound] = useState(startWithSound);
  const [ready, setReady] = useState(false);
  const [slow, setSlow] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [blocked, setBlocked] = useState(false); // the browser wants a tap before anything plays
  const [buffering, setBuffering] = useState(false);
  const [offline, setOffline] = useState(false);
  const [failed, setFailed] = useState<number[]>([]);
  const [round, setRound] = useState(0); // one more with every "Try again"
  const failedRef = useRef(new Set<number>());
  const playingRef = useRef(false);
  const holding = useRef(0); // since when everything waits for a stalled video; 0 = it doesn't
  const soundRef = useRef(sound);
  const activeRef = useRef(0);
  const order = useRef<number[]>(ad.items.map((_, i) => i).reverse()); // the stack of videos, the last one on top
  const switching = useRef(0); // the newest switch wins
  const attempt = useRef(0); // the newest play/pause wins over one still starting

  const list = () => videos.current.filter((v, i): v is HTMLVideoElement => !!v && !v.error && !failedRef.current.has(i));
  const lead = () => list()[0];
  const mark = useCallback((p: boolean) => { playingRef.current = p; setPlaying(p); }, []);
  const release = useCallback(() => { holding.current = 0; setBuffering(false); }, []);

  const applyAudio = useCallback(() => {
    videos.current.forEach((v, i) => { if (v) v.muted = !(soundRef.current && i === activeRef.current); });
  }, []);
  const changeSound = useCallback((on: boolean) => { soundRef.current = on; setSound(on); applyAudio(); }, [applyAudio]);
  const stack = useCallback(() => order.current.forEach((i, z) => { const v = videos.current[i]; if (v) v.style.zIndex = String(z); }), []);
  useEffect(stack, [stack]);
  // Browsers give hidden videos low priority, so hiding one and showing another can leave a gap in which the black
  // background shows. Here nothing is ever hidden: the new video waits for a fresh frame, then fades in on top.
  const select = useCallback((i: number) => {
    const mine = ++switching.current;
    activeRef.current = i;
    setActive(i);
    applyAudio();
    const v = videos.current[i];
    if (!v || order.current[order.current.length - 1] === i) return;
    let done = false;
    const raise = () => {
      if (done || mine !== switching.current) return;
      done = true;
      order.current = [...order.current.filter((k) => k !== i), i];
      stack();
      safely(() => {
        if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        v.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE, easing: "linear" });
      });
    };
    if (v.paused || !v.requestVideoFrameCallback) raise();
    else { v.requestVideoFrameCallback(raise); setTimeout(raise, 250); }
  }, [applyAudio, stack]);

  const fail = useCallback((i: number) => {
    if (failedRef.current.has(i)) return;
    failedRef.current.add(i);
    setFailed([...failedRef.current]);
    safely(() => videos.current[i]?.pause());
    if (i === activeRef.current) { // show the first one that works
      const next = videos.current.findIndex((v, k) => v && !failedRef.current.has(k));
      if (next >= 0) select(next);
    }
    if (failedRef.current.size >= videos.current.length) mark(false);
  }, [select, mark]);

  const playAll = useCallback(async (from?: number) => {
    const mine = ++attempt.current;
    release();
    const vs = list();
    if (!vs.length) return mark(false);
    const t = from ?? vs[0].currentTime ?? 0;
    vs.forEach((v) => safely(() => { v.pause(); v.playbackRate = 1; v.currentTime = t; }));
    applyAudio();
    const start = () => Promise.all(vs.map(tryPlay));
    const slowStart = setTimeout(() => { if (mine === attempt.current) setBuffering(true); }, 1500);
    let res = await start();
    if (mine === attempt.current && res.includes("blocked") && soundRef.current) { // no sound before the viewer interacts: start muted
      changeSound(false);
      res = await start();
    }
    clearTimeout(slowStart);
    if (mine !== attempt.current) return; // a newer play or pause took over
    setBuffering(false);
    const stopped = res.includes("blocked");
    vs.forEach((v, k) => { if (res[k] === "failed" && v.error) fail(videos.current.indexOf(v)); });
    const started = !stopped && res.some((r) => r === "ok");
    if (!started) vs.forEach((v) => safely(() => v.pause()));
    setBlocked(stopped);
    mark(started);
  }, [applyAudio, changeSound, fail, mark, release]);

  const pauseAll = useCallback(() => {
    attempt.current++;
    release();
    list().forEach((v) => safely(() => v.pause()));
    mark(false);
  }, [mark, release]);

  // Also works while still loading, e.g. where a browser won't preload without a tap.
  const toggle = () => {
    if (!list().length) return;
    setReady(true);
    setBlocked(false);
    if (playingRef.current) pauseAll();
    else void playAll();
  };

  /** Load the failed videos again, then start all together from the beginning. */
  const retry = useCallback(() => {
    pauseAll();
    const again = [...failedRef.current];
    failedRef.current.clear();
    setFailed([]);
    setBlocked(false);
    again.forEach((i) => safely(() => videos.current[i]?.load()));
    setRound((r) => r + 1);
  }, [pauseAll]);

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

  // Back online: load what failed meanwhile.
  useEffect(() => {
    const off = () => setOffline(true);
    const on = () => { setOffline(false); if (failedRef.current.size) retry(); };
    setOffline(navigator.onLine === false);
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    return () => { window.removeEventListener("offline", off); window.removeEventListener("online", on); };
  }, [retry]);

  // Autoplay once every video has buffered enough to play through. Not for viewers who asked for less motion.
  useEffect(() => {
    let stop = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    setReady(false);
    setSlow(false);
    timers.push(setTimeout(() => setSlow(true), SLOW));
    const vs = videos.current.filter((v): v is HTMLVideoElement => !!v);
    vs.forEach((v, i) => { if (v.error) fail(i); }); // failed before this page's script ran
    const before = attempt.current;
    void Promise.all(vs.map((v) => v.readyState >= 4 || v.error ? null : new Promise<void>((r) => {
      v.addEventListener("canplaythrough", () => r(), { once: true });
      v.addEventListener("error", () => r(), { once: true });
      timers.push(setTimeout(r, WAIT));
    }))).then(() => {
      if (stop) return;
      setReady(true);
      let still = false;
      safely(() => { still = matchMedia("(prefers-reduced-motion: reduce)").matches; });
      if (attempt.current === before && !still) void playAll(0);
    });
    return () => { stop = true; timers.forEach(clearTimeout); };
  }, [playAll, fail, round]);

  // 10x a second while playing: wait together for a stalled video, and correct drift (small offsets by running a
  // follower slightly faster or slower, big ones with a seek).
  useEffect(() => {
    const since = new Map<HTMLVideoElement, number>();
    const t = setInterval(() => safely(() => {
      if (!playingRef.current || document.hidden) { since.clear(); return; }
      const all = list(), now = Date.now();
      if (!all.length) return;
      for (const v of all) {
        if (v.readyState < 3 && !v.ended) { if (!since.has(v)) since.set(v, now); } else since.delete(v);
      }
      const stalled = all.filter((v) => since.has(v) && now - since.get(v)! > STALL);
      if (stalled.length) {
        if (!holding.current) {
          holding.current = now;
          setBuffering(true);
          all.forEach((v) => v.pause()); // they keep loading
        } else if (now - holding.current > GIVE_UP && navigator.onLine !== false) {
          stalled.forEach((v) => { since.delete(v); fail(videos.current.indexOf(v)); });
        }
        return;
      }
      if (holding.current) {
        if (!list().length) return release();
        void playAll(Math.min(...all.map((v) => v.currentTime)));
        return;
      }
      const [first, ...rest] = all;
      if (first.paused || first.seeking) return;
      for (const v of rest) {
        if (v.paused || v.seeking) continue;
        const drift = v.currentTime - first.currentTime;
        if (Math.abs(drift) > 0.5) { v.currentTime = first.currentTime; v.playbackRate = 1; }
        else if (Math.abs(drift) > 0.02) v.playbackRate = 1 - Math.max(-0.15, Math.min(0.15, drift * 2));
        else v.playbackRate = 1;
      }
    }), 100);
    return () => clearInterval(t);
  }, [fail, playAll, release]);

  const { below, side, strip, scale } = layout(box.w, box.h, ad);
  const w = Math.round(ad.width * scale), h = Math.round(ad.height * scale);
  const none = failed.length >= ad.items.length;
  const loading = !none && (!ready || buffering);
  const message = none ? (offline ? "You're offline. Check your internet connection." : "This video couldn't be loaded. Please try again.")
    : offline && (loading || failed.length) ? "You're offline. We'll continue when you're back."
    : blocked ? "Tap to play"
    : !ready && slow ? "Still loading. Your connection seems slow. Tap to start now."
    : buffering ? "Buffering…"
    : failed.length ? (failed.length === 1 ? "One product couldn't be loaded." : "Some products couldn't be loaded.") : null;
  const canRetry = none || (failed.length > 0 && !loading && !blocked);

  return (
    <div ref={wrap} className={`wrap ${below ? "below" : ""}`}>
      <div className={`stage ${playing ? "" : "paused"}`} style={{ width: w, height: h }} onClick={toggle}>
        {ad.items.map((it, i) => (
          <video key={it.video} ref={(el) => { videos.current[i] = el; }} src={it.video} muted playsInline preload="auto"
            className={`${i === active ? "on" : ""} ${failed.includes(i) ? "failed" : ""}`} aria-label={it.label} aria-hidden={i !== active} disablePictureInPicture
            onError={() => fail(i)}
            // Loop: when the first video ends, everything restarts together.
            onEnded={(e) => { if (playingRef.current && e.currentTarget === lead()) void playAll(0); }} />
        ))}
        {loading && <div className="loading"><span className="spinner" aria-hidden="true" /></div>}
        <div className={`notice ${none ? "full" : ""} ${message ? "" : "empty"}`} role={none ? "alert" : "status"}>
          {message && <span>{message}</span>}
          {loading && !message && <span className="sr">Loading</span>}
          {message && canRetry && <button type="button" onClick={(e) => { e.stopPropagation(); retry(); }}>Try again</button>}
        </div>
        {!none && (
          <div className="controls" onClick={(e) => e.stopPropagation()}>
            <button type="button" aria-label={playing ? "Pause" : "Play"} onClick={toggle}><Icon name={playing ? "pause" : "play"} /></button>
            <button type="button" aria-label={sound ? "Mute" : "Unmute"} onClick={() => changeSound(!sound)}>
              <Icon name={sound ? "sound" : "muted"} />
            </button>
          </div>
        )}
      </div>
      {ad.items.length > 1 && (
        <div className="products" role="group" aria-label="Choose a product"
          style={below ? { height: strip, width: "100%" } : { width: side, maxHeight: h || undefined }}>
          {ad.items.map((it, i) => (
            <button key={it.video} type="button" aria-pressed={i === active} disabled={failed.includes(i)}
              aria-label={failed.includes(i) ? `${it.label} (couldn't be loaded)` : it.label}
              className={`product ${i === active ? "on" : ""}`} onClick={() => select(i)}>
              <span className="swatch" style={{ backgroundColor: it.color }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
