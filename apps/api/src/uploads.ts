import { resolve } from 'node:path';

export function uploadDirectory() {
  return resolve(process.env.UPLOAD_DIR || resolve(process.cwd(), 'uploads'));
}
