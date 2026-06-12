#!/usr/bin/env node
/**
 * scripts/generate-product-page.mjs
 *
 * One-pass generator: reads status/index.html, injects waitlist + blog banner,
 * encodes with JSON.stringify, writes src/product-page.ts.
 * Run after editing status/index.html.
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const htmlPath = resolve(ROOT, 'status/index.html')
const tsPath = resolve(ROOT, 'src/product-page.ts')

// ── 1. Read raw HTML ────────────────────────────────────────────────────────

let html = readFileSync(htmlPath, 'utf8')

// ── 2. Inject waitlist CSS (before </style>) ─────────────────────────────────

const WAITLIST_CSS = `
    /* ════════════════════════════════════════════════════════════════
       EARLY ACCESS / WAITLIST
       ════════════════════════════════════════════════════════════════ */

    #early-access {
      border-top: 1px solid var(--border);
      text-align: center;
      padding: 80px 0;
    }

    .waitlist-card {
      background: linear-gradient(135deg, rgba(59,130,246,0.04) 0%, rgba(59,130,246,0.01) 100%);
      border: 1px solid rgba(59,130,246,0.15);
      border-radius: var(--radius-lg);
      padding: 56px 40px;
      position: relative;
      overflow: hidden;
    }

    .waitlist-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 2px;
      background: linear-gradient(90deg, transparent, var(--accent), transparent);
    }

    .waitlist-card h2 {
      font-family: var(--font-mono);
      font-size: 28px;
      font-weight: 700;
      color: var(--text-primary);
      margin-bottom: 12px;
    }

    .waitlist-card p {
      font-size: 14px;
      color: var(--text-secondary);
      margin-bottom: 32px;
      max-width: 480px;
      margin-left: auto;
      margin-right: auto;
      line-height: 1.6;
    }

    .waitlist-form {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }

    .waitlist-form input[type="email"] {
      background: rgba(0,0,0,0.3);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 18px;
      min-width: 300px;
      font-family: var(--font-mono);
      font-size: 13px;
      color: var(--text-primary);
      outline: none;
      transition: border-color var(--transition), box-shadow var(--transition);
    }

    .waitlist-form input[type="email"]:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(59,130,246,0.12);
    }

    .waitlist-form input[type="email"]::placeholder {
      color: var(--text-muted);
    }

    .waitlist-form button {
      font-family: var(--font-mono);
      font-size: 13px;
      font-weight: 600;
      padding: 12px 24px;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      transition: all var(--transition);
      letter-spacing: 0.3px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .waitlist-form button[type="submit"] {
      background: var(--accent);
      color: #fff;
    }

    .waitlist-form button[type="submit"]:hover {
      background: #2563eb;
      box-shadow: 0 0 20px rgba(59,130,246,0.3);
    }

    .waitlist-form button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .waitlist-form button.btn-secondary-outline {
      all: unset;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-family: var(--font-mono);
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
      border: 1px solid var(--border);
      padding: 12px 24px;
      border-radius: 8px;
      cursor: pointer;
      transition: all var(--transition);
    }

    .waitlist-form button.btn-secondary-outline:hover {
      border-color: var(--text-muted);
      color: var(--text-primary);
    }

    .waitlist-message {
      font-family: var(--font-mono);
      font-size: 12px;
      min-height: 20px;
      margin-top: 4px;
    }

    .waitlist-message.success {
      color: var(--status-up);
    }

    .waitlist-message.error {
      color: var(--status-down);
    }

    .waitlist-message.info {
      color: var(--text-muted);
    }

    .waitlist-count {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 16px;
    }

    @media (max-width: 600px) {
      .waitlist-card { padding: 32px 20px; }
      .waitlist-card h2 { font-size: 22px; }
      .waitlist-form input[type="email"] { min-width: 100%; }
      .waitlist-form { flex-direction: column; }
    }
`

html = html.replace('</style>', WAITLIST_CSS + '\n  </style>')

// ── 3. Inject waitlist HTML (after #monitors, before #cta) ──────────────────

const WAITLIST_HTML = `
  <!-- ════════════════════════════════════════════════════════════════
       EARLY ACCESS
       ════════════════════════════════════════════════════════════════ -->

  <section id="early-access">
    <div class="container">
      <div class="waitlist-card fade-in">
        <div class="section-label">Early Access</div>
        <h2>Be the first to use monito SaaS</h2>
        <p>
          We're opening monito as a hosted service — configure monitors,
          get email alerts, and track uptime from a single dashboard.
          Sign up to get early access.
        </p>
        <form class="waitlist-form" id="waitlistForm">
          <input
            type="email"
            id="waitlistEmail"
            placeholder="your@email.com"
            required
            autocomplete="email"
          />
          <button type="submit">Get Early Access →</button>
        </form>
        <div class="waitlist-message info" id="waitlistMessage">
          No spam, unsubscribe anytime. I'll email you when it's ready.
        </div>
        <div class="waitlist-count" id="waitlistCount"></div>
      </div>
    </div>
  </section>
`

const CTA_COMMENT = `<!-- ════════════════════════════════════════════════════════════════
       CTA
       ════════════════════════════════════════════════════════════════ -->`

html = html.replace(CTA_COMMENT, WAITLIST_HTML.trim() + '\n\n  ' + CTA_COMMENT)

// ── 4. Inject waitlist JS (after API_BASE, before loadMonitors) ──────────────

const WAITLIST_JS = `

    // ── Waitlist form submission ────────────────────────────────────────

    const waitlistForm = document.getElementById('waitlistForm');
    const waitlistMessage = document.getElementById('waitlistMessage');
    const waitlistCount = document.getElementById('waitlistCount');

    if (waitlistForm) {
      waitlistForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('waitlistEmail').value.trim();
        const submitBtn = waitlistForm.querySelector('button[type="submit"]');

        if (!email) return;

        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting…';
        waitlistMessage.className = 'waitlist-message info';
        waitlistMessage.textContent = 'Registering…';

        try {
          const res = await fetch(API_BASE + '/api/waitlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
          });
          const data = await res.json();

          if (res.ok && data.success) {
            waitlistMessage.className = 'waitlist-message success';
            waitlistMessage.textContent = '✓ You\\'re on the list! I\\'ll notify you when it\\'s ready.';
            waitlistForm.querySelector('input').value = '';
            loadWaitlistCount();
          } else if (res.status === 400) {
            waitlistMessage.className = 'waitlist-message error';
            waitlistMessage.textContent = data.error || 'Invalid input. Please check your email.';
          } else {
            waitlistMessage.className = 'waitlist-message success';
            waitlistMessage.textContent = data.message || 'You\\'re already on the list!';
          }
        } catch (err) {
          waitlistMessage.className = 'waitlist-message error';
          waitlistMessage.textContent = 'Network error. Please try again.';
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Get Early Access →';
        }
      });
    }

    async function loadWaitlistCount() {
      try {
        const res = await fetch(API_BASE + '/api/waitlist/count');
        if (res.ok) {
          const data = await res.json();
          if (waitlistCount && data.count > 0) {
            waitlistCount.textContent = data.count + ' developer' + (data.count > 1 ? 's have' : ' has') + ' signed up';
          }
        }
      } catch (_) { /* ignore */ }
    }
    loadWaitlistCount();
`

html = html.replace("const API_BASE = 'https://monito.yycomyy.workers.dev';", "const API_BASE = 'https://monito.yycomyy.workers.dev';" + WAITLIST_JS)

// ── 5. Inject blog banner CSS (before </style>) ─────────────────────────────

const BLOG_BANNER_CSS = `
    /* ════════════════════════════════════════════════════════════════
       BLOG BANNER — Landing banner for the monito blog post
       ════════════════════════════════════════════════════════════════ */

    #blog-banner {
      background: linear-gradient(135deg, rgba(34,197,94,0.06) 0%, rgba(34,197,94,0.01) 100%);
      border-bottom: 1px solid rgba(34,197,94,0.12);
      position: relative;
      z-index: 5;
      overflow: hidden;
    }

    #blog-banner::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 1px;
      background: linear-gradient(90deg, transparent, var(--status-up), transparent);
      animation: banner-scan 3s ease-in-out infinite;
    }

    @keyframes banner-scan {
      0%, 100% { opacity: 0.2; transform: scaleX(0.8); }
      50% { opacity: 1; transform: scaleX(1); }
    }

    .banner-inner {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 0;
      font-family: var(--font-mono);
      font-size: 12px;
    }

    .banner-icon {
      font-size: 15px;
      flex-shrink: 0;
      line-height: 1;
    }

    .banner-tag {
      font-size: 9px;
      font-weight: 700;
      color: #0a0e14;
      background: var(--status-up);
      padding: 1px 5px;
      border-radius: 3px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      flex-shrink: 0;
      line-height: 1.3;
    }

    .banner-text {
      color: var(--text-secondary);
      flex: 1;
      line-height: 1.4;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .banner-text strong {
      color: var(--text-primary);
      font-weight: 600;
    }

    .banner-cta {
      color: var(--status-up) !important;
      font-weight: 600;
      white-space: nowrap;
      flex-shrink: 0;
      padding: 4px 12px;
      border: 1px solid rgba(34,197,94,0.25);
      border-radius: 4px;
      transition: all var(--transition);
      font-size: 11px;
    }

    .banner-cta:hover {
      background: rgba(34,197,94,0.1);
      border-color: rgba(34,197,94,0.4);
      box-shadow: 0 0 12px rgba(34,197,94,0.15);
    }

    .banner-dismiss {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 16px;
      cursor: pointer;
      padding: 0 4px;
      line-height: 1;
      flex-shrink: 0;
      transition: color var(--transition);
      font-family: var(--font-mono);
    }

    .banner-dismiss:hover {
      color: var(--text-primary);
    }

    @media (max-width: 700px) {
      .banner-inner { gap: 8px; font-size: 11px; }
      .banner-text {
        white-space: normal;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }
      .banner-cta { padding: 3px 8px; font-size: 10px; }
    }
`

html = html.replace('</style>', BLOG_BANNER_CSS + '\n  </style>')

// ── 6. Inject blog banner HTML (after nav, before hero) ────────────────────

const BLOG_BANNER_HTML = `
  <!-- ═══════════════════════════════════════════════════════════════════
       BLOG BANNER — "How I Built monito" blog post
       ═══════════════════════════════════════════════════════════════════ -->

  <div id="blog-banner" class="fade-in d1">
    <div class="container banner-inner">
      <span class="banner-icon">📖</span>
      <span class="banner-tag">New&nbsp;Blog</span>
      <span class="banner-text">
        <strong>How I Built a Multi-Tenant API Monitoring Service</strong>
        — on Cloudflare Workers for $0/mo
      </span>
      <a href="/blog" class="banner-cta">Read the Story →</a>
      <button class="banner-dismiss" id="blogBannerDismiss" aria-label="Dismiss">&times;</button>
    </div>
  </div>
`

const HERO_COMMENT = `<!-- ════════════════════════════════════════════════════════════════
       HERO
       ════════════════════════════════════════════════════════════════ -->`

html = html.replace(HERO_COMMENT, BLOG_BANNER_HTML.trim() + '\n\n  ' + HERO_COMMENT)

// ── 7. Inject blog banner JS (dismiss with localStorage, before closing IIFE) ──

const BLOG_BANNER_JS = `

    // ── Blog banner dismiss (persistent across visits) ──────────────────

    (function () {
      var banner = document.getElementById('blog-banner');
      var dismissBtn = document.getElementById('blogBannerDismiss');

      try {
        if (localStorage.getItem('monito_blog_banner_dismissed') && banner) {
          banner.style.display = 'none';
          banner = null;
        }
      } catch (_) {}

      if (dismissBtn && banner) {
        dismissBtn.addEventListener('click', function () {
          banner.style.display = 'none';
          try { localStorage.setItem('monito_blog_banner_dismissed', '1'); } catch (_) {}
        });
      }
    })();
`

html = html.replace('\n  })();\n  </script>', BLOG_BANNER_JS + '\n  })();\n  </script>')

// ── 8. Encode with JSON.stringify (100% correct escaping) ───────────────────

const inner = JSON.stringify(html).slice(1, -1)

const HEADER = `// Auto-generated — includes Early Access waitlist (Cycle #23) & blog banner (Cycle #32)
// To regenerate: delete this file and run: node scripts/generate-product-page.mjs
// ─── Do NOT edit this file directly ───────────────────────────────────────

export const PRODUCT_PAGE_HTML: string = "`

const FOOTER = '";\n'

const tsContent = HEADER + inner + FOOTER

writeFileSync(tsPath, tsContent, 'utf8')
console.log('✅ COMPLETE: product-page.ts generated with ALL sections (one-pass, no duplicates)')
console.log('   Size:', (tsContent.length / 1024).toFixed(1), 'KB')
