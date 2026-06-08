// KVクライアント（Vercel KV / Upstash どちらの環境変数名でも動くように）
import { createClient } from '@vercel/kv';

export const kv = createClient({
  url:   process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});
