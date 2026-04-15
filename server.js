const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3001;

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_PAGE_ID = process.env.NOTION_PAGE_ID || '343dcfeccc3b80dcb2a9eff3a74ff792';

// CORS: allow only frontend domain (if specified) or all origins if CORS_ORIGIN is not set
const corsOptions = process.env.CORS_ORIGIN
  ? { origin: process.env.CORS_ORIGIN.split(',').map(s => s.trim()) }
  : { origin: '*' };
app.use(cors(corsOptions));
app.use(express.json());

async function fetchAllBlocks(blockId) {
  let allBlocks = [];
  let cursor = undefined;
  do {
    const url = `https://api.notion.com/v1/blocks/${blockId}/children?page_size=100${cursor ? '&start_cursor=' + cursor : ''}`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28'
      }
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Notion API error ${res.status}: ${err}`);
    }
    const data = await res.json();
    allBlocks = allBlocks.concat(data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return allBlocks;
}

function extractText(richTextArr) {
  if (!richTextArr || !Array.isArray(richTextArr)) return '';
  return richTextArr.map(t => t.plain_text || '').join('');
}

function blockText(block) {
  const type = block.type;
  const richContainers = ['heading_1', 'heading_2', 'heading_3', 'paragraph', 'quote', 'callout', 'bulleted_list_item', 'numbered_list_item', 'toggle', 'to_do'];
  if (richContainers.includes(type) && block[type] && block[type].rich_text) {
    return extractText(block[type].rich_text).trim();
  }
  return '';
}

function parseFlat(blocks) {
  const data = {
    questions: [],
    facts: [],
    personalContext: '',
    raw: []
  };
  // "1. FR — RU" or "5–6. FR — RU" or "21) FR - RU"
  const qRegex = /^(\d+(?:\s*[-–—]\s*\d+)?)\s*[.):]\s+(.+?)\s+[—–−-]\s+(.+)$/;
  let current = null;

  for (const block of blocks) {
    const type = block.type;
    const text = blockText(block);
    data.raw.push({ type, text, id: block.id, has_children: block.has_children });

    if (!text) continue;
    if (type === 'divider') continue;

    if (type === 'heading_1' || type === 'heading_2' || type === 'heading_3') {
      // section break — flush current question
      if (current) { data.questions.push(current); current = null; }
      continue;
    }

    const m = text.match(qRegex);
    if (m) {
      if (current) data.questions.push(current);
      current = {
        id: block.id,
        questionFr: m[2].trim(),
        questionRu: m[3].trim(),
        chunks: [],
        variations: [],
        followUps: []
      };
      continue;
    }

    if (current) {
      // plain text following a question = answer draft, append to variation A
      if (current.variations.length === 0) {
        current.variations.push({ label: 'A', fr: '', ru: text });
      } else {
        current.variations[0].ru += (current.variations[0].ru ? '\n' : '') + text;
      }
    }
  }

  if (current) data.questions.push(current);

  // frontend requires at least one variation; pad empties to avoid crashes
  for (const q of data.questions) {
    if (q.variations.length === 0) {
      q.variations.push({ label: 'A', fr: '', ru: '' });
    }
  }
  return data;
}

function parseBlocks(blocks) {
  const structured = parseStructured(blocks);
  if (structured.questions.length > 0 || structured.facts.length > 0 || structured.personalContext) {
    return structured;
  }
  const flat = parseFlat(blocks);
  flat.raw = structured.raw;
  return flat;
}

function parseStructured(blocks) {
  const data = {
    questions: [],
    facts: [],
    personalContext: '',
    raw: []
  };

  let currentSection = null;
  let currentQuestion = null;
  let currentVariation = null;
  let collectingPersonal = false;
  let personalLines = [];

  for (const block of blocks) {
    const type = block.type;
    const text = blockText(block);

    if (type === 'divider') {
      continue;
    }

    data.raw.push({ type, text, id: block.id, has_children: block.has_children });

    if (type === 'heading_1' || type === 'heading_2') {
      const lower = text.toLowerCase();
      if (lower.includes('question') || lower.includes('вопрос')) {
        currentSection = 'questions';
        collectingPersonal = false;
      } else if (lower.includes('fact') || lower.includes('факт')) {
        currentSection = 'facts';
        collectingPersonal = false;
      } else if (lower.includes('personal') || lower.includes('context') || lower.includes('личн') || lower.includes('контекст') || lower.includes('about me') || lower.includes('обо мне')) {
        currentSection = 'personal';
        collectingPersonal = true;
      } else {
        currentSection = lower;
        collectingPersonal = false;
      }
      currentQuestion = null;
      currentVariation = null;
      continue;
    }

    if (collectingPersonal && text) {
      personalLines.push(text);
      continue;
    }

    if (currentSection === 'questions' && type === 'heading_3') {
      if (currentQuestion) {
        data.questions.push(currentQuestion);
      }
      currentQuestion = {
        id: block.id,
        questionFr: text,
        questionRu: '',
        chunks: [],
        variations: [],
        followUps: []
      };
      currentVariation = null;
      continue;
    }

    if (currentQuestion) {
      const lower = text.toLowerCase();

      if (lower.startsWith('ru:') || lower.startsWith('рус:') || lower.startsWith('перевод:')) {
        currentQuestion.questionRu = text.replace(/^(ru:|рус:|перевод:)\s*/i, '');
      } else if (lower.startsWith('chunks:') || lower.startsWith('якоря:') || lower.startsWith('anchors:')) {
        const chunksStr = text.replace(/^(chunks:|якоря:|anchors:)\s*/i, '');
        currentQuestion.chunks = chunksStr.split(/[,;|]/).map(c => c.trim()).filter(Boolean);
      } else if (/^(variation |вариация |var\s*)[abc]/i.test(lower) || /^[abc][\s:.\-)]/i.test(lower)) {
        const content = text.replace(/^(variation |вариация |var\s*)?[abc][\s:.\-)]+/i, '').trim();
        if (content) {
          currentVariation = { label: text.match(/^[abc]/i)?.[0]?.toUpperCase() || 'A', fr: content, ru: '' };
          currentQuestion.variations.push(currentVariation);
        }
      } else if (currentVariation && (lower.startsWith('ru:') || lower.startsWith('рус:'))) {
        currentVariation.ru = text.replace(/^(ru:|рус:)\s*/i, '');
      } else if (lower.startsWith('follow') || lower.startsWith('доп')) {
        const fuText = text.replace(/^(follow[- ]?up:?|доп[а-я]*:?)\s*/i, '').trim();
        if (fuText) currentQuestion.followUps.push(fuText);
      } else if (text && !currentVariation && currentQuestion.variations.length === 0) {
        currentQuestion.variations.push({ label: 'A', fr: text, ru: '' });
        currentVariation = currentQuestion.variations[0];
      }
    }

    if (currentSection === 'facts' && text) {
      const parts = text.split(/[:\-–—](.+)/);
      if (parts.length >= 2) {
        data.facts.push({ q: parts[0].trim(), a: parts[1].trim() });
      } else if (text.includes('?')) {
        data.facts.push({ q: text, a: '' });
      }
    }
  }

  if (currentQuestion) {
    data.questions.push(currentQuestion);
  }

  data.personalContext = personalLines.join('\n');

  return data;
}

app.get('/api/data', async (req, res) => {
  try {
    if (!NOTION_TOKEN) {
      return res.status(500).json({ error: 'NOTION_TOKEN not configured' });
    }
    const blocks = await fetchAllBlocks(NOTION_PAGE_ID);

    const childPromises = blocks
      .filter(b => b.has_children)
      .map(async b => {
        const children = await fetchAllBlocks(b.id);
        return { parentId: b.id, children };
      });

    const childResults = await Promise.all(childPromises);

    let expandedBlocks = [];
    for (const block of blocks) {
      expandedBlocks.push(block);
      const found = childResults.find(c => c.parentId === block.id);
      if (found) {
        expandedBlocks = expandedBlocks.concat(found.children);
      }
    }

    const parsed = parseBlocks(expandedBlocks);
    res.json(parsed);
  } catch (err) {
    console.error('Error fetching Notion data:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Notion proxy running on port ${PORT}`);
});
