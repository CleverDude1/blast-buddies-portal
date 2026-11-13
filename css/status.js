/* ---- top bar: New API / Old API status buttons (colors come from css/style.css) ---- */
.api-status{display:flex;align-items:center;gap:8px}
.api-wrap{position:relative}
.api-pill{padding:0 14px;gap:9px;font-size:14px}
.api-dot{width:10px;height:10px;border-radius:50%;background:#6b7360;flex:none}
.api-pill.ok .api-dot{background:#4ade80;box-shadow:0 0 6px rgba(74,222,128,.6)}
.api-pill.warn .api-dot{background:#fbbf24;box-shadow:0 0 6px rgba(251,191,36,.55)}
.api-pill.down{border-color:#ff4d4d;animation:api-glow 1.6s ease-in-out infinite}
.api-pill.down .api-dot{background:#ff4d4d;box-shadow:0 0 8px #ff4d4d}
@keyframes api-glow{0%,100%{box-shadow:0 0 4px 0 rgba(255,60,60,.35)}50%{box-shadow:0 0 18px 3px rgba(255,60,60,.85)}}
@media(prefers-reduced-motion:reduce){.api-pill.down{animation:none;box-shadow:0 0 12px 2px rgba(255,60,60,.7)}}

.api-pop{position:absolute;right:0;top:52px;z-index:30;width:min(340px,86vw);background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;text-align:left}
.api-pop h4{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:15px}
.api-tag{font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px;background:#2b3524;color:#cfd3c4}
.api-tag.ok{background:#1d4a27;color:#8ff09b}.api-tag.warn{background:#4a3a1d;color:#ffd98b}.api-tag.down{background:#4a1d1d;color:#ff9b9b}
.api-pop p{margin-top:8px;font-size:13px;line-height:1.5;color:#cfd3c4}
.api-pop dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin-top:10px;font-size:13px}
.api-pop dt{color:var(--muted)}
.api-pop dd{text-align:right;font-weight:600}
.api-err{list-style:none;margin-top:10px;display:grid;gap:6px}
.api-err li{background:#0b0f08;border-radius:8px;padding:8px 10px;font-size:12px;color:#ffb3b3;word-break:break-word}
.api-err b{color:var(--text)}
.api-pop .api-note{margin-top:10px;font-size:11px;color:#7d8671}

@media(max-width:800px){.api-pill{padding:0 10px}.api-w{display:none}}
