const http = require('http');
const https = require('https');
const zlib = require('zlib');

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const MAX_EXTRACTED_TEXT = 50000;
const MAX_TURN_TEXT = 50000;

const PLATFORM_RULES = [
  { platform: '豆包', hosts: ['doubao.com'] },
  { platform: 'Kimi', hosts: ['kimi.com'] },
  { platform: 'DeepSeek', hosts: ['deepseek.com'] },
  { platform: '通义千问', hosts: ['qianwen.com'] },
  { platform: '腾讯元宝', hosts: ['yb.tencent.com', 'yuanbao.tencent.com'] }
];

async function enrichConversationsWithSharedLinks(conversations = []) {
  const result = [];
  for (const item of conversations) {
    const conversation = { ...item };
    if (conversation.link && !clean(conversation.answer)) {
      const extracted = await extractAiShareLink(conversation.link, conversation.platform);
      conversation.platform = conversation.platform || extracted.platform;
      conversation.question = conversation.question || extracted.question;
      conversation.answer = extracted.answer || '';
      conversation.extractionStatus = extracted.status;
      conversation.extractionNote = extracted.note;
      conversation.extractedTitle = extracted.title;
      conversation.turns = extracted.turns || [];
      conversation.assets = extracted.assets || emptyAssets();
    }
    result.push(conversation);
  }
  return result;
}

async function extractAiShareLink(link, platformHint = '') {
  const platform = platformHint || detectPlatform(link);
  try {
    try {
      const apiExtracted = await extractPlatformApiShare(link, platform);
      if (apiExtracted) return apiExtracted;
    } catch (error) {
      if (process.env.DEBUG_SHARE_EXTRACTOR === 'true') {
        console.warn(`[share-extractor] platform api failed: ${platform} ${error.message}`);
      }
      // Continue with the public HTML fallback when a platform API changes.
    }

    const response = await fetchText(link);
    if (response.statusCode >= 400) {
      return blockedResult({
        platform,
        title: '',
        note: `链接返回 ${response.statusCode}，无法自动读取正文`
      });
    }

    const html = response.body || '';
    const title = extractTitle(html);
    const meta = extractMetaDescription(html);
    const assets = extractStructuredAssets(html, link);
    const text = extractReadableText(html, { platform, title, meta });

    if (isSecurityOrEmptyPage({ text, title, meta, statusCode: response.statusCode })) {
      return blockedResult({
        platform,
        title,
        assets,
        note: '页面需要登录、验证或浏览器渲染，当前无法自动读取完整问答'
      });
    }

    const enoughForDiagnosis = hasDiagnosticText(text);
    if (enoughForDiagnosis) {
      const partial = hasPartialPageWarning(text) || isLikelyPartialExtraction(platform, text);
      const question = inferQuestion(text);
      return {
        ok: true,
        platform,
        title,
        status: partial ? '部分读取' : '已自动读取',
        question,
        answer: preserveText(text, MAX_EXTRACTED_TEXT),
        note: partial ? '已读取到部分问答正文，建议人工复核是否包含全部提问' : '已从公开分享页自动提取问答正文',
        turns: splitConversationTurns(text, question),
        assets: mergeAssets(assets, { tables: extractMarkdownTables(text) })
      };
    }

    const fallback = [title, meta].filter(Boolean).join('\n');
    if (fallback) {
      return {
        ok: false,
        platform,
        title,
        status: '部分读取',
        question: inferQuestion(fallback),
        answer: preserveText(fallback, 1200),
        note: '分享页只暴露标题或摘要，未读取到完整问答正文',
        turns: [],
        assets
      };
    }

    return blockedResult({
      platform,
      title,
      assets,
      note: '分享页未暴露可读取的问答正文'
    });
  } catch (error) {
    return blockedResult({
      platform,
      title: '',
      note: `自动读取失败：${error.message}`
    });
  }
}

async function extractPlatformApiShare(link, platform) {
  if (platform === '通义千问' || /qianwen\.com/.test(link)) {
    return extractQianwenShare(link, platform);
  }
  if (platform === 'DeepSeek' || /deepseek\.com/.test(link)) {
    return extractDeepSeekShare(link, platform);
  }
  return null;
}

async function extractQianwenShare(link, platform) {
  const shareId = extractShareId(link);
  if (!shareId) return null;
  const response = await requestJson({
    method: 'POST',
    url: 'https://chat2-api.qianwen.com/api/v1/share/info?pr=qwen&fr=mac',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://www.qianwen.com',
      'Referer': link
    },
    body: {
      share_id: shareId,
      biz_id: 'ai_qwen'
    }
  });
  if (!response || response.statusCode >= 400 || !response.json) return null;
  const data = response.json.data || {};
  const session = data.session || {};
  const records = Array.isArray(session.record_list) ? session.record_list : [];
  const turns = records.map((record, index) => {
    const question = firstContent(record.request_messages);
    const answer = bestResponseContent(record.response_messages);
    return {
      questionId: `T${String(index + 1).padStart(2, '0')}`,
      question: limitText(question, 220),
      answer: preserveText(answer, MAX_TURN_TEXT)
    };
  }).filter((turn) => turn.question && turn.answer);

  if (!turns.length) return null;
  const answer = turns.map((turn) => `提问：${turn.question}\n回答：${turn.answer}`).join('\n\n');
  const assets = mergeAssets(
    extractStructuredAssets(JSON.stringify(response.json), link),
    { tables: extractMarkdownTables(answer) }
  );
  return {
    ok: true,
    platform,
    title: clean(data.title || session.title || '通义千问分享会话'),
    status: '已自动读取',
    question: turns[0].question || '通义千问分享会话自动提取',
    answer: preserveText(answer, MAX_EXTRACTED_TEXT),
    note: `已通过通义千问分享接口读取 ${turns.length} 轮问答`,
    turns,
    assets
  };
}

async function extractDeepSeekShare(link, platform) {
  const shareId = extractShareId(link);
  if (!shareId) return null;
  const response = await requestJson({
    method: 'GET',
    url: `https://chat.deepseek.com/api/v0/share/content?share_id=${encodeURIComponent(shareId)}`,
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Origin': 'https://chat.deepseek.com',
      'Referer': link
    }
  });
  if (!response || response.statusCode >= 400 || !response.json) return null;
  const payload = (((response.json || {}).data || {}).biz_data) || {};
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const byParent = new Map();
  for (const message of messages) {
    const parentId = message.parent_id == null ? '' : String(message.parent_id);
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId).push(message);
  }
  const userMessages = messages.filter((message) => message.role === 'USER');
  const turns = userMessages.map((message, index) => {
    const children = byParent.get(String(message.message_id)) || [];
    const assistant = children.find((item) => item.role === 'ASSISTANT')
      || messages.find((item) => item.role === 'ASSISTANT' && item.message_id > message.message_id);
    return {
      questionId: `T${String(index + 1).padStart(2, '0')}`,
      question: limitText(message.content, 220),
      answer: preserveText(assistant && assistant.content, MAX_TURN_TEXT)
    };
  }).filter((turn) => turn.question && turn.answer);

  if (!turns.length) return null;
  const answer = turns.map((turn) => `提问：${turn.question}\n回答：${turn.answer}`).join('\n\n');
  const assets = mergeAssets(
    extractStructuredAssets(JSON.stringify(response.json), link),
    { tables: extractMarkdownTables(answer) }
  );
  return {
    ok: true,
    platform,
    title: clean(payload.title || 'DeepSeek分享会话'),
    status: '已自动读取',
    question: turns[0].question || 'DeepSeek分享会话自动提取',
    answer: preserveText(answer, MAX_EXTRACTED_TEXT),
    note: `已通过DeepSeek分享接口读取 ${turns.length} 轮问答`,
    turns,
    assets
  };
}

function requestJson({ method, url, headers = {}, body }) {
  const target = new URL(url);
  const client = target.protocol === 'http:' ? http : https;
  const payload = body == null ? null : Buffer.from(JSON.stringify(body));

  return new Promise((resolve, reject) => {
    const req = client.request({
      method,
      hostname: target.hostname,
      path: `${target.pathname}${target.search}`,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5',
        ...headers,
        ...(payload ? { 'Content-Length': payload.length } : {})
      },
      timeout: 15000
    }, (res) => {
      const chunks = [];
      let received = 0;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (received <= MAX_RESPONSE_BYTES) chunks.push(chunk);
      });
      res.on('end', () => {
        decodeBody(Buffer.concat(chunks), res.headers['content-encoding'])
          .then((text) => {
            let json = null;
            try {
              json = JSON.parse(text);
            } catch (error) {
              json = null;
            }
            resolve({
              statusCode: res.statusCode || 0,
              contentType: res.headers['content-type'] || '',
              text,
              json
            });
          })
          .catch(reject);
      });
    });

    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

function extractShareId(link) {
  try {
    const url = new URL(link);
    return clean(url.searchParams.get('share_id'))
      || clean(url.pathname.split('/').filter(Boolean).pop());
  } catch (error) {
    return '';
  }
}

function firstContent(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const message = list.find((item) => clean(item && item.content));
  return clean(message && message.content);
}

function bestResponseContent(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const candidates = list
    .map((item) => ({
      mimeType: clean(item && item.mime_type),
      content: normalizeText(decodeHtmlEntities(decodeJsEscapes(clean(item && item.content))))
    }))
    .filter((item) => item.content && /[\u4e00-\u9fa5]/.test(item.content))
    .filter((item) => !(/^<div\b/i.test(item.content) && /card_card_video|video_note_list|data-tpl/.test(item.content)))
    .sort((a, b) => {
      const aFinal = /multi_load|markdown|text|iframe/.test(a.mimeType) ? 1 : 0;
      const bFinal = /multi_load|markdown|text|iframe/.test(b.mimeType) ? 1 : 0;
      if (aFinal !== bFinal) return bFinal - aFinal;
      return b.content.length - a.content.length;
    })
    .map((item) => item.content);
  if (!candidates.length) return '';
  return candidates[0];
}

function fetchText(link, redirectCount = 0) {
  const url = new URL(link);
  const client = url.protocol === 'http:' ? http : https;

  return new Promise((resolve, reject) => {
    const req = client.request({
      method: 'GET',
      hostname: url.hostname,
      path: `${url.pathname}${url.search}`,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br'
      },
      timeout: 15000
    }, (res) => {
      const location = res.headers.location;
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && location && redirectCount < 4) {
        res.resume();
        resolve(fetchText(new URL(location, url).toString(), redirectCount + 1));
        return;
      }

      const chunks = [];
      let received = 0;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (received <= MAX_RESPONSE_BYTES) chunks.push(chunk);
      });
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        decodeBody(buffer, res.headers['content-encoding'])
          .then((body) => resolve({
            statusCode: res.statusCode || 0,
            contentType: res.headers['content-type'] || '',
            body
          }))
          .catch(reject);
      });
    });

    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.end();
  });
}

function decodeBody(buffer, encoding = '') {
  const value = String(encoding || '').toLowerCase();
  if (value.includes('br')) {
    return inflate(buffer, zlib.brotliDecompress);
  }
  if (value.includes('gzip')) {
    return inflate(buffer, zlib.gunzip);
  }
  if (value.includes('deflate')) {
    return inflate(buffer, zlib.inflate);
  }
  return Promise.resolve(buffer.toString('utf8'));
}

function inflate(buffer, fn) {
  return new Promise((resolve, reject) => {
    fn(buffer, (error, output) => {
      if (error) reject(error);
      else resolve(output.toString('utf8'));
    });
  });
}

function extractReadableText(html, { platform, title, meta }) {
  const conversationText = extractConversationText(html);
  const visible = htmlToText(html);
  const jsonText = extractJsonText(html);
  const decodedRaw = decodeHtmlEntities(decodeJsEscapes(decodeHtmlEntities(html)));
  const rawText = extractChineseRuns(decodedRaw);
  const preferred = [conversationText, visible, jsonText, rawText]
    .map((value) => normalizeText(value))
    .filter(Boolean);

  const lines = [];
  for (const block of preferred) {
    for (const line of block.split(/\n+/)) {
      const cleaned = cleanReadableLine(line, { platform, title, meta });
      if (cleaned && !lines.includes(cleaned)) lines.push(cleaned);
      if (lines.join('\n').length > MAX_EXTRACTED_TEXT * 1.5) break;
    }
  }

  return trimNoise(lines.join('\n'), { title, meta });
}

function extractConversationText(html) {
  const decoded = decodeHtmlEntities(decodeJsEscapes(decodeHtmlEntities(html)));
  const blocks = [];
  const re = /(?:"text"|"tts_content"|"markdown"|"answer")\s*:\s*"([\s\S]*?)"/g;
  let match;
  while ((match = re.exec(decoded)) && blocks.length < 900) {
    const value = normalizeText(decodeJsEscapes(match[1]));
    if (!value || value.length < 8 || !/[\u4e00-\u9fa5]/.test(value)) continue;
    if (isBoilerplateLine(value)) continue;
    if (!blocks.includes(value)) blocks.push(value);
  }

  if (!blocks.length) return '';

  const question = blocks.find((block) => /[？?]/.test(block) && block.length <= 260);
  const candidates = blocks
    .filter((block) => block.length >= 120)
    .map((block) => ({ block, score: scoreConversationBlock(block) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.block);

  const selected = [];
  if (question) selected.push(question);
  for (const candidate of candidates) {
    if (selected.some((item) => item.includes(candidate) || candidate.includes(item))) continue;
    selected.push(candidate);
    if (selected.join('\n\n').length > MAX_EXTRACTED_TEXT * 1.2) break;
  }

  return selected.join('\n\n');
}

function htmlToText(html) {
  return decodeHtmlEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '\n')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|li|h[1-6]|blockquote|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
}

function extractJsonText(html) {
  const parts = [];
  const scriptMatches = html.match(/<script[^>]*type=["']application\/json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  const nextData = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>[\s\S]*?<\/script>/i);
  if (nextData) scriptMatches.push(nextData[0]);

  for (const script of scriptMatches) {
    const body = script.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '');
    try {
      const parsed = JSON.parse(decodeHtmlEntities(body));
      collectStrings(parsed, parts);
    } catch (error) {
      parts.push(decodeJsEscapes(decodeHtmlEntities(body)));
    }
  }

  return parts.join('\n');
}

function extractChineseRuns(value) {
  const matches = value.match(/[\u4e00-\u9fa5A-Za-z0-9_（）()《》“”"'：:，,。？！!?、；;\-\s]{24,}/g) || [];
  return matches
    .filter((item) => /[\u4e00-\u9fa5]/.test(item))
    .slice(0, 180)
    .join('\n');
}

function collectStrings(value, parts) {
  if (typeof value === 'string') {
    if (/[\u4e00-\u9fa5]/.test(value) && value.length >= 8) parts.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, parts));
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectStrings(item, parts));
  }
}

function cleanReadableLine(line, { platform, title, meta }) {
  const value = normalizeText(line)
    .replace(/\s+/g, ' ')
    .replace(/\\+"/g, '"')
    .trim();
  if (!value) return '';
  if (value.length < 8) return '';
  if (title && value === title) return '';
  if (meta && value === meta) return '';
  if (platform && value === platform) return '';
  if (isBoilerplateLine(value)) return '';
  if (/^(登录|注册|打开|下载|分享|复制|举报|隐私|用户协议|服务协议)$/.test(value)) return '';
  if (/^(window|document|webpack|function|var |const |let |\{|\[)/.test(value)) return '';
  if (/^[A-Za-z0-9_\-./:?=&%]+$/.test(value)) return '';
  if (!/[\u4e00-\u9fa5]/.test(value)) return '';
  return value;
}

function scoreConversationBlock(value) {
  let score = 0;
  if (/^#|^一、|^1[.、]|^首先|^根据|^公开|^目前|^很抱歉|^无法|^可以|^建议/.test(value)) score += 4;
  if (/旅如意|Lruyi|品牌|公司|平台|保险|旅行社|旅游|瑞幸|luckin|咖啡|拿铁|美式|生椰|厚乳|小黑杯|库迪|星巴克/.test(value)) score += 4;
  if (/主营|业务|关系|推荐|选择|服务商|竞品|信源|核实/.test(value)) score += 3;
  if (value.length > 400) score += 2;
  if (/搜索 \d+ 个关键词|参考 \d+ 篇资料|注册资本|统一社会信用代码|申请流程|商品服务列表/.test(value)) score -= 5;
  if (/[A-Za-z]{80,}/.test(value)) score -= 3;
  return score;
}

function isBoilerplateLine(value) {
  const hasDiagnosticContent = /旅如意|Lruyi|旅行社|旅游保险|瑞幸|luckin|咖啡|拿铁|美式|生椰|厚乳|小黑杯/.test(value) && value.length > 80;
  if (hasDiagnosticContent) return false;
  return /会话过期|重新登录|内容不准确|喜欢|不喜欢|页面资源加载异常|重新加载|DeepSeek AI,DeepSeek Chat|助力编程代码开发|点击全选以下消息|分享于\d{4}/.test(value)
    || /^[{}\[\],:"\s]+$/.test(value);
}

function trimNoise(value, { title, meta }) {
  const lines = normalizeText(value).split(/\n+/).filter(Boolean);
  const meaningful = lines.filter((line) => {
    if (line.length > 500 && !/[。？！]/.test(line)) return false;
    if (line.includes('请检查网络连接') || line.includes('JavaScript')) return false;
    return true;
  });
  const merged = meaningful.join('\n');
  if (hasDiagnosticText(merged)) return preserveText(merged, MAX_EXTRACTED_TEXT);
  return preserveText([title, meta, merged].filter(Boolean).join('\n'), MAX_EXTRACTED_TEXT);
}

function hasDiagnosticText(value) {
  const text = String(value || '');
  if (/初始强制检查|定义回调函数|data-theme|setAttribute|通义千问官网.*大模型/.test(text)) return false;
  const chineseCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const hasQuestionSignal = /[？?]|提问|回答|推荐|品牌|公司|平台|保险|旅行|服务商/.test(text);
  return chineseCount >= 120 && hasQuestionSignal;
}

function hasPartialPageWarning(value) {
  return /页面资源加载异常|重新加载|分享页只暴露|资源加载异常/.test(String(value || ''));
}

function isLikelyPartialExtraction(platform, value) {
  return platform === 'DeepSeek' && String(value || '').length < 1000;
}

function isSecurityOrEmptyPage({ text, title, meta, statusCode }) {
  const value = `${title}\n${meta}\n${text}`;
  if (statusCode === 202 && /security|verify|验证|安全|waf/i.test(value)) return true;
  if (/AWS WAF|Access Denied|安全验证|人机验证|请完成验证|登录后查看/.test(value)) return true;
  const chineseCount = (value.match(/[\u4e00-\u9fa5]/g) || []).length;
  return chineseCount < 20 && /security|captcha|verify|blocked/i.test(value);
}

function inferQuestion(value) {
  const lines = normalizeText(value).split(/\n+/).filter(Boolean);
  const explicit = lines.find((line) => /^提问[:：]/.test(line));
  if (explicit) return limitText(explicit.replace(/^提问[:：]\s*/, ''), 180);

  const question = lines.find((line) => /[？?]/.test(line) && line.length <= 220)
    || lines.find((line) => /(推荐|哪家|怎么选|是什么|有没有|适合)/.test(line) && line.length <= 220);
  return question ? limitText(question, 180) : '分享会话自动提取，包含多轮问答';
}

function splitConversationTurns(value, fallbackQuestion = '') {
  const lines = normalizeText(value)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isBoilerplateLine(line));
  const turns = [];
  let current = null;

  for (const line of lines) {
    const question = normalizeQuestionLine(line);
    if (question) {
      if (current) turns.push(finishTurn(current));
      current = {
        question,
        answerLines: []
      };
      continue;
    }

    if (current) {
      current.answerLines.push(line);
    }
  }

  if (current) turns.push(finishTurn(current));

  const usable = refineTurns(turns)
    .filter((turn) => turn.question && turn.answer.length >= 60)
    .map((turn, index) => ({
      questionId: `T${String(index + 1).padStart(2, '0')}`,
      question: limitText(turn.question, 220),
      answer: preserveText(turn.answer, MAX_TURN_TEXT)
    }));

  if (usable.length) return usable.slice(0, 12);
  const fallback = clean(fallbackQuestion);
  return fallback ? [{
    questionId: 'T01',
    question: limitText(fallback, 220),
    answer: preserveText(value, MAX_TURN_TEXT)
  }] : [];
}

function normalizeQuestionLine(line) {
  const embedded = clean(line).match(/"tts_content"\s*:\s*"([^"]{8,260}[？?][^"]{0,120})"/);
  if (embedded) return normalizeQuestionLine(embedded[1]);

  const value = clean(line)
    .replace(/^#+\s*/, '')
    .replace(/^[-*]\s*/, '')
    .replace(/^\d+[.、]\s*/, '')
    .replace(/^提问[:：]\s*/, '')
    .trim();
  if (!value) return '';
  if (value.length > 240) return '';
  if (!/[？?]$/.test(value) && !/[？?]/.test(value)) return '';
  if (/^(是否|可否|能否|有哪些|怎么|如何|什么|为什么|哪家|哪个|如果|我|我们|第一次|最近|旅行社|选择|比较|做)/.test(value)) return value;
  if (/品牌|公司|推荐|选择|比较|区别|适合|靠谱吗|可靠吗|怎么买|怎么样|是什么|有哪些|怎么判断/.test(value)) return value;
  return '';
}

function finishTurn(turn) {
  return {
    question: turn.question,
    answer: normalizeText(turn.answerLines.join('\n'))
  };
}

function refineTurns(turns) {
  const byQuestion = new Map();

  for (const turn of turns) {
    const question = normalizeText(turn.question);
    const answer = normalizeText(turn.answer);
    if (!question || !answer) continue;
    const key = questionKey(question);
    const score = scoreTurnRelevance(question, answer);
    const current = byQuestion.get(key);
    if (!current || score > current.score || (score === current.score && answer.length > current.answer.length)) {
      byQuestion.set(key, { question, answer, score });
    }
  }

  return Array.from(byQuestion.values()).map(({ question, answer }) => ({ question, answer }));
}

function questionKey(question) {
  return normalizeText(question)
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '')
    .slice(0, 80);
}

function scoreTurnRelevance(question, answer) {
  const q = normalizeText(question);
  const a = normalizeText(answer);
  let score = 0;
  for (const token of questionTokens(q)) {
    if (a.includes(token)) score += token.length >= 3 ? 3 : 1;
  }
  if (/哪|哪些|单品|值得试|推荐|口味/.test(q) && /推荐|单品|生椰|拿铁|美式|厚乳|口味|好喝|必喝|回购/.test(a)) score += 8;
  if (/热量|甜度|咖啡因|配料|资料|官方|第三方/.test(q) && /热量|甜度|咖啡因|配料|官方|小程序|APP|第三方/.test(a)) score += 8;
  if (/比较|怎么选|相比/.test(q) && /相比|对比|选择|更适合|优势|短板/.test(a)) score += 6;
  if (/外卖|踩雷|稳定/.test(q) && /外卖|配送|稳定|踩雷|冰块|温度/.test(a)) score += 6;
  if (/新品|年轻人/.test(q) && /新品|年轻人|联名|星巴克|库迪/.test(a)) score += 6;
  if (/初始强制检查|data-theme|setAttribute|官网,通义/.test(a)) score -= 30;
  return score;
}

function questionTokens(question) {
  return unique((question.match(/[\u4e00-\u9fa5]{2,6}|[A-Za-z0-9]{2,}/g) || [])
    .filter((token) => !/什么|哪些|如果|怎么|是否|有没有|一个|普通|用户|品牌/.test(token))
    .slice(0, 18));
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? normalizeText(decodeHtmlEntities(match[1])).replace(/\n/g, ' ') : '';
}

function extractMetaDescription(html) {
  const match = html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["'][^>]*>/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:description|og:description)["'][^>]*>/i);
  return match ? normalizeText(decodeHtmlEntities(match[1])).replace(/\n/g, ' ') : '';
}

function extractStructuredAssets(html, pageUrl = '') {
  const decoded = decodeHtmlEntities(decodeJsEscapes(decodeHtmlEntities(html)));
  const assets = {
    contentTypes: ['文字'],
    images: extractImages(decoded, pageUrl),
    videos: extractVideos(decoded, pageUrl),
    links: extractLinks(decoded, pageUrl),
    tables: unique([...extractTables(decoded), ...extractMarkdownTables(htmlToText(decoded))]).slice(0, 40)
  };

  if (assets.links.length) assets.contentTypes.push('链接');
  if (assets.images.length) assets.contentTypes.push('图片');
  if (assets.videos.length) assets.contentTypes.push('视频');
  if (assets.tables.length) assets.contentTypes.push('表格');
  assets.contentTypes = unique(assets.contentTypes);
  return assets;
}

function mergeAssets(...items) {
  const merged = emptyAssets();
  for (const item of items) {
    const assets = item && typeof item === 'object' ? item : {};
    merged.contentTypes.push(...(Array.isArray(assets.contentTypes) ? assets.contentTypes : []));
    merged.images.push(...(Array.isArray(assets.images) ? assets.images : []));
    merged.videos.push(...(Array.isArray(assets.videos) ? assets.videos : []));
    merged.links.push(...(Array.isArray(assets.links) ? assets.links : []));
    merged.tables.push(...(Array.isArray(assets.tables) ? assets.tables : []));
  }
  merged.images = unique(merged.images).slice(0, 120);
  merged.videos = unique(merged.videos).slice(0, 60);
  merged.links = unique(merged.links).slice(0, 160);
  merged.tables = unique(merged.tables).slice(0, 60);
  merged.contentTypes = unique([
    '文字',
    ...merged.contentTypes,
    merged.links.length ? '链接' : '',
    merged.images.length ? '图片' : '',
    merged.videos.length ? '视频' : '',
    merged.tables.length ? '表格' : ''
  ]);
  return merged;
}

function extractImages(html, pageUrl) {
  const urls = [];
  const tagRe = /<img\b[^>]*>/gi;
  let tagMatch;
  while ((tagMatch = tagRe.exec(html))) {
    const tag = tagMatch[0];
    ['src', 'data-src', 'data-original', 'data-url', 'poster'].forEach((attr) => {
      const value = extractAttr(tag, attr);
      if (value) urls.push(...splitSrcset(value));
    });
  }
  const urlRe = /https?:\/\/[^"'()<>\s]+?\.(?:png|jpe?g|webp|gif|svg)(?:\?[^"'()<>\s]*)?/gi;
  urls.push(...(html.match(urlRe) || []));
  return unique(urls.map((url) => normalizeAssetUrl(url, pageUrl)).filter(isUsefulMediaUrl)).slice(0, 80);
}

function extractVideos(html, pageUrl) {
  const urls = [];
  const tagRe = /<(?:video|source)\b[^>]*>/gi;
  let tagMatch;
  while ((tagMatch = tagRe.exec(html))) {
    const tag = tagMatch[0];
    ['src', 'data-src', 'poster'].forEach((attr) => {
      const value = extractAttr(tag, attr);
      if (value) urls.push(...splitSrcset(value));
    });
  }
  const urlRe = /https?:\/\/[^"'()<>\s]+?\.(?:mp4|m3u8|mov|webm)(?:\?[^"'()<>\s]*)?/gi;
  urls.push(...(html.match(urlRe) || []));
  return unique(urls.map((url) => normalizeAssetUrl(url, pageUrl)).filter(isUsefulMediaUrl)).slice(0, 40);
}

function extractLinks(html, pageUrl) {
  const links = [];
  const tagRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = tagRe.exec(html))) {
    const url = normalizeAssetUrl(match[1], pageUrl);
    if (!isUsefulLink(url)) continue;
    const label = normalizeText(htmlToText(match[2])).replace(/\n/g, ' ');
    links.push(label && label !== url ? `${label}：${url}` : url);
  }
  const urlRe = /https?:\/\/[^"'()<>\s，。；]+/gi;
  for (const url of html.match(urlRe) || []) {
    const normalized = normalizeAssetUrl(url, pageUrl);
    if (isUsefulLink(normalized)) links.push(normalized);
  }
  return unique(links).slice(0, 120);
}

function extractTables(html) {
  const tables = [];
  const tableRe = /<table\b[\s\S]*?<\/table>/gi;
  let tableMatch;
  while ((tableMatch = tableRe.exec(html))) {
    const rows = [];
    const rowRe = /<tr\b[\s\S]*?<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRe.exec(tableMatch[0]))) {
      const cells = [];
      const cellRe = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
      let cellMatch;
      while ((cellMatch = cellRe.exec(rowMatch[0]))) {
        const cell = normalizeText(htmlToText(cellMatch[1])).replace(/\n/g, ' ');
        if (cell) cells.push(cell);
      }
      if (cells.length) rows.push(cells);
    }
    if (rows.length) {
      tables.push(rows.map((row) => row.join(' | ')).join('\n'));
    }
  }
  return unique(tables).slice(0, 20);
}

function extractMarkdownTables(value) {
  const lines = normalizeText(value).split(/\n+/);
  const tables = [];
  let current = [];

  for (const line of lines) {
    const cellCount = (line.match(/\|/g) || []).length;
    if (cellCount >= 2 && line.length <= 1200) {
      current.push(line.trim());
      continue;
    }
    if (current.length >= 2) tables.push(current.join('\n'));
    current = [];
  }
  if (current.length >= 2) tables.push(current.join('\n'));

  return unique(tables).slice(0, 40);
}

function extractAttr(tag, attr) {
  const re = new RegExp(`${attr}=["']([^"']+)["']`, 'i');
  const match = String(tag || '').match(re);
  return match ? decodeHtmlEntities(match[1]) : '';
}

function splitSrcset(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function normalizeAssetUrl(value, pageUrl) {
  const raw = clean(value).replace(/\\\//g, '/');
  if (!raw || /^data:|^blob:|^javascript:/i.test(raw)) return '';
  try {
    return new URL(raw, pageUrl || undefined).toString();
  } catch (error) {
    return '';
  }
}

function isUsefulMediaUrl(url) {
  if (!url) return false;
  if (/avatar|favicon|logo|icon|sprite|blank|placeholder|transparent/i.test(url)) return false;
  return /^https?:\/\//.test(url);
}

function isUsefulLink(url) {
  if (!url) return false;
  if (!/^https?:\/\//.test(url)) return false;
  if (/favicon|static\/js|static\/css|\.css(?:\?|$)|\.js(?:\?|$)/i.test(url)) return false;
  return true;
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)));
}

function decodeJsEscapes(value) {
  return String(value || '')
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(/\\\//g, '/')
    .replace(/\\"/g, '"');
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\r/g, '\n')
    .replace(/\\\n/g, '\n')
    .replace(/\\{2,}/g, '\\')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function detectPlatform(link) {
  try {
    const hostname = new URL(link).hostname;
    const matched = PLATFORM_RULES.find((rule) => rule.hosts.some((host) => hostname.includes(host)));
    return matched ? matched.platform : '未标注平台';
  } catch (error) {
    return '未标注平台';
  }
}

function blockedResult({ platform, title, note, assets }) {
  return {
    ok: false,
    platform,
    title,
    status: '读取受限',
    question: '分享会话自动提取，包含多轮问答',
    answer: '',
    note,
    turns: [],
    assets: assets || emptyAssets()
  };
}

function preserveText(value, max) {
  const text = clean(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n（内容超过当前字段安全上限，已保留前 ${max} 字；原文仍需通过原分享链接复核）`;
}

function limitText(value, max) {
  const text = clean(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 18)}\n（内容较长，已截取）`;
}

function emptyAssets() {
  return {
    contentTypes: ['文字'],
    images: [],
    videos: [],
    links: [],
    tables: []
  };
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function clean(value) {
  return String(value || '').trim();
}

module.exports = {
  enrichConversationsWithSharedLinks,
  extractAiShareLink,
  splitConversationTurns,
  extractStructuredAssets
};
