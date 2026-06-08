// 診断用：登録ユーザーと保存済みスケジュールを確認する
// GET /api/debug            → 一覧を表示
// GET /api/debug?clean=1    → TESTUSER* のテストデータを削除
import { kv } from './_kv.js';

export default async function handler(req, res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  try{
    const users = (await kv.smembers('medinote:users')) || [];

    if(req.query.clean === '1'){
      const removed = [];
      for(const u of users){
        if(String(u).startsWith('TESTUSER')){
          await kv.srem('medinote:users', u);
          await kv.del('medinote:sched:' + u);
          removed.push(u);
        }
      }
      return res.json({ ok: true, removed });
    }

    const nowUtc = Date.now();
    const schedules = [];
    for(const u of users){
      const s = await kv.get('medinote:sched:' + u);
      const tz = (s && Number.isFinite(s.tzOffset)) ? s.tzOffset : -540;
      const local = new Date(nowUtc - tz * 60000);
      schedules.push({
        user: String(u).slice(0, 10) + '…',
        isTest: String(u).startsWith('TESTUSER'),
        reminders: s?.reminders || [],
        tzOffset: s?.tzOffset,
        localTime: local.toISOString().slice(11, 16) + ' (ユーザー現地)',
        updated: s?.updated ? new Date(s.updated).toISOString() : null
      });
    }
    res.json({ nowUtc: new Date(nowUtc).toISOString(), userCount: users.length, schedules });
  }catch(e){
    res.status(500).json({ error: e.message });
  }
}
