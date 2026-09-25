import { spawn } from 'node:child_process';

/**
 * Windows DPAPI (CurrentUser scope) through PowerShell: only the same Windows
 * account on the same machine can decrypt. Values travel base64-encoded over
 * stdin/stdout, never as process arguments.
 */
const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$req = [Console]::In.ReadToEnd() | ConvertFrom-Json
$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
$entropy = [Text.Encoding]::UTF8.GetBytes('hefesto-engine-studio')
$out = @()
foreach ($item in $req.items) {
  $bytes = [Convert]::FromBase64String($item)
  if ($req.op -eq 'protect') {
    $out += [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, $scope))
  } else {
    $out += [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, $scope))
  }
}
[Console]::Out.Write((ConvertTo-Json -InputObject @($out) -Compress))
`;

const ENCODED_SCRIPT = Buffer.from(SCRIPT, 'utf16le').toString('base64');

function runDpapi(op: 'protect' | 'unprotect', items: string[]): Promise<string[]> {
  if (items.length === 0) return Promise.resolve([]);
  if (process.platform !== 'win32') {
    return Promise.reject(new Error('La bóveda de claves usa DPAPI y solo funciona en Windows'));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', ENCODED_SCRIPT],
      { windowsHide: true },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`DPAPI falló (${code}): ${stderr.trim().split('\n')[0] ?? ''}`));
      try {
        resolve(JSON.parse(stdout) as string[]);
      } catch {
        reject(new Error('DPAPI devolvió una respuesta inválida'));
      }
    });
    child.stdin.end(JSON.stringify({ op, items }));
  });
}

export interface SecretCipher {
  encrypt(plain: string[]): Promise<string[]>;
  decrypt(blobs: string[]): Promise<string[]>;
}

export const dpapiCipher: SecretCipher = {
  async encrypt(plain) {
    return runDpapi('protect', plain.map((p) => Buffer.from(p, 'utf8').toString('base64')));
  },
  async decrypt(blobs) {
    const out = await runDpapi('unprotect', blobs);
    return out.map((b) => Buffer.from(b, 'base64').toString('utf8'));
  },
};
