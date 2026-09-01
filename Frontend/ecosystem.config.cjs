/**
 * PM2 process definitions — THIS IS WHERE THE TWO FRONTEND PORTS ARE DEFINED.
 *
 * `npm run build` produces two separate folders:
 *
 *     dist/staff    the internal app  (login, create, dashboard, admin log)
 *     dist/public   the client pages  (/s/<token> reveal, /r/<token> submit)
 *
 * Each folder needs something to hand its files out, so each gets one process
 * and one port. The ports are ordinary numbers with no meaning of their own —
 * 4173 is Vite's traditional preview port and 4174 is simply the next free one.
 *
 * THE PORTS ARE WRITTEN IN TWO PLACES AND MUST MATCH:
 *
 *     here                      -> tells `serve` which port to LISTEN on
 *     deploy/nginx.conf         -> tells nginx which port to CONNECT to
 *
 * Nothing checks that they agree. Change one and not the other and every page
 * returns 502 Bad Gateway, because nginx knocks on a door nobody is behind.
 *
 *     pm2 start ecosystem.config.cjs
 *     pm2 save
 *     pm2 startup        # run the command it prints, so this survives reboot
 */

// ---------------------------------------------------------------------------
// The port numbers. Change them here AND in deploy/nginx.conf, or not at all.
// ---------------------------------------------------------------------------
const STAFF_PORT = 4173 // serves dist/staff  -> vault.<domain>
const PUBLIC_PORT = 4174 // serves dist/public -> share.<domain>

/**
 * `-s` is SPA mode and is REQUIRED. React Router builds the URLs client-side,
 * so /s/<token> is not a real file on disk. Without -s a client opening a
 * secret link gets a 404 instead of the reveal page.
 *
 * `-l tcp://127.0.0.1:<port>` binds to the loopback interface ONLY. These two
 * servers must never be reachable from the internet — nginx terminates TLS and
 * is the single public entry point. Binding 0.0.0.0 here would publish the raw
 * static servers on the server's public IP.
 */
const staticServer = (name, dir, port) => ({
  name,
  // ABSOLUTE PATH, not the bare name. PM2 7.x accepts `script: 'serve'`,
  // reports the process as "online", and then never spawns it — no pid, no
  // error, empty logs, ports never bound. Verified on the production host.
  // If serve lives elsewhere, use the output of `which serve`.
  script: '/usr/bin/serve',
  args: `-s ${dir} -l tcp://127.0.0.1:${port}`,
  // `serve` is a binary on PATH (npm i -g serve), not a JS file for Node to run.
  // If PM2 ever reports "Script not found", replace `script` above with the
  // absolute path from `which serve`.
  interpreter: 'none',
  cwd: __dirname,
  autorestart: true,
  max_restarts: 10,
  // The bundles are static; restarting on file change would only add risk.
  watch: false,
})

module.exports = {
  apps: [
    staticServer('secureshare-staff', 'dist/staff', STAFF_PORT),
    staticServer('secureshare-public', 'dist/public', PUBLIC_PORT),
  ],
}
