// scripts/https-server.js — Built-in HTTPS server for JARVIS Mission Control.
//
// FEAT-3: Lets the app serve TLS directly without a reverse proxy (Caddy /
// Nginx). Reads HTTPS_CERT + HTTPS_KEY env vars (file paths) and starts:
//
//   1. An HTTPS server on port HTTPS_PORT (default 3443) that proxies to
//      the Next.js standalone server on port 3000.
//   2. An HTTP server on port 3000 that 301-redirects every request to the
//      equivalent HTTPS URL.
//
// HSTS (Strict-Transport-Security) is set on every HTTPS response so
// browsers pin HTTPS for 1 year (with preload).
//
// This script uses ONLY Node's built-in `https`, `http`, `fs`, and `net`
// modules — no new dependencies. It is meant to be run AFTER `npm run build`
// has produced `.next/standalone/server.js`. The standalone server must be
// running on PORT (default 3000) — this script does NOT spawn it; instead
// it expects you to start it separately (e.g. via systemd) OR you can run
// `npm run build && (node .next/standalone/server.js &) && npm run start:https`.
//
// Recommended production flow:
//   1. sudo certbot certonly --standalone -d jarvis.example.com
//   2. export HTTPS_CERT=/etc/letsencrypt/live/jarvis.example.com/fullchain.pem
//   3. export HTTPS_KEY=/etc/letsencrypt/live/jarvis.example.com/privkey.pem
//   4. npm run build
//   5. node .next/standalone/server.js &   # listens on 3000
//   6. npm run start:https                 # listens on 3443 (TLS) + 3000 redirector
//
// See HTTPS.md for the full walkthrough.

const fs = require('fs')
const http = require('http')
const https = require('https')
const path = require('path')

const HTTPS_CERT = process.env.HTTPS_CERT
const HTTPS_KEY = process.env.HTTPS_KEY
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT || '3443', 10)
const HTTP_PORT = parseInt(process.env.PORT || '3000', 10)
const UPSTREAM_HOST = process.env.UPSTREAM_HOST || '127.0.0.1'
const UPSTREAM_PORT = parseInt(process.env.UPSTREAM_PORT || String(HTTP_PORT), 10)

// Resolve the public hostname for redirects. Prefer NEXTAUTH_URL (already
// required by the CSRF check in src/proxy.ts), then DASHBOARD_BASE.
function getPublicHost() {
  const url = process.env.NEXTAUTH_URL || process.env.DASHBOARD_BASE
  if (url) {
    try {
      const u = new URL(url)
      return u.hostname
    } catch {
      // fall through
    }
  }
  return null
}

function fail(msg) {
  console.error('[https-server] ' + msg)
  process.exit(1)
}

if (!HTTPS_CERT || !HTTPS_KEY) {
  fail(
    'HTTPS_CERT and HTTPS_KEY env vars must be set to file paths of a TLS ' +
    'certificate + private key. Get free certs via Let\'s Encrypt:\n' +
    '  sudo certbot certonly --standalone -d <your-domain>\n' +
    'Then set:\n' +
    '  HTTPS_CERT=/etc/letsencrypt/live/<your-domain>/fullchain.pem\n' +
    '  HTTPS_KEY=/etc/letsencrypt/live/<your-domain>/privkey.pem\n' +
    'See HTTPS.md for the full walkthrough.'
  )
}

let certBuf, keyBuf
try {
  certBuf = fs.readFileSync(HTTPS_CERT)
} catch (e) {
  fail('Cannot read HTTPS_CERT file "' + HTTPS_CERT + '": ' + e.message)
}
try {
  keyBuf = fs.readFileSync(HTTPS_KEY)
} catch (e) {
  fail('Cannot read HTTPS_KEY file "' + HTTPS_KEY + '": ' + e.message)
}

const HSTS_HEADER = 'max-age=31536000; includeSubDomains; preload'

// Generic HTTP reverse-proxy: forwards req to UPSTREAM_HOST:UPSTREAM_PORT
// and pipes the response back. Adds HSTS on TLS responses.
function proxyRequest(req, res, tls) {
  const opts = {
    host: UPSTREAM_HOST,
    port: UPSTREAM_PORT,
    method: req.method,
    path: req.url,
    headers: { ...req.headers, host: `${UPSTREAM_HOST}:${UPSTREAM_PORT}` },
  }

  // Forwarded-* headers so the upstream app sees the real client IP + protocol.
  const xff = req.headers['x-forwarded-for']
  opts.headers['x-forwarded-for'] = xff
    ? `${xff}, ${req.socket.remoteAddress}`
    : req.socket.remoteAddress
  opts.headers['x-forwarded-proto'] = tls ? 'https' : 'http'
  opts.headers['x-forwarded-host'] = req.headers.host || ''

  const upstream = http.request(opts, (upRes) => {
    if (tls) {
      upRes.headers['strict-transport-security'] = HSTS_HEADER
    }
    res.writeHead(upRes.statusCode || 200, upRes.headers)
    upRes.pipe(res, { end: true })
  })

  upstream.on('error', (err) => {
    console.error('[https-server] upstream error:', err.message)
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        error: 'Bad Gateway: upstream JARVIS server unreachable on ' +
          `${UPSTREAM_HOST}:${UPSTREAM_PORT}. Make sure the Next.js ` +
          'standalone server is running (e.g. `node .next/standalone/server.js`).',
      }))
    } else {
      try { res.end() } catch {}
    }
  })

  req.pipe(upstream, { end: true })
}

// HTTP→HTTPS redirector. Sends a 301 to the same URL on the HTTPS port.
// The HTTPS port is appended only when it's not 443 (standard HTTPS port).
function startHttpRedirector() {
  const redirector = http.createServer((req, res) => {
    const publicHost = getPublicHost() || req.headers.host || 'localhost'
    // Strip any existing port from the host header before appending HTTPS_PORT.
    const bareHost = publicHost.split(':')[0]
    const hostWithPort = HTTPS_PORT === 443
      ? bareHost
      : `${bareHost}:${HTTPS_PORT}`
    const target = `https://${hostWithPort}${req.url}`
    res.writeHead(301, {
      Location: target,
      'Strict-Transport-Security': HSTS_HEADER,
      'Content-Type': 'text/plain',
    })
    res.end(`Redirecting to ${target}\n`)
  })
  redirector.listen(HTTP_PORT, () => {
    console.log(`[https-server] HTTP redirector listening on :${HTTP_PORT} → https://:${HTTPS_PORT}`)
  })
  redirector.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[https-server] Port ${HTTP_PORT} already in use — assuming the Next.js ` +
        `standalone server is already running there. HTTP→HTTPS redirect is disabled; ` +
        `direct users to https://<host>:${HTTPS_PORT} instead.`)
    } else {
      console.error('[https-server] HTTP redirector error:', err.message)
    }
  })
  return redirector
}

// HTTPS server. Terminates TLS, then proxies to the upstream HTTP server.
function startHttpsServer() {
  const server = https.createServer(
    {
      cert: certBuf,
      key: keyBuf,
      // Reject TLS 1.0 / 1.1 (deprecated, vulnerable to BEAST/POODLE).
      minVersion: 'TLSv1.2',
    },
    (req, res) => proxyRequest(req, res, true)
  )
  server.listen(HTTPS_PORT, () => {
    console.log(`[https-server] HTTPS server listening on :${HTTPS_PORT}`)
    console.log(`[https-server]   cert: ${HTTPS_CERT}`)
    console.log(`[https-server]   upstream: http://${UPSTREAM_HOST}:${UPSTREAM_PORT}`)
    console.log(`[https-server]   HSTS: enabled (max-age=31536000; includeSubDomains; preload)`)
  })
  server.on('error', (err) => {
    console.error('[https-server] HTTPS server error:', err.message)
    process.exit(1)
  })
  return server
}

// ─── Boot ────────────────────────────────────────────────────────────
console.log('[https-server] Starting built-in HTTPS server (FEAT-3)...')
const httpsServer = startHttpsServer()
const httpRedirector = startHttpRedirector()

// Graceful shutdown.
function shutdown(signal) {
  console.log(`[https-server] ${signal} received — shutting down...`)
  httpsServer.close(() => {
    httpRedirector.close(() => {
      console.log('[https-server] All connections closed.')
      process.exit(0)
    })
  })
  // Force-exit after 5s if connections hang.
  setTimeout(() => {
    console.error('[https-server] Forced exit after 5s timeout.')
    process.exit(1)
  }, 5000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
