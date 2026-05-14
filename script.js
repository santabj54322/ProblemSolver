const apiKeyInput = document.getElementById('apiKey');
const modelSelect = document.getElementById('modelSelect');
const problemText = document.getElementById('problemText');
const problemImage = document.getElementById('problemImage');
const imagePreview = document.getElementById('imagePreview');
const solveButton = document.getElementById('solveButton');
const renderInput = document.getElementById('renderInput');
const renderButton = document.getElementById('renderButton');
const debugPanel = document.getElementById('debugPanel');
const debugSummary = document.getElementById('debugSummary');
const debugOutput = document.getElementById('debugOutput');
const slidePanel = document.getElementById('slidePanel');
const slideIndexLabel = document.getElementById('slideIndex');
const slideCountLabel = document.getElementById('slideCount');
const slideTitle = document.getElementById('slideTitle');
const slideContent = document.getElementById('slideContent');
const prevButton = document.getElementById('prevButton');
const nextButton = document.getElementById('nextButton');
const feedbackPanel = document.getElementById('feedbackPanel');
const feedbackInput = document.getElementById('feedbackInput');
const regenerateButton = document.getElementById('regenerateButton');
const addQuestionButton = document.getElementById('addQuestionButton');
const statusBar = document.getElementById('statusBar');

let currentSlides = [];
let currentIndex = 0;
let imageDataUrl = null;
let katexLoaded = false;

const sessionState = {
  apiKey: '',
  model: '',
  problemText: '',
  imageDataUrl: null,
  latestFeedback: '',
  conversation: []
};

const OUTPUT_INSTRUCTIONS = `
Respond with a JSON object exactly in this format:
{
  "slides": [
    {
      "title": "...",
      "items": [
        {"type": "text", "content": "..."},
        {"type": "math", "content": "..."},
        {"type": "table", "content": "| Col A | Col B |\\n| --- | --- |\\n| ... | ... |"},
        {"type": "image", "content": "https://..."}
      ]
    }
  ]
}
- Output only the JSON object. Do not include markdown code fences or extra commentary.
- Put explanations in "text" items.
- Put standalone equations in "math" items using LaTeX.
- In "text" items, use \$...\$ for inline math. Do not use \\(...\\) or \\[...\\].
- Escape every backslash correctly so the result is valid JSON.
- Put tabular content in "table" items using markdown table syntax.
- Do not use "draw" items.
- The last slide should invite the user to ask a follow-up question or request corrections.
`;

problemImage.addEventListener('change', handleImageChange);
solveButton.addEventListener('click', handleSolveClick);
renderButton.addEventListener('click', handleManualRenderClick);
prevButton.addEventListener('click', () => changeSlide(currentIndex - 1));
nextButton.addEventListener('click', () => changeSlide(currentIndex + 1));
regenerateButton.addEventListener('click', handleRegenerateClick);
addQuestionButton.addEventListener('click', handleAddQuestionClick);

ensureKaTeX().then((loaded) => {
  katexLoaded = loaded;
});

function ensureKaTeX() {
  return new Promise((resolve) => {
    if (typeof katex !== 'undefined') {
      resolve(true);
      return;
    }

    let attempts = 0;
    const check = () => {
      attempts += 1;
      if (typeof katex !== 'undefined') {
        resolve(true);
      } else if (attempts < 50) {
        setTimeout(check, 100);
      } else {
        resolve(false);
      }
    };
    check();
  });
}

function handleImageChange() {
  const file = problemImage.files?.[0];
  imagePreview.innerHTML = '';
  imageDataUrl = null;
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    imageDataUrl = reader.result;
    const img = document.createElement('img');
    img.src = imageDataUrl;
    img.alt = '문제 이미지 미리보기';
    imagePreview.appendChild(img);
  };
  reader.readAsDataURL(file);
}

async function handleSolveClick() {
  const apiKey = apiKeyInput.value.trim();
  const model = modelSelect.value;
  const text = problemText.value.trim();

  if (!apiKey) {
    setStatus('OpenAI API Key를 입력하세요.', true);
    return;
  }
  if (!text && !imageDataUrl) {
    setStatus('문제 텍스트 또는 이미지를 입력하세요.', true);
    return;
  }

  sessionState.apiKey = apiKey;
  sessionState.model = model;
  sessionState.problemText = text;
  sessionState.imageDataUrl = imageDataUrl;
  sessionState.latestFeedback = '';
  sessionState.conversation = [];

  feedbackInput.value = '';
  feedbackPanel.hidden = true;
  slidePanel.hidden = true;
  setStatus('문제를 분석하고 풀이를 생성 중입니다...');

  try {
    const slides = await fetchSolution({
      apiKey,
      model,
      problemText: text,
      imageDataUrl,
      feedback: '',
      previousSlides: []
    });

    sessionState.conversation.push({
      role: 'assistant',
      kind: 'solution',
      prompt: text || '[이미지 문제]',
      slides
    });

    finishSlides(slides);
    setStatus('풀이가 생성되었습니다.');
  } catch (error) {
    console.error(error);
    setStatus('풀이 생성 중 오류가 발생했습니다. 콘솔을 확인하세요.', true);
  }
}

async function handleRegenerateClick() {
  if (!sessionState.apiKey || (!sessionState.problemText && !sessionState.imageDataUrl)) return;

  const feedback = feedbackInput.value.trim();
  sessionState.latestFeedback = feedback;
  setStatus('이전 문맥을 포함해 풀이를 다시 생성 중입니다...');

  try {
    const previousSlides = flattenConversationSlides();
    const slides = await fetchSolution({
      apiKey: sessionState.apiKey,
      model: sessionState.model,
      problemText: sessionState.problemText,
      imageDataUrl: sessionState.imageDataUrl,
      feedback,
      previousSlides
    });

    sessionState.conversation.push({
      role: 'assistant',
      kind: 'regenerated_solution',
      prompt: feedback || '[재생성]',
      slides
    });

    finishSlides(slides);
    setStatus('수정 요청을 반영한 풀이를 생성했습니다.');
  } catch (error) {
    console.error(error);
    setStatus('풀이 재생성 중 오류가 발생했습니다.', true);
  }
}

async function handleAddQuestionClick() {
  const question = feedbackInput.value.trim();
  if (!question) {
    setStatus('추가 질문을 입력하세요.', true);
    return;
  }
  if (!sessionState.apiKey || (!sessionState.problemText && !sessionState.imageDataUrl)) {
    setStatus('먼저 문제 풀이를 생성하세요.', true);
    return;
  }

  setStatus('이전 문제와 풀이 문맥을 포함해 질문에 답변 중입니다...');

  try {
    const answerSlides = await fetchQuestionAnswer({
      apiKey: sessionState.apiKey,
      model: sessionState.model,
      problemText: sessionState.problemText,
      imageDataUrl: sessionState.imageDataUrl,
      previousSlides: flattenConversationSlides()
    }, question);

    sessionState.conversation.push({
      role: 'user',
      kind: 'question',
      prompt: question
    });
    sessionState.conversation.push({
      role: 'assistant',
      kind: 'answer',
      prompt: question,
      slides: answerSlides
    });

    feedbackInput.value = '';
    addSlidesToCurrent(answerSlides);
    setStatus('질문 답변을 현재 슬라이드 뒤에 추가했습니다.');
  } catch (error) {
    console.error(error);
    setStatus('질문 답변 생성 중 오류가 발생했습니다.', true);
  }
}

function handleManualRenderClick() {
  const raw = renderInput.value.trim();
  if (!raw) {
    setStatus('렌더링할 AI 응답을 입력하세요.', true);
    clearDebugPanel();
    return;
  }

  try {
    const debugContext = createParseDebugContext(raw);
    const slides = parseManualSlides(raw, debugContext);
    finishSlides(slides);
    flushParseDebug(debugContext);

    if (debugContext.matchedSlides) {
      setStatus(debugContext.usedRepair ? '붙여넣은 응답을 복구 파싱 후 렌더링했습니다.' : '붙여넣은 응답을 렌더링했습니다.');
    } else {
      setStatus('슬라이드 JSON을 찾지 못해 원문 텍스트로 렌더링했습니다.', true);
    }
  } catch (error) {
    console.error(error);
    showUnhandledDebug(error, raw);
    setStatus('붙여넣은 응답을 해석하지 못했습니다.', true);
  }
}

function setStatus(message, isError = false) {
  statusBar.textContent = message;
  statusBar.style.color = isError ? '#fb7185' : 'var(--muted)';
}

function createParseDebugContext(inputText) {
  return {
    inputText,
    attempts: [],
    notes: [],
    matchedSlides: false,
    usedRepair: false,
    fallbackUsed: false
  };
}

function addParseNote(debugContext, note) {
  if (!debugContext || !note) return;
  debugContext.notes.push(note);
}

function recordParseAttempt(debugContext, attempt) {
  if (!debugContext) return;
  debugContext.attempts.push(attempt);
  if (attempt.repaired && attempt.ok) {
    debugContext.usedRepair = true;
  }
}

function flushParseDebug(debugContext) {
  if (!debugContext) {
    clearDebugPanel();
    return;
  }

  const hasIssues = debugContext.usedRepair
    || debugContext.fallbackUsed
    || debugContext.attempts.some((attempt) => !attempt.ok);

  if (!hasIssues) {
    clearDebugPanel();
    return;
  }

  const failingAttempt = pickMostRelevantAttempt(debugContext);
  const summaryParts = [];
  if (debugContext.matchedSlides) {
    summaryParts.push(debugContext.usedRepair ? '복구 파싱 성공' : '파싱 성공');
  } else {
    summaryParts.push('슬라이드 JSON 미탐지');
  }
  if (failingAttempt?.location) {
    summaryParts.push(`line ${failingAttempt.location.line}, col ${failingAttempt.location.column}`);
  }
  if (debugContext.fallbackUsed) {
    summaryParts.push('fallback 렌더링');
  }

  debugSummary.textContent = summaryParts.join(' | ');
  debugOutput.innerHTML = buildDebugMarkup(debugContext, failingAttempt);
  debugPanel.hidden = false;

  console.groupCollapsed(`[Manual Render Debug] ${summaryParts.join(' | ')}`);
  debugContext.notes.forEach((note) => console.log(note));
  debugContext.attempts.forEach((attempt) => {
    const prefix = attempt.ok ? 'OK' : 'FAIL';
    console.log(`${prefix} ${attempt.label}`, {
      repaired: attempt.repaired,
      error: attempt.errorMessage || null,
      location: attempt.location || null,
      excerpt: attempt.excerpt || null
    });
  });
  console.groupEnd();
}

function clearDebugPanel() {
  if (!debugPanel || !debugSummary || !debugOutput) return;
  debugPanel.hidden = true;
  debugSummary.textContent = '';
  debugOutput.textContent = '';
}

function showUnhandledDebug(error, rawText) {
  if (!debugPanel || !debugSummary || !debugOutput) return;
  debugSummary.textContent = '예외 발생';
  debugOutput.textContent = `${error?.message || error}\n\n${String(rawText || '').slice(0, 1200)}`;
  debugPanel.hidden = false;
}

async function fetchSolution(request) {
  const promptText = buildSolutionPrompt(request);
  const body = createOpenAIRequestBody(
    request.model,
    promptText,
    request.imageDataUrl ? [{ type: 'input_image', image_url: request.imageDataUrl }] : []
  );
  const data = await requestOpenAI(body, request.apiKey);
  return parseSlidesFromText(extractTextFromResponse(data));
}

async function fetchQuestionAnswer(request, question) {
  const promptText = buildQuestionPrompt(request, question);
  const body = createOpenAIRequestBody(
    request.model,
    promptText,
    request.imageDataUrl ? [{ type: 'input_image', image_url: request.imageDataUrl }] : []
  );
  const data = await requestOpenAI(body, request.apiKey);
  return parseSlidesFromText(extractTextFromResponse(data));
}

function createOpenAIRequestBody(model, promptText, extraContent = []) {
  return {
    model,
    reasoning: { effort: 'medium' },
    input: [
      {
        role: 'system',
        content: [{
          type: 'input_text',
          text: 'You are a math and science tutoring renderer assistant. Output only valid JSON with a top-level "slides" array. Never include markdown code fences or explanatory text outside the JSON.'
        }]
      },
      {
        role: 'user',
        content: [
          { type: 'input_text', text: promptText },
          ...extraContent
        ]
      }
    ],
    max_output_tokens: 22000
  };
}

async function requestOpenAI(body, apiKey, retryCount = 0) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`OpenAI API 에러: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  if (data.status === 'incomplete') {
    const reason = data.incomplete_details?.reason || 'unknown';
    if (reason === 'max_output_tokens' && retryCount < 2) {
      body.max_output_tokens += 4000;
      return requestOpenAI(body, apiKey, retryCount + 1);
    }
    throw new Error(`응답이 불완전합니다 (${reason}).`);
  }

  return data;
}

function buildSolutionPrompt(request) {
  const priorContext = serializeSlidesForPrompt(request.previousSlides);
  const problemSource = request.imageDataUrl ? '문제 이미지가 함께 첨부되어 있습니다.' : '문제는 텍스트로만 제공됩니다.';

  return `다음 조건에 맞춰 문제 풀이 슬라이드를 작성하세요.

${problemSource}

현재 문제:
${request.problemText || '[이미지 문제]'}

이전 문제/풀이 문맥:
${priorContext || '없음'}

${request.feedback ? `사용자의 재생성 요청 또는 수정 요청:\n${request.feedback}\n` : '사용자 추가 수정 요청은 아직 없습니다.\n'}

작성 규칙:
- 문제의 정의, 변수 의미, 기호 의미를 빠뜨리지 말고 필요한 곳에서 다시 설명하세요.
- 수학 표현은 LaTeX를 사용하고, 독립 수식은 "math" 아이템으로 분리하세요.
- text 아이템 안의 인라인 수식은 반드시 $...$ 형태로 쓰고, \\( ... \\) 표기는 쓰지 마세요.
- 표가 유용하면 "table" 아이템을 사용하세요.
- 설명 문장은 "text" 아이템에 markdown 스타일 표기(목록, 표, **강조**)를 써도 됩니다.
- 첨자와 위첨자가 여러 글자면 반드시 중괄호를 사용하세요. 예: A_{ij}, x_{n+1}, e^{i\theta}
- 분수, 합 기호, 적분, 행렬 등 복잡한 식은 반드시 올바른 LaTeX로 작성하세요.
- 마지막 슬라이드는 사용자가 추가 질문 또는 수정 요청을 남길 수 있게 안내하세요.

${OUTPUT_INSTRUCTIONS}`;
}

function buildQuestionPrompt(request, question) {
  const priorContext = serializeSlidesForPrompt(request.previousSlides);
  return `사용자의 추가 질문에 답하세요.

원래 문제:
${request.problemText || '[이미지 문제]'}

이전 풀이 및 대화 문맥:
${priorContext || '없음'}

사용자 질문:
${question}

규칙:
- 질문이 기존 풀이의 어떤 기호, 식, 단계, 표를 가리키는지 문맥을 바탕으로 해석하세요.
- 필요한 경우 이전 정의를 다시 적고, 바로 답만 하지 말고 최소한의 연결 설명을 주세요.
- 수식은 LaTeX로 정확하게 작성하세요.
- text 아이템 안의 인라인 수식은 반드시 $...$ 형태로 쓰고, \\( ... \\) 표기는 쓰지 마세요.
- 표가 유용하면 "table" 아이템을 사용하세요.
- 1~3개 슬라이드 정도로 간결하게 답하세요.
- 마지막 슬라이드는 추가 질문을 유도하세요.

${OUTPUT_INSTRUCTIONS}`;
}

function extractTextFromResponse(data) {
  const embeddedSlides = findSlidesPayload(data);
  if (embeddedSlides) {
    return JSON.stringify(embeddedSlides, null, 2);
  }

  const textParts = collectResponseText(data);
  if (textParts.length) {
    return textParts.join('\n').trim();
  }

  return JSON.stringify(data, null, 2);
}

function parseSlidesFromText(rawText, debugContext = null) {
  const json = findSlidesPayload(rawText, new WeakSet(), debugContext, 'response_text');
  if (json?.slides && Array.isArray(json.slides)) {
    if (debugContext) debugContext.matchedSlides = true;
    return json.slides.map((slide, index) => normalizeSlide(slide, index));
  }

  if (debugContext) {
    debugContext.fallbackUsed = true;
    addParseNote(debugContext, '최상위 "slides" 배열을 찾지 못해 텍스트 슬라이드로 대체했습니다.');
  }
  return [{
    title: '렌더링 결과',
    items: [{ type: 'text', content: rawText }]
  }];
}

function parseManualSlides(rawText, debugContext = null) {
  const json = findSlidesPayload(rawText, new WeakSet(), debugContext, 'manual_input');
  if (json?.slides && Array.isArray(json.slides)) {
    if (debugContext) debugContext.matchedSlides = true;
    return json.slides.map((slide, index) => normalizeSlide(slide, index));
  }

  const responseJson = extractJson(rawText, debugContext, 'manual_input');
  if (responseJson && (responseJson.output_text || responseJson.output || responseJson.text || responseJson.choices || responseJson.message)) {
    addParseNote(debugContext, '응답 래퍼 JSON은 읽었지만 슬라이드는 내부 텍스트에서 다시 찾았습니다.');
    return parseSlidesFromText(extractTextFromResponse(responseJson), debugContext);
  }

  if (debugContext) {
    debugContext.fallbackUsed = true;
    addParseNote(debugContext, '수동 렌더링 입력에서 유효한 슬라이드 JSON을 찾지 못했습니다.');
  }
  return [{
    title: '붙여넣은 응답',
    items: [{ type: 'text', content: decodeEscapedUnicode(rawText) }]
  }];
}

function normalizeSlide(slide, index) {
  const items = Array.isArray(slide?.items)
    ? slide.items.map(normalizeSlideItem).filter(Boolean)
    : [];

  return {
    title: slide?.title || `슬라이드 ${index + 1}`,
    items: items.length ? items : [{ type: 'text', content: slide?.content || '(내용 없음)' }]
  };
}

function normalizeSlideItem(item) {
  if (item == null) return null;

  if (typeof item === 'string') {
    return { type: 'text', content: decodeEscapedUnicode(item) };
  }

  const type = String(item.type || 'text').toLowerCase();
  const content = decodeEscapedUnicode(String(item.content ?? item.text ?? ''));

  if (type === 'math') {
    return { type, content: normalizeLatex(content) };
  }
  if (type === 'table' || type === 'text' || type === 'image') {
    return { type, content };
  }

  return { type: 'text', content };
}

function extractJson(text, debugContext = null, label = 'json_input') {
  const cleanText = stripCodeFences(String(text)).trim();
  const direct = parseJsonCandidate(cleanText, debugContext, `${label}:direct`);
  if (direct) return direct;

  for (let start = 0; start < cleanText.length; start += 1) {
    const char = cleanText[start];
    if (char !== '{' && char !== '[') continue;

    const candidate = extractBalancedJsonCandidate(cleanText, start, debugContext, `${label}:balanced@${start}`);
    if (candidate) {
      return candidate;
    }
  }

  addParseNote(debugContext, `"${label}"에서 JSON 후보를 끝까지 찾지 못했습니다.`);
  return null;
}

function stripCodeFences(text) {
  return String(text)
    .replace(/```(?:json)?/gi, '')
    .trim();
}

function parseJsonCandidate(candidate, debugContext = null, label = 'json_candidate') {
  const cleanCandidate = stripCodeFences(candidate).trim();
  if (!cleanCandidate) return null;

  const directAttempt = attemptJsonParse(cleanCandidate, debugContext, `${label}:original`, false);
  if (directAttempt.ok) {
    return unwrapNestedJsonStrings(directAttempt.value, cleanCandidate, debugContext, `${label}:original`);
  }

  const repairedCandidate = repairJsonCandidate(cleanCandidate);
  if (!repairedCandidate || repairedCandidate === cleanCandidate) {
    return null;
  }

  const repairedAttempt = attemptJsonParse(repairedCandidate, debugContext, `${label}:repaired`, true);
  if (!repairedAttempt.ok) {
    return null;
  }

  return unwrapNestedJsonStrings(repairedAttempt.value, repairedCandidate, debugContext, `${label}:repaired`);
}

function attemptJsonParse(text, debugContext, label, repaired) {
  try {
    const value = JSON.parse(text);
    recordParseAttempt(debugContext, {
      label,
      ok: true,
      repaired,
      sourceLength: text.length
    });
    return { ok: true, value };
  } catch (error) {
    const location = extractParseErrorLocation(error, text);
    recordParseAttempt(debugContext, {
      label,
      ok: false,
      repaired,
      sourceLength: text.length,
      errorMessage: error.message,
      location,
      excerpt: location ? buildErrorExcerpt(text, location.position) : ''
    });
    return { ok: false, error };
  }
}

function unwrapNestedJsonStrings(parsed, sourceText, debugContext, label) {
  let current = parsed;
  let previousSource = sourceText;
  let depth = 0;

  while (typeof current === 'string') {
    const nested = stripCodeFences(current).trim();
    if (!nested || nested === previousSource) break;

    const nestedAttempt = attemptJsonParse(nested, debugContext, `${label}:nested_${depth + 1}`, false);
    if (!nestedAttempt.ok) break;

    current = nestedAttempt.value;
    previousSource = nested;
    depth += 1;
  }

  return current;
}

function extractParseErrorLocation(error, sourceText) {
  const message = String(error?.message || '');
  const positionMatch = message.match(/position\s+(\d+)/i);
  let position = positionMatch ? Number(positionMatch[1]) : null;

  if (position == null) {
    const lineColumnMatch = message.match(/line\s+(\d+)\s+column\s+(\d+)/i);
    if (lineColumnMatch) {
      const line = Number(lineColumnMatch[1]);
      const column = Number(lineColumnMatch[2]);
      position = convertLineColumnToIndex(sourceText, line, column);
    }
  }

  if (position == null || Number.isNaN(position)) return null;

  return {
    position,
    line: findLineColumn(sourceText, position).line,
    column: findLineColumn(sourceText, position).column
  };
}

function convertLineColumnToIndex(text, line, column) {
  const lines = String(text).split('\n');
  let index = 0;

  for (let i = 0; i < lines.length; i += 1) {
    if (i + 1 === line) {
      return index + Math.max(column - 1, 0);
    }
    index += lines[i].length + 1;
  }

  return null;
}

function findLineColumn(text, index) {
  const safeIndex = Math.max(0, Math.min(index, String(text).length));
  let line = 1;
  let column = 1;

  for (let i = 0; i < safeIndex; i += 1) {
    if (text[i] === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  return { line, column };
}

function buildErrorExcerpt(text, position, radius = 80) {
  const start = Math.max(0, position - radius);
  const end = Math.min(text.length, position + radius);
  return {
    before: text.slice(start, position),
    error: text.slice(position, Math.min(position + 1, text.length)) || ' ',
    after: text.slice(Math.min(position + 1, text.length), end),
    clippedStart: start > 0,
    clippedEnd: end < text.length
  };
}

function repairJsonCandidate(candidate) {
  const repairedControls = escapeRawControlCharactersInStrings(candidate);
  const repairedBackslashes = escapeInvalidJsonBackslashes(repairedControls);
  return repairedBackslashes;
}

function escapeRawControlCharactersInStrings(text) {
  let result = '';
  let inString = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (char === '"') {
      let backslashCount = 0;
      for (let j = i - 1; j >= 0 && text[j] === '\\'; j -= 1) {
        backslashCount += 1;
      }
      if (backslashCount % 2 === 0) {
        inString = !inString;
      }
      result += char;
      continue;
    }

    if (inString) {
      if (char === '\n') {
        result += '\\n';
        continue;
      }
      if (char === '\r') {
        result += '\\r';
        continue;
      }
      if (char === '\t') {
        result += '\\t';
        continue;
      }
    }

    result += char;
  }

  return result;
}

function escapeInvalidJsonBackslashes(text) {
  let result = '';
  let inString = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (char === '"') {
      let backslashCount = 0;
      for (let j = i - 1; j >= 0 && text[j] === '\\'; j -= 1) {
        backslashCount += 1;
      }
      if (backslashCount % 2 === 0) {
        inString = !inString;
      }
      result += char;
      continue;
    }

    if (char === '\\' && inString) {
      let runLength = 1;
      while (text[i + runLength] === '\\') {
        runLength += 1;
      }

      const next = text[i + runLength];
      result += '\\'.repeat(runLength);

      // Even-length runs are already safe because each backslash is paired.
      // Odd-length runs leave one trailing backslash that escapes the next char.
      if (runLength % 2 === 1 && !isValidJsonEscape(next, text, i + runLength)) {
        result += '\\';
      }

      i += runLength - 1;
      continue;
    }

    result += char;
  }

  return result;
}

function isValidJsonEscape(nextChar, source, nextIndex) {
  if (!nextChar) return false;
  if (/["\\/bfnrt]/.test(nextChar)) return true;
  if (nextChar !== 'u') return false;

  const unicodeDigits = source.slice(nextIndex + 1, nextIndex + 5);
  return /^[0-9a-fA-F]{4}$/.test(unicodeDigits);
}

function pickMostRelevantAttempt(debugContext) {
  if (!debugContext?.attempts?.length) return null;

  const failingAttempts = debugContext.attempts.filter((attempt) => !attempt.ok);
  if (failingAttempts.length) {
    return failingAttempts.sort((a, b) => (b.sourceLength || 0) - (a.sourceLength || 0))[0];
  }

  return debugContext.attempts[debugContext.attempts.length - 1];
}

function buildDebugMarkup(debugContext, relevantAttempt) {
  const lines = [];

  if (debugContext.notes.length) {
    lines.push(`<span class="debug-label">노트</span>`);
    debugContext.notes.forEach((note) => {
      lines.push(`<span class="debug-note">- ${escapeHtml(note)}</span>`);
    });
    lines.push('');
  }

  if (relevantAttempt?.errorMessage) {
    lines.push(`<span class="debug-label">대표 에러</span>`);
    lines.push(`<span class="debug-context">${escapeHtml(relevantAttempt.label)}</span>`);
    lines.push(`<span class="debug-error">${escapeHtml(relevantAttempt.errorMessage)}</span>`);

    if (relevantAttempt.location) {
      lines.push(`<span class="debug-context">line ${relevantAttempt.location.line}, col ${relevantAttempt.location.column}</span>`);
    }

    if (relevantAttempt.excerpt) {
      lines.push('');
      lines.push(`<span class="debug-label">문제 구간</span>`);
      lines.push(formatDebugExcerpt(relevantAttempt.excerpt));
    }
    lines.push('');
  }

  if (debugContext.attempts.length) {
    lines.push(`<span class="debug-label">파싱 시도</span>`);
    debugContext.attempts.slice(-8).forEach((attempt) => {
      const status = attempt.ok ? 'OK' : 'FAIL';
      const suffix = attempt.location ? ` (line ${attempt.location.line}, col ${attempt.location.column})` : '';
      lines.push(`${escapeHtml(status)} ${escapeHtml(attempt.label)}${escapeHtml(suffix)}`);
    });
  }

  return lines.join('\n');
}

function formatDebugExcerpt(excerpt) {
  const before = escapeHtml(excerpt.before || '');
  const errorChar = escapeHtml(excerpt.error || ' ');
  const after = escapeHtml(excerpt.after || '');
  const prefix = excerpt.clippedStart ? '...' : '';
  const suffix = excerpt.clippedEnd ? '...' : '';
  return `${prefix}<span class="debug-context">${before}</span><span class="debug-error">${errorChar}</span><span class="debug-context">${after}</span>${suffix}`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function extractBalancedJsonCandidate(text, start, debugContext = null, label = 'balanced_candidate') {
  const stack = [];
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{' || char === '[') {
      stack.push(char);
      continue;
    }

    if (char === '}' || char === ']') {
      const expected = char === '}' ? '{' : '[';
      if (stack[stack.length - 1] !== expected) {
        addParseNote(debugContext, `"${label}"에서 괄호 짝이 맞지 않아 후보를 버렸습니다.`);
        return null;
      }
      stack.pop();
      if (stack.length === 0) {
        return parseJsonCandidate(text.slice(start, i + 1), debugContext, label);
      }
    }
  }

  addParseNote(debugContext, `"${label}"에서 JSON 후보가 닫히지 않았습니다.`);
  return null;
}

function findSlidesPayload(source, seen = new WeakSet(), debugContext = null, path = 'root') {
  if (source == null) return null;

  if (typeof source === 'string') {
    const parsed = extractJson(source, debugContext, path);
    return parsed ? findSlidesPayload(parsed, seen, debugContext, `${path}:parsed`) : null;
  }

  if (typeof source !== 'object') {
    return null;
  }

  if (seen.has(source)) {
    return null;
  }
  seen.add(source);

  if (Array.isArray(source)) {
    for (const item of source) {
      const found = findSlidesPayload(item, seen, debugContext, `${path}[]`);
      if (found) return found;
    }
    return null;
  }

  if (Array.isArray(source.slides)) {
    addParseNote(debugContext, `"${path}"에서 slides 배열을 찾았습니다.`);
    return source;
  }

  const preferredKeys = ['parsed', 'output_text', 'text', 'content', 'output', 'message', 'messages', 'choices', 'response', 'data', 'result'];
  for (const key of preferredKeys) {
    if (!(key in source)) continue;
    const found = findSlidesPayload(source[key], seen, debugContext, `${path}.${key}`);
    if (found) return found;
  }

  for (const value of Object.values(source)) {
    const found = findSlidesPayload(value, seen, debugContext, `${path}.*`);
    if (found) return found;
  }

  return null;
}

function collectResponseText(source, seen = new WeakSet()) {
  if (source == null) return [];

  if (typeof source === 'string') {
    const value = decodeEscapedUnicode(source).trim();
    return value ? [value] : [];
  }

  if (typeof source !== 'object') {
    return [];
  }

  if (seen.has(source)) {
    return [];
  }
  seen.add(source);

  if (Array.isArray(source)) {
    return source.flatMap((item) => collectResponseText(item, seen));
  }

  const textParts = [];

  if (typeof source.output_text === 'string') {
    textParts.push(source.output_text);
  }
  if (typeof source.text === 'string') {
    textParts.push(source.text);
  }
  if (typeof source.content === 'string') {
    textParts.push(source.content);
  }
  if (source.text && typeof source.text === 'object' && typeof source.text.value === 'string') {
    textParts.push(source.text.value);
  }
  if (source.delta && typeof source.delta === 'string') {
    textParts.push(source.delta);
  }
  if (source.message && typeof source.message === 'object') {
    textParts.push(...collectResponseText(source.message, seen));
  }
  if (source.content && typeof source.content === 'object') {
    textParts.push(...collectResponseText(source.content, seen));
  }
  if (source.output && typeof source.output === 'object') {
    textParts.push(...collectResponseText(source.output, seen));
  }
  if (source.choices && typeof source.choices === 'object') {
    textParts.push(...collectResponseText(source.choices, seen));
  }

  return textParts
    .map((part) => decodeEscapedUnicode(String(part)).trim())
    .filter(Boolean);
}

function finishSlides(slides) {
  currentSlides = Array.isArray(slides) ? slides : [];
  currentIndex = 0;
  slidePanel.hidden = currentSlides.length === 0;
  slideCountLabel.textContent = String(currentSlides.length || 0);
  if (currentSlides.length) {
    changeSlide(0);
  } else {
    slideContent.innerHTML = '';
    slideTitle.textContent = '';
  }
}

function addSlidesToCurrent(newSlides) {
  if (!Array.isArray(newSlides) || !newSlides.length) return;

  const cleanedCurrent = removeTrailingFeedbackSlide(currentSlides);
  const cleanedNew = removeTrailingFeedbackSlide(newSlides);
  currentSlides = cleanedCurrent.concat(cleanedNew);
  slideCountLabel.textContent = String(currentSlides.length);
  changeSlide(Math.max(cleanedCurrent.length, 0));
}

function removeTrailingFeedbackSlide(slides) {
  const copy = [...slides];
  const last = copy[copy.length - 1];
  if (!last || !Array.isArray(last.items) || last.items.length !== 1) return copy;
  const item = last.items[0];
  if (item.type !== 'text') return copy;
  const text = item.content.toLowerCase();
  if (text.includes('질문') || text.includes('피드백') || text.includes('수정 요청')) {
    copy.pop();
  }
  return copy;
}

function changeSlide(nextIndex) {
  if (nextIndex < 0 || nextIndex >= currentSlides.length) return;

  currentIndex = nextIndex;
  const slide = currentSlides[currentIndex];
  slideIndexLabel.textContent = String(currentIndex + 1);
  renderSlideTitle(slide.title || `슬라이드 ${currentIndex + 1}`);
  slideContent.innerHTML = '';

  slide.items.forEach((item) => renderSlideItem(item, slideContent));

  prevButton.disabled = currentIndex === 0;
  nextButton.disabled = currentIndex === currentSlides.length - 1;
  feedbackPanel.hidden = currentIndex !== currentSlides.length - 1;
}

function renderSlideTitle(rawTitle) {
  const title = decodeEscapedUnicode(String(rawTitle || '')).trim();
  slideTitle.innerHTML = '';

  if (!title) {
    slideTitle.textContent = '';
    return;
  }

  if (isDisplayMathBlock(title)) {
    const mathWrapper = document.createElement('span');
    mathWrapper.className = 'inline-math title-math';
    renderInlineMath(mathWrapper, unwrapDisplayMath(title));
    slideTitle.appendChild(mathWrapper);
    return;
  }

  slideTitle.appendChild(renderInlineContent(title));
}

function renderSlideItem(item, container) {
  if (item.type === 'math') {
    const mathWrapper = document.createElement('div');
    mathWrapper.className = 'item-math';
    renderMathBlock(mathWrapper, item.content);
    container.appendChild(mathWrapper);
    return;
  }

  if (item.type === 'table') {
    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'item-table';
    tableWrapper.appendChild(createMarkdownTable(item.content));
    container.appendChild(tableWrapper);
    return;
  }

  if (item.type === 'image') {
    const img = document.createElement('img');
    img.src = item.content;
    img.alt = '슬라이드 이미지';
    img.className = 'slide-image';
    container.appendChild(img);
    return;
  }

  const textWrapper = document.createElement('div');
  textWrapper.className = 'item-text';
  renderRichText(textWrapper, item.content);
  container.appendChild(textWrapper);
}

function renderMathBlock(container, latex) {
  const normalized = normalizeLatex(latex);
  if (katexLoaded && typeof katex !== 'undefined') {
    try {
      katex.render(normalized, container, {
        throwOnError: false,
        displayMode: true,
        strict: 'ignore',
        macros: {
          '\\RR': '\\mathbb{R}',
          '\\NN': '\\mathbb{N}',
          '\\ZZ': '\\mathbb{Z}',
          '\\QQ': '\\mathbb{Q}',
          '\\CC': '\\mathbb{C}'
        }
      });
      return;
    } catch (error) {
      console.warn('KaTeX render failed:', error);
    }
  }

  container.textContent = normalized;
}

function renderRichText(container, rawText) {
  const text = decodeEscapedUnicode(String(rawText || '')).trim();
  if (!text) return;

  const blocks = splitIntoBlocks(text);
  blocks.forEach((block) => {
    if (isMarkdownTableBlock(block)) {
      container.appendChild(createMarkdownTable(block));
      return;
    }

    if (isBulletListBlock(block)) {
      container.appendChild(createList(block));
      return;
    }

    if (isDisplayMathBlock(block)) {
      const mathWrapper = document.createElement('div');
      mathWrapper.className = 'item-math inline-math-block';
      renderMathBlock(mathWrapper, unwrapDisplayMath(block));
      container.appendChild(mathWrapper);
      return;
    }

    const paragraph = document.createElement('p');
    block.split('\n').forEach((line, index) => {
      if (index > 0) paragraph.appendChild(document.createElement('br'));
      paragraph.appendChild(renderInlineContent(line));
    });
    container.appendChild(paragraph);
  });
}

function splitIntoBlocks(text) {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function isMarkdownTableBlock(block) {
  const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.length >= 2
    && lines.every((line) => line.includes('|'))
    && /^\|?[\s:-]+(?:\|[\s:-]+)+\|?$/.test(lines[1]);
}

function createMarkdownTable(block) {
  const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const tbody = document.createElement('tbody');
  const rows = lines
    .filter((_, index) => index !== 1)
    .map(parseTableRow);

  const headerRow = document.createElement('tr');
  rows[0].forEach((cell) => {
    const th = document.createElement('th');
    th.appendChild(renderInlineContent(cell));
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  rows.slice(1).forEach((cells) => {
    const tr = document.createElement('tr');
    cells.forEach((cell) => {
      const td = document.createElement('td');
      td.appendChild(renderInlineContent(cell));
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.appendChild(thead);
  table.appendChild(tbody);
  return table;
}

function parseTableRow(line) {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isBulletListBlock(block) {
  const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((line) => /^([-*]|\d+\.)\s+/.test(line));
}

function createList(block) {
  const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
  const ordered = lines.every((line) => /^\d+\.\s+/.test(line));
  const list = document.createElement(ordered ? 'ol' : 'ul');

  lines.forEach((line) => {
    const li = document.createElement('li');
    li.appendChild(renderInlineContent(line.replace(/^([-*]|\d+\.)\s+/, '')));
    list.appendChild(li);
  });

  return list;
}

function isDisplayMathBlock(block) {
  return /^\$\$[\s\S]+\$\$$/.test(block) || /^\\\[[\s\S]+\\\]$/.test(block);
}

function unwrapDisplayMath(block) {
  if (block.startsWith('$$')) return block.slice(2, -2).trim();
  if (block.startsWith('\\[')) return block.slice(2, -2).trim();
  return block.trim();
}

function renderInlineContent(text) {
  const fragment = document.createDocumentFragment();
  const tokens = tokenizeInline(text);

  tokens.forEach((token) => {
    if (token.type === 'math') {
      const span = document.createElement('span');
      span.className = 'inline-math';
      renderInlineMath(span, token.value);
      fragment.appendChild(span);
      return;
    }

    if (token.type === 'strong') {
      const strong = document.createElement('strong');
      strong.appendChild(renderInlineContent(token.value));
      fragment.appendChild(strong);
      return;
    }

    fragment.appendChild(document.createTextNode(token.value));
  });

  return fragment;
}

function tokenizeInline(text) {
  const tokens = [];
  const regex = /(\$\$[\s\S]+?\$\$|\$[^$\n]+\$|\\\([^\n]+?\\\)|\\\[[\s\S]+?\\\]|\*\*[^*]+\*\*)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }

    const value = match[0];
    if (value.startsWith('**') && value.endsWith('**')) {
      tokens.push({ type: 'strong', value: value.slice(2, -2) });
    } else {
      tokens.push({ type: 'math', value });
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: 'text', value: text.slice(lastIndex) });
  }

  return tokens;
}

function renderInlineMath(container, rawValue) {
  const latex = normalizeLatex(stripMathDelimiters(rawValue));
  if (katexLoaded && typeof katex !== 'undefined') {
    try {
      katex.render(latex, container, {
        throwOnError: false,
        displayMode: false,
        strict: 'ignore'
      });
      return;
    } catch (error) {
      console.warn('Inline KaTeX render failed:', error);
    }
  }

  container.textContent = latex;
}

function stripMathDelimiters(value) {
  if (value.startsWith('$$') && value.endsWith('$$')) return value.slice(2, -2);
  if (value.startsWith('$') && value.endsWith('$')) return value.slice(1, -1);
  if (value.startsWith('\\(') && value.endsWith('\\)')) return value.slice(2, -2);
  if (value.startsWith('\\[') && value.endsWith('\\]')) return value.slice(2, -2);
  return value;
}

function normalizeLatex(input) {
  let latex = decodeEscapedUnicode(String(input || '')).trim();
  latex = latex.replace(/\\\\/g, '\\');
  latex = latex.replace(/([A-Za-z0-9\)\]])_([A-Za-z0-9]{2,})(?![\w{])/g, '$1_{$2}');
  latex = latex.replace(/([A-Za-z0-9\)\]])\^([A-Za-z0-9+-]{2,})(?![\w{])/g, '$1^{$2}');
  latex = latex.replace(/\\left\s+/g, '\\left');
  latex = latex.replace(/\\right\s+/g, '\\right');
  return latex;
}

function decodeEscapedUnicode(text) {
  return String(text)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function serializeSlidesForPrompt(slides) {
  if (!Array.isArray(slides) || !slides.length) return '';

  return slides.map((slide, index) => {
    const itemSummary = (slide.items || []).map((item) => {
      const prefix = `[${item.type}]`;
      return `${prefix} ${String(item.content || '').replace(/\s+/g, ' ').trim()}`;
    }).join('\n');
    return `슬라이드 ${index + 1}: ${slide.title}\n${itemSummary}`;
  }).join('\n\n');
}

function flattenConversationSlides() {
  return sessionState.conversation
    .filter((entry) => Array.isArray(entry.slides))
    .flatMap((entry) => entry.slides);
}
