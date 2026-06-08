// LINE Login の認可画面へリダイレクトする
// GET /api/line/login?return=<連携後に戻るURL>
export default function handler(req, res){
  const CHANNEL_ID = process.env.LINE_LOGIN_CHANNEL_ID || '2010328955';
  const BASE = process.env.BASE_URL || 'https://project-53ect.vercel.app';
  const redirectUri = `${BASE}/api/line/callback`;

  // 連携後にアプリへ戻すURL（既定は GitHub Pages）
  const returnTo = (req.query.return || 'https://suheeim.github.io/medinote/').toString();
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  // state に戻り先を埋め込む（callback で取り出す）
  const state = nonce + '|' + Buffer.from(returnTo).toString('base64url');

  const url = new URL('https://access.line.me/oauth2/v2.1/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CHANNEL_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', 'profile openid');
  url.searchParams.set('bot_prompt', 'aggressive'); // 友だち追加も同時に促す

  res.setHeader('Set-Cookie', `line_state=${nonce}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`);
  res.redirect(302, url.toString());
}
