#!/usr/bin/env node
/**
 * scripts/inject-blog-banner.mjs
 *
 * Injects a dismissible blog landing banner into the product page.
 * - Banner sits between nav and hero
 * - Dismissible with localStorage persistence
 * - Links to /blog (configured via BLOG_URL env var)
 * - Industrial monitor theme styling with green accent
 *
 * Run after: update-product-page.mjs
 * Run before: wrangler deploy
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(__dirname, '../src')

// ── Read current product-page.ts ────────────────────────────────────────────

const filePath = resolve(SRC, 'product-page.ts')
let content = readFileSync(filePath, 'utf8')

const PREFIX = 'export const PRODUCT_PAGE_HTML: string = "'
const SUFFIX = '";'

const startIdx = content.indexOf(PREFIX) + PREFIX.length
const endIdx = content.lastIndexOf(SUFFIX)

if (startIdx < 0 || endIdx < 0) {
  throw new Error('Could not parse product-page.ts — unexpected format')
}

// Unescape the TS string into raw HTML
let html = content.slice(startIdx, endIdx)
  .replace(/\\n/g, '\n')
  .replace(/\\t/g, '\t')
  .replace(/\\"/g, '"')
  .replace(/\\\\/g, '\\')

// ── Injection 1: Blog banner CSS (before closing </style>) ─────────────────

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

// ── Injection 2: Blog banner HTML (after nav, before hero) ───────────────

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

// Insert right before the hero comment
html = html.replace(
  '<!-- ════════════════════════════════════════════════════════════════\n       HERO\n       ════════════════════════════════════════════════════════════════ -->',
  BLOG_BANNER_HTML + '\n\n  <!-- ════════════════════════════════════════════════════════════════\n       HERO\n       ════════════════════════════════════════════════════════════════ -->'
)

// ── Injection 3: Blog banner JS (dismiss with localStorage) ─────────────

const BLOG_BANNER_JS = `
    // ── Blog banner dismiss (persistent across visits) ──────────────────

    (function () {
      var banner = document.getElementById('blog-banner');
      var dismissBtn = document.getElementById('blogBannerDismiss');

      // Check if previously dismissed
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

// Inject before the closing of the main IIFE
html = html.replace(
  '\n  })();\n  </script>',
  BLOG_BANNER_JS + '\n  })();\n  </script>'
)

// ── Re-escape and write ─────────────────────────────────────────────────────

const escaped = html
  .replace(/\\/g, '\\\\')
  .replace(/"/g, '\\"')
  .replace(/\n/g, '\\n')
  .replace(/\t/g, '\\t')

const newContent = `// Auto-generated — includes Early Access waitlist (Cycle #23) & blog banner (Cycle #32)\n// Regenerate: node scripts/update-product-page.mjs && node scripts/inject-blog-banner.mjs\n// ─── Do NOT edit this file directly ───────────────────────────────────────\n\nexport const PRODUCT_PAGE_HTML: string = "${escaped}";\n`

writeFileSync(filePath, newContent, 'utf8')
console.log('✅ Updated product-page.ts with blog landing banner.')
