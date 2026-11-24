# ad-player

Plays product-switcher ads from your CDN, by link: `/ad/<id>` shows the ad in `ads/<id>/`. It's an independent Next.js app:
no keys, no uploads, no other project. Its only setting is `CDN_URL` in `.env` (your custom domain).

```
npm install
npm run dev      # http://localhost:3100/ad/<id>
```

It reads `CDN_URL/ads/<id>/manifest.json` and plays the items in it (items with `"show": false` are skipped). Changes show up
within a minute. To deploy, set `CDN_URL` on the host.

Link options: `?theme=dark`, `?bg=transparent` (in an iframe), `?sound=1` (most browsers then wait for a click).
