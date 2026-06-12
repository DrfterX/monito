#!/usr/bin/env node
/**
 * scripts/update-product-page.mjs
 *
 * Injects the Early Access waitlist form into product-page.ts.
 * - Adds CSS for the waitlist section
 * - Inserts an #early-access section between #monitors and #cta
 * - Adds JS for form submission via fetch POST /api/waitlist
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

// ── Injection 1: Waitlist CSS (before closing </style>) ────────────────────

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

// ── Injection 2: Waitlist HTML section (after #monitors, before #cta) ──────

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

// Insert after the #monitors section closing, before CTA comment
html = html.replace(
  '<!-- ════════════════════════════════════════════════════════════════\n       CTA\n       ════════════════════════════════════════════════════════════════ -->\n\n  <section id="cta">',
  WAITLIST_HTML + '\n\n  <!-- ════════════════════════════════════════════════════════════════\n       CTA\n       ════════════════════════════════════════════════════════════════ -->\n\n  <section id="cta">'
)

// ── Injection 3: JS for waitlist form handling ─────────────────────────────

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
            // Refresh count
            loadWaitlistCount();
          } else if (res.status === 400) {
            waitlistMessage.className = 'waitlist-message error';
            waitlistMessage.textContent = data.error || 'Invalid input. Please check your email.';
          } else {
            // Already registered, still a good thing
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

html = html.replace(
  'const API_BASE = \'https://monito.yycomyy.workers.dev\';',
  'const API_BASE = \'https://monito.yycomyy.workers.dev\';' + WAITLIST_JS
)

// ── Re-escape and write ─────────────────────────────────────────────────────

const escaped = html
  .replace(/\\/g, '\\\\')
  .replace(/"/g, '\\"')
  .replace(/\n/g, '\\n')
  .replace(/\t/g, '\\t')

const newContent = `// Auto-generated — includes Early Access waitlist (Cycle #23)\n// Do not edit directly — regenerate with: node scripts/update-product-page.mjs\n\nexport const PRODUCT_PAGE_HTML: string = "${escaped}";\n`

writeFileSync(filePath, newContent, 'utf8')
console.log('✅ Updated product-page.ts with Early Access waitlist.')
