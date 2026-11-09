/** Starts the phone listener. `hws phone` runs this with plain Node and sets the variables in docs/CONTRACT.md. */

import { createPhoneService } from './service';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`phone host: ${name} is required`);
    process.exit(2);
  }
  return value;
}

const service = createPhoneService({
  dataDir: required('HWS_PHONE_DATA'),
  socketPath: required('HWS_PHONE_SOCKET'),
  hws: required('HWS_BIN'),
  ...(process.env.HWS_PHONE_HOST ? { host: process.env.HWS_PHONE_HOST } : {}),
  ...(process.env.HWS_PHONE_PORT ? { port: Number(process.env.HWS_PHONE_PORT) } : {}),
  onExit: () => process.exit(0),
});

for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM'] as const) process.on(signal, () => void service.stop());

service.start().then(
  (started) => {
    if (!started) process.exit(0);
  },
  (err: Error) => {
    console.error(`phone host: ${err.message}`);
    process.exit(1);
  },
);
