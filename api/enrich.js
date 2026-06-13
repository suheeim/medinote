// 公式サイト情報の自動補完：製品名から用法用量を Claude + Web検索 で取得する
// POST /api/enrich { name: "製品名（規格・mg含む）" }
//
// 設計メモ：
//  - まず Vercel KV を見る（キャッシュヒットなら検索もAPIも呼ばない＝コストゼロ）
//  - 無ければ Claude を web_search ツール付きで呼び、公式/一次情報源の用法用量だけ抽出
//  - Web検索はモデルが citations を必ず付けるため、構造化出力(output_config.format)とは
//    併用できない（400になる）。よってプロンプトで JSON を指示し、堅牢にパースする
//  - 取れた結果のみ KV に保存してから返す
import { kv } from './_kv.js';

// ---- 調整しやすいよう定数化 --------------------------------------------------
const MODEL = 'claude-haiku-4-5';            // コスト重視。精度不足なら 'claude-sonnet-4-6' に変更
const WEB_SEARCH_TOOL = 'web_search_20250305'; // Haiku対応の標準版。
//   ※ 最新の web_search_20260209 は dynamic filtering が Opus/Sonnet/Fable 専用かつ
//     code_execution ツールが必須なので、Haiku を使う本用途では 20250305 を採用。
const MAX_WEB_SEARCHES = 3;                  // 1製品あたりの検索回数上限（無駄打ち防止）
const MAX_TURNS = 4;                         // pause_turn の継続上限
const CACHE_PREFIX = 'enrich:v1:';
const CACHE_TTL = 60 * 60 * 24 * 180;        // 確認できた結果：180日（製品情報はそう頻繁に変わらない）
const MEALS = ['none', 'before', 'after', 'between'];
const SLOTS = ['morning', 'noon', 'evening', 'bed'];

// 製品名 → 正規化したキャッシュキー
function normalizeName(name) {
  return String(name || '')
    .normalize('NFKC')      // 全角/半角・互換文字を統一
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPrompt(name) {
  return `あなたは医薬品情報の調査アシスタントです。次の製品の「用法・用量」を調べてください。

製品名: ${name}

【調査方法】
- web_search ツールで、メーカー公式サイト または 一次情報源（医薬品添付文書・インタビューフォーム・メーカーの製品ページ等）を探す。
- そこで実際に確認できた情報「だけ」を抽出する。
- 確認できない項目は推測やうろ覚えで埋めず、必ず空にする。

【出力形式】
最後に、説明文なしで次の JSON オブジェクトだけを出力してください（マークダウンのコードフェンス不要）。
各項目は「値(value)」と「出典URL(source)」をセットで持たせます。出典は実際に参照した公式/一次情報源のURLにすること。
確認できなかった項目は value を空（timings は空配列）、source を空文字 "" にしてください。

{
  "dose":    { "value": "1回の服用量。例: 1回6錠 / 1回1カプセル", "source": "https://..." },
  "meal":    { "value": "none|before|after|between のいずれか（食前=before, 食後=after, 食間=between, 指定なし=none）", "source": "https://..." },
  "timings": { "value": ["morning","noon","evening","bed のうち該当するもの"], "source": "https://..." },
  "note":    { "value": "服用上の注意など補足（任意）", "source": "https://..." },
  "confirmed": true（公式/一次情報源で確認できた場合）/ false（できなかった場合）
}`;
}

// content配列 から最終的な text を集めて JSON を取り出す
function extractJson(content) {
  const txt = (content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n');
  try { return JSON.parse(txt); } catch (_) {}
  const m = txt.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (_) {} }
  return null;
}

// web_search のツール側エラー（レート超過等の一時障害）を検出
function searchErrorCode(content) {
  for (const b of (content || [])) {
    if (b.type === 'web_search_tool_result') {
      const c = b.content;
      if (c && c.type === 'web_search_tool_result_error') return c.error_code;
    }
  }
  return null;
}

// 1項目を {value, source} に正規化。source が無効なら未確認扱いで値も破棄する
function fieldOf(v, { array = false, enumVals = null } = {}) {
  const empty = { value: array ? [] : '', source: '' };
  if (!v || typeof v !== 'object') return empty;
  const source = typeof v.source === 'string' ? v.source.trim() : '';
  // 出典が http(s) URLでなければ「未確認」とみなし、値は採用しない
  if (!/^https?:\/\//i.test(source)) return empty;

  if (array) {
    const arr = Array.isArray(v.value) ? v.value.filter(x => SLOTS.includes(x)) : [];
    return arr.length ? { value: arr, source } : empty;
  }
  let value = typeof v.value === 'string' ? v.value.trim() : '';
  if (!value) return empty;
  if (enumVals && !enumVals.includes(value)) return empty;
  return { value, source };
}

function buildResult(obj) {
  return {
    dose:    fieldOf(obj && obj.dose),
    meal:    fieldOf(obj && obj.meal, { enumVals: MEALS }),
    timings: fieldOf(obj && obj.timings, { array: true }),
    note:    fieldOf(obj && obj.note),
    confirmed: !!(obj && obj.confirmed),
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POSTのみ' });

  const KEY = process.env.ANTHROPIC_API_KEY;
  try {
    if (!KEY) throw new Error('ANTHROPIC_API_KEY が未設定です');

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const name = (body.name || '').toString().trim();
    if (!name) return res.status(400).json({ error: '製品名(name)が必要です' });

    const cacheKey = CACHE_PREFIX + normalizeName(name);

    // 1) キャッシュ：あれば検索もAPIも呼ばずに返す
    try {
      const cached = await kv.get(cacheKey);
      if (cached) return res.json({ result: cached, cached: true });
    } catch (_) { /* KV障害時は検索にフォールバック */ }

    // 2) Claude + Web検索（pause_turn を継続しながら最終応答まで進める）
    let messages = [{ role: 'user', content: buildPrompt(name) }];
    let data = null;
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1500,
          messages,
          tools: [{ type: WEB_SEARCH_TOOL, name: 'web_search', max_uses: MAX_WEB_SEARCHES }],
        }),
      });
      data = await r.json();
      if (!r.ok) {
        return res.status(r.status).json({ error: data?.error?.message || ('APIエラー (' + r.status + ')') });
      }
      if (data.stop_reason === 'pause_turn') {
        // サーバー側ツールループの継続：assistant応答を積んで再送
        messages = [...messages, { role: 'assistant', content: data.content }];
        continue;
      }
      break;
    }

    // 検索が一時的に失敗（レート超過等）→ キャッシュせず 503。フロントはこの製品をスキップ。
    const errCode = searchErrorCode(data && data.content);
    if (errCode && ['too_many_requests', 'unavailable'].includes(errCode)) {
      return res.status(503).json({ error: '検索が一時的に利用できません', code: errCode });
    }

    const obj = extractJson(data && data.content);
    const result = buildResult(obj);

    // 3) 確認できた結果（出典のある項目が1つ以上）だけ KV に保存。
    //    見つからなかった結果・パース不能はキャッシュせず、次回スキャン時に再検索する。
    const anySource = !!(result.dose.source || result.meal.source || result.timings.source || result.note.source);
    if (anySource) {
      try { await kv.set(cacheKey, result, { ex: CACHE_TTL }); } catch (_) { /* 保存失敗は無視 */ }
    }

    return res.json({ result, cached: false });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
