import { execFileSync } from 'node:child_process';

export function loadSettings() {
  try { process.loadEnvFile(new URL('./.env', import.meta.url)); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('서버 설정 파일을 읽지 못했습니다.'); }
  // The desktop app may have started before the user registered a Windows variable.
  // Capture only this key into process memory. Never print or persist the value.
  if (!process.env.KRX_API_KEY?.trim() && process.platform === 'win32') {
    try {
      const value = execFileSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        "[Console]::Out.Write([Environment]::GetEnvironmentVariable('KRX_API_KEY','User'))"
      ], { encoding:'utf8', windowsHide:true, stdio:['ignore','pipe','ignore'], timeout:10000 }).trim();
      if (value) process.env.KRX_API_KEY = value;
    } catch { /* An unavailable desktop setting is reported as unconfigured. */ }
  }
}
