import { config as loadDotenv } from 'dotenv';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

loadDotenv();

const workspaceRoot = process.env['HEFESTO_ROOT'] ?? process.cwd();

/** Resolved paths and settings. Secrets live in the SecretVault, never here. */
export const env = {
  /** Working directory for the DB, channels, assets and logs. */
  home: resolve(process.env['HEFESTO_HOME'] || join(homedir(), 'HefestoHome')),
  /** Folder with ffmpeg, ffprobe, whisper-cli and models (filled by tools/fetch-binaries.ts). */
  binDir: resolve(process.env['HEFESTO_BIN_DIR'] || join(workspaceRoot, 'bin')),
  /** Static data shipped with the repo (Bible, fonts...). */
  dataDir: resolve(join(workspaceRoot, 'data')),
  /** 'auto' | 'h264_nvenc' | 'h264_qsv' | 'h264_amf' | 'libx264' */
  encoder: process.env['HEFESTO_ENCODER'] || 'auto',
  whisperModel: process.env['HEFESTO_WHISPER_MODEL'] || 'ggml-large-v3-turbo-q5_0.bin',
};

export const paths = {
  db: () => join(env.home, 'hefesto.db'),
  /** API keys and tokens, encrypted with Windows DPAPI (see secrets/secret-vault.ts). */
  secrets: () => join(env.home, 'secrets.json'),
  channel: (slug: string) => join(env.home, 'channels', slug),
  production: (slug: string, productionId: string) =>
    join(env.home, 'channels', slug, 'productions', productionId),
  assets: () => join(env.home, 'assets'),
  /** Short voice-preview samples generated from Ajustes (not tied to a production). */
  previews: () => join(env.home, 'previews'),
  logs: () => join(env.home, 'logs'),
  bin: (name: string) => join(env.binDir, process.platform === 'win32' ? `${name}.exe` : name),
  model: (file: string) => join(env.binDir, 'models', file),
};
