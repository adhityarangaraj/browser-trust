# LootRush local security testbed

LootRush is a fictional gaming-rewards page used to generate repeatable, clearly synthetic browser activity for BrowserTrust. It does not authenticate users, process payments, deliver prizes, or contact third-party services.

## Run it

Requirements: Node.js 20 or newer. This package has no external dependencies.

From this directory:

```sh
npm start
```

Then open <http://127.0.0.1:4173/>. The server binds only to loopback. You can also run `npm test` here, or use the existing repository command `npm run testbed` from the repository root.

For BrowserTrust collection, load the built extension and grant access to the local page and request destination when prompted. The fixture page uses `127.0.0.1`; the repeated background POST sequence targets the `localhost` alias on the same loopback server so it appears as cross-origin browser metadata. No request leaves the local machine.

## Demo behavior

Click **Claim Your Reward** to start seven staggered JSON POST requests to `/api/session`, `/api/devices`, `/api/telemetry`, `/api/preferences`, `/api/analytics`, `/api/sync`, and `/api/events`. The requests run in order, once per page load. Each uses a fixed payload exported by `demo-activity.js`; the server accepts only those exact payloads and logs endpoint names, not arbitrary request bodies. The page also keeps the original synthetic `/collect` form action and local-storage marker interaction.

Use **Claim Your Reward** and confirm the demo claim to produce a trusted form-submit interaction and one local `/collect` POST. Claiming is only a preview and does not redeem a prize. Reward details, the profile, points, and leaderboard are static fictional data.

## Reset

Reload the page to rerun the seven-request sequence. The marker written by the demo claim is synthetic and can be removed from DevTools under Application → Local Storage. BrowserTrust activity can be cleared from its own UI before repeating a walkthrough.
