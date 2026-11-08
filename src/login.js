import { spawn } from 'child_process';
import path from 'path';

// Opens your regular Chrome (no automation) with a dedicated profile so you can sign in to Google.
// Google refuses sign-in in Playwright-controlled browsers. Sign in, then quit Chrome (Cmd+Q);
// the crawler reuses this profile via USER_DATA_DIR.
const dir = path.resolve(process.env.USER_DATA_DIR || './.chrome-profile');
console.log(`Opening Chrome with profile ${dir}. Sign in to Google, then quit Chrome (Cmd+Q).`);
const child = spawn(
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  [`--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', 'https://accounts.google.com/'],
  { stdio: 'ignore' }
);
child.on('exit', () => console.log('Chrome closed. Profile saved.'));
