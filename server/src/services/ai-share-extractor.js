const http = require('http');
const https = require('https');
const zlib = require('zlib');

const MAX_RESPONSE_BYTES = 3 * 1024 * 1024;
const MAX_EXTRACTED_TEXT = 6500;

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
    }
    result.push(conversation);
  }
  return result;
}

async function extractAiShareLink(link, platformHint = '') {
  const platform = platformHint || detectPlatform(link);
  try {
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
    const text = extractReadableText(html, { platform, title, meta });

    if (isSecurityOrEmptyPage({ text, title, meta, statusCode: response.statusCode })) {
      return blockedResult({
        platform,
        title,
        note: '页面需要登录、验证或浏览器渲染，当前无法自动读取完整问答'
      });
    }

    const enoughForDiagnosis = hasDiagnosticText(text);
    if (enoughForDiagnosis) {
      const partial = hasPartialPageWarning(text) || isLikelyPartialExtraction(platform, text);
      return {
        ok: true,
        platform,
        title,
        status: partial ? '部分读取' : '已自动读取',
        question: inferQuestion(text),
        answer: limitText(text, MAX_EXTRACTED_TEXT),
        note: partial ? '已读取到部分问答正文，建议人工复核是否包含全部提问' : '已从公开分享页自动提取问答正文'
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
        answer: limitText(fallback, 1200),
        note: '分享页只暴露标题或摘要，未读取到完整问答正文'
      };
    }

    return blockedResult({
      platform,
      title,
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
  while ((match = re.exec(decoded)) && blocks.length < 260) {
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
    if (selected.join('\n\n').length > MAX_EXTRACTED_TEXT) break;
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
  if (/旅如意|Lruyi|品牌|公司|平台|保险|旅行社|旅游/.test(value)) score += 4;
  if (/主营|业务|关系|推荐|选择|服务商|竞品|信源|核实/.test(value)) score += 3;
  if (value.length > 400) score += 2;
  if (/搜索 \d+ 个关键词|参考 \d+ 篇资料|注册资本|统一社会信用代码|申请流程|商品服务列表/.test(value)) score -= 5;
  if (/[A-Za-z]{80,}/.test(value)) score -= 3;
  return score;
}

function isBoilerplateLine(value) {
  const hasDiagnosticContent = /旅如意|Lruyi|旅行社|旅游保险/.test(value) && value.length > 80;
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
  if (hasDiagnosticText(merged)) return limitText(merged, MAX_EXTRACTED_TEXT);
  return limitText([title, meta, merged].filter(Boolean).join('\n'), MAX_EXTRACTED_TEXT);
}

function hasDiagnosticText(value) {
  const text = String(value || '');
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

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? normalizeText(decodeHtmlEntities(match[1])).replace(/\n/g, ' ') : '';
}

function extractMetaDescription(html) {
  const match = html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["'][^>]*>/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:description|og:description)["'][^>]*>/i);
  return match ? normalizeText(decodeHtmlEntities(match[1])).replace(/\n/g, ' ') : '';
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

function blockedResult({ platform, title, note }) {
  return {
    ok: false,
    platform,
    title,
    status: '读取受限',
    question: '分享会话自动提取，包含多轮问答',
    answer: '',
    note
  };
}

function limitText(value, max) {
  const text = clean(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 18)}\n（内容较长，已截取）`;
}

function clean(value) {
  return String(value || '').trim();
}

module.exports = {
  enrichConversationsWithSharedLinks,
  extractAiShareLink
};
