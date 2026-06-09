// LINE Login のコールバック。アクセストークン取得 → userId 取得 → 保存 → アプリへ戻す
// GET /api/line/callback?code=...&state=...
import { kv } from '../_kv.js';

export default async function handler(req, res){
  const CHANNEL_ID = process.env.LINE_LOGIN_CHANNEL_ID || '2010328955';
  const CHANNEL_SECRET = process.env.LINE_LOGIN_CHANNEL_SECRET;
  const BASE = process.env.BASE_URL || 'https://project-53ect.vercel.app';
  const redirectUri = `${BASE}/api/line/callback`;

  try{
    const { code, state, error, error_description } = req.query;
    if(error) throw new Error(`${error}: ${error_description||''}`);
    if(!code) throw new Error('認可コードがありません');
    if(!CHANNEL_SECRET) throw new Error('LINE_LOGIN_CHANNEL_SECRET が未設定です');

    // state から戻り先とリンクコードを復元
    let returnTo = 'https://suheeim.github.io/medinote/';
    const stateParts = String(state).split('|');
    try{ returnTo = Buffer.from(stateParts[1], 'base64url').toString(); }catch(_){}
    const linkCode = (stateParts[2] || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);

    // 認可コード → アクセストークン
    const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: CHANNEL_ID,
        client_secret: CHANNEL_SECRET
      })
    });
    const tok = await tokenRes.json();
    if(!tok.access_token) throw new Error('トークン取得失敗: ' + JSON.stringify(tok));

    // プロフィール取得（userId）
    const profRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: 'Bearer ' + tok.access_token }
    });
    const prof = await profRes.json();
    if(!prof.userId) throw new Error('userId取得失敗: ' + JSON.stringify(prof));

    // 登録
    await kv.sadd('medinote:users', prof.userId);

    // リンクコードに連携結果を保存（PWAがポーリングで取得。10分で失効）
    if(linkCode){
      await kv.set('medinote:link:' + linkCode,
        { userId: prof.userId, name: prof.displayName || '' },
        { ex: 600 });
    }

    const sep = returnTo.includes('?') ? '&' : '?';
    res.redirect(302, `${returnTo}${sep}line=${encodeURIComponent(prof.userId)}&lineName=${encodeURIComponent(prof.displayName||'')}`);
  }catch(e){
    res.status(500).send('LINE連携に失敗しました: ' + e.message);
  }
}
