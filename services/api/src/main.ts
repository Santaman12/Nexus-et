import { createApp } from './app.js';
import { config } from './config.js';

if (process.env.NODE_ENV === 'production' && config.jwtSecret === 'nexus-development-secret-change-me') {
  console.error('[nexus-api] FATAL: JWT_SECRET is still the development default. Set a strong JWT_SECRET before deploying.');
  process.exit(1);
}

const app = createApp();

app.listen(config.port, '0.0.0.0', () => {
  console.log(`[nexus-api] listening on http://0.0.0.0:${config.port}`);
});
