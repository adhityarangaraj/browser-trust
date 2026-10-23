/** Fixed synthetic request sequence shared by the browser fixture and local server. */
export const LOOTRUSH_ACTIVITY_REQUESTS = Object.freeze([
  Object.freeze({
    endpoint: '/api/session',
    payload: Object.freeze({ event: 'demo.session.start', demoId: 'lootrush-local-01', sequence: 1 }),
  }),
  Object.freeze({
    endpoint: '/api/devices',
    payload: Object.freeze({ event: 'demo.device.register', deviceClass: 'desktop-demo', synthetic: true }),
  }),
  Object.freeze({
    endpoint: '/api/telemetry',
    payload: Object.freeze({ event: 'demo.rewards.viewed', section: 'featured', synthetic: true }),
  }),
  Object.freeze({
    endpoint: '/api/preferences',
    payload: Object.freeze({ event: 'demo.preferences.sync', theme: 'dark', currency: 'DEMO' }),
  }),
  Object.freeze({
    endpoint: '/api/analytics',
    payload: Object.freeze({ event: 'demo.page.view', page: 'home', sample: true }),
  }),
  Object.freeze({
    endpoint: '/api/sync',
    payload: Object.freeze({ event: 'demo.workspace.sync', workspace: 'rewards-preview', synthetic: true }),
  }),
  Object.freeze({
    endpoint: '/api/events',
    payload: Object.freeze({ event: 'demo.claim.preview', severity: 'demo-only', synthetic: true }),
  }),
]);

export const LOOTRUSH_SEQUENCE_DELAY_MS = 420;
