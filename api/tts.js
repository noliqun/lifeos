// Vercel Serverless Function - Edge TTS Proxy
// 浏览器通过 fetch('/api/tts?text=Hello&voice=en-US-AriaNeural') 调用

const EDGE_TTS_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const EDGE_TTS_WSS = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const WIN_EPOCH = 11644473600;

function uuid() {
  return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  }).toUpperCase();
}

async function genSecMsGec() {
  const now = Math.floor(Date.now() / 1000);
  let ticks = now + WIN_EPOCH;
  ticks -= ticks % 300;
  ticks = Math.floor(ticks * 1e7);
  const str = ticks + EDGE_TTS_TOKEN;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

async function synthesize(text, voice) {
  const secMsGec = await genSecMsGec();
  const connId = uuid();
  const url = `${EDGE_TTS_WSS}?TrustedClientToken=${EDGE_TTS_TOKEN}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=1-130.0.2849.68&ConnectionId=${connId}`;
  
  // 在 Node.js 环境中使用 ws 模块
  const WebSocket = require('ws');
  
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
        'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache'
      }
    });
    
    const audioChunks = [];
    let settled = false;
    
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { ws.close(); } catch(e) {}
        reject(new Error('Edge TTS timeout'));
      }
    }, 15000);
    
    ws.on('error', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error('WebSocket error'));
      }
    });
    
    ws.on('open', () => {
      const cmd = `X-Timestamp:${new Date()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":false,"wordBoundaryEnabled":true},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`;
      ws.send(cmd);
      
      const reqId = uuid();
      const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const ssml = `X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${new Date()}Z\r\nPath:ssml\r\n\r\n<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${voice}'><prosody pitch='+0Hz' rate='-10%' volume='+0%'>${escaped}</prosody></voice></speak>`;
      ws.send(ssml);
    });
    
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const buf = Buffer.from(data);
        if (buf.length >= 2) {
          const headerLen = (buf[0] << 8) | (buf[1] + 2);
          const header = buf.subarray(0, headerLen).toString('utf8');
          if (header.indexOf('Path:audio') === -1) return;
          const payload = buf.subarray(headerLen);
          audioChunks.push(payload);
        }
      } else {
        const msg = data.toString('utf8');
        if (msg.indexOf('Path:turn.end') !== -1) {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            try { ws.close(); } catch(e) {}
            if (audioChunks.length === 0) {
              reject(new Error('No audio data'));
            } else {
              const totalLen = audioChunks.reduce((s, c) => s + c.length, 0);
              const merged = Buffer.concat(audioChunks, totalLen);
              resolve(merged);
            }
          }
        }
      }
    });
  });
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  const { text, voice } = req.query;
  
  if (!text) {
    return res.status(400).json({ error: 'Missing text parameter' });
  }
  
  try {
    const audioBuffer = await synthesize(
      text.substring(0, 3000), 
      voice || 'en-US-AriaNeural'
    );
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.status(200).send(audioBuffer);
  } catch(e) {
    console.error('TTS Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
