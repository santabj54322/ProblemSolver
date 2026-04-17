const apiKeyInput = document.getElementById('apiKey');
const modelSelect = document.getElementById('modelSelect');
const problemText = document.getElementById('problemText');
const problemImage = document.getElementById('problemImage');
const imagePreview = document.getElementById('imagePreview');
const solveButton = document.getElementById('solveButton');
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

// Check if KaTeX is loaded, with fallback
function ensureKaTeX() {
  return new Promise((resolve) => {
    if (typeof katex !== 'undefined') {
      resolve(true);
      return;
    }

    // Wait for KaTeX to load
    let attempts = 0;
    const checkKaTeX = () => {
      attempts++;
      if (typeof katex !== 'undefined') {
        console.log('✅ KaTeX loaded successfully');
        resolve(true);
      } else if (attempts < 50) { // Wait up to 5 seconds
        setTimeout(checkKaTeX, 100);
      } else {
        console.warn('⚠️ KaTeX failed to load, using fallback rendering');
        resolve(false);
      }
    };
    checkKaTeX();
  });
}

let currentSlides = [];
let currentIndex = 0;
let cachedRequest = null;
let imageDataUrl = null;
let katexLoaded = false;

// Initialize KaTeX loading check
ensureKaTeX().then(loaded => {
  katexLoaded = loaded;
  if (loaded) {
    console.log('🎉 KaTeX ready for math rendering');
  } else {
    console.warn('📝 Using fallback math rendering (KaTeX not available)');
  }
});

const TOOL_GUIDE = `
Use the drawing DSL below inside a draw{ ... } block.
Supported shapes:
  - line(name, (x1, y1), (x2, y2), style)
  - segment(name, (x1, y1), (x2, y2), style)
  - ray(name, (x1, y1), (x2, y2), style)
  - circle(name, (x, y), radius, style)
  - point(name, (x, y), label?, style?)
  - polygon(name, [(x1,y1), (x2,y2), ...], style)  // supports fill:style
  - plot(name, "expression", minX, maxX, style?)  // plots mathematical function y=f(x)
  - angle(name, line1, line2, style)  // draws a visible arc between two lines at their intersection(use it for marking angles)
  - perpendicular(name, line, point, style)  // draws perpendicular from point to line
  - midpoint(name, objectA, objectB)
  - intersect(name, objectA, objectB)
  - text(name, (x,y), "label", size?)
  - arrow(name, (x1,y1), (x2,y2), style?)  // draws a vector arrow from start to end
  - vector(name, (x1,y1), (x2,y2), style?)  // alias for arrow
Styles may include keywords: solid, dashed, dotted, thin, bold, red, blue, green, fill:red, fill:transparent, arrow.
You can reference existing shapes by name for intersections, midpoints, angles, and perpendiculars.
Example:
  draw{
    l1 = line((0,0), (5,3), solid)
    l2 = line((0,2), (5,0), dashed)
    c = intersect(l1, l2)
    A = point((1,1), "A", red)
    perp = perpendicular(l1, A, solid)
    ang = angle(l1, l2, blue)  // draws blue arc marking the angle
    circle1 = circle((2,2), 1.5, blue)
    plot1 = plot("x^2", -5, 5, red)
    plot2 = plot("sin(x)", -3.14, 3.14, blue)
  }
`;

const OUTPUT_INSTRUCTIONS = `
Respond with a JSON object exactly in this format:
{
  "slides": [
    {
      "title": "...",
      "items": [
        {"type": "text", "content": "..."},
        {"type": "math", "content": "..."},
        {"type": "draw", "content": "draw{ ... }"},
        {"type": "image", "content": "https://..."}
      ]
    }
  ]
}
- Output only the JSON object. Do not include any markdown code fences, commentary, or extra text.
- Do not wrap the JSON in backticks or any markup.
- Use "draw" items only for diagrams, and include direct draw{ ... } content as a string.
- 수식은 반드시 "math" 타입으로, 일반 텍스트는 "text" 타입으로 분리하세요. LaTeX 수식을 text에 넣지 마세요.
The last slide should include a short prompt that asks the user to provide feedback or corrections.
`;

problemImage.addEventListener('change', handleImageChange);
solveButton.addEventListener('click', handleSolveClick);
prevButton.addEventListener('click', () => changeSlide(currentIndex - 1));
nextButton.addEventListener('click', () => changeSlide(currentIndex + 1));
regenerateButton.addEventListener('click', handleRegenerateClick);
addQuestionButton.addEventListener('click', handleAddQuestionClick);

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
  const key = apiKeyInput.value.trim();
  const model = modelSelect.value;
  const text = problemText.value.trim();
  if (!key) return setStatus('OpenAI API Key를 입력하세요.', true);
  if (!text && !imageDataUrl) return setStatus('문제 텍스트 또는 이미지를 입력하세요.', true);

  console.log('🔧 풀이 요청 시작 | 모델:', model, '| 텍스트 길이:', text.length, '| 이미지:', !!imageDataUrl);
  
  setStatus('문제를 분석 중입니다...');
  slidePanel.hidden = true;
  feedbackPanel.hidden = true;
  feedbackInput.value = '';

  cachedRequest = {
    apiKey: key,
    model,
    problemText: text,
    imageDataUrl,
    feedback: ''
  };

  try {
    const slides = await fetchSolution(cachedRequest);
    finishSlides(slides);
  } catch (error) {
    console.error(error);
    setStatus('오류가 발생했습니다. 콘솔을 확인하세요.', true);
  }
}

async function handleRegenerateClick() {
  const feedback = feedbackInput.value.trim();
  if (!cachedRequest) return;
  cachedRequest.feedback = feedback;
  setStatus('수정된 풀이를 다시 생성 중입니다...');
  try {
    const slides = await fetchSolution(cachedRequest);
    finishSlides(slides);
  } catch (error) {
    console.error(error);
    setStatus('다시 생성 중 오류가 발생했습니다.', true);
  }
}

async function handleAddQuestionClick() {
  const question = feedbackInput.value.trim();
  if (!question || !cachedRequest) return;
  
  setStatus('질문에 대한 답변을 생성 중입니다...');
  feedbackInput.value = '';
  
  try {
    const answerSlides = await fetchQuestionAnswer(cachedRequest, question);
    addSlidesToCurrent(answerSlides);
    setStatus('질문에 대한 답변이 추가되었습니다.');
  } catch (error) {
    console.error(error);
    setStatus('질문 답변 생성 중 오류가 발생했습니다.', true);
    feedbackInput.value = question; // Restore the question
  }
}

function setStatus(message, isError = false) {
  statusBar.textContent = message;
  statusBar.style.color = isError ? '#f97316' : 'var(--muted)';
}

async function fetchSolution(request) {
  const userPrompt = buildCombinedPrompt(request.problemText, request.feedback, request.imageDataUrl !== null);
  const body = createOpenAIRequestBody(request.model, userPrompt, request.imageDataUrl ? [{ type: 'input_image', image_url: request.imageDataUrl }] : []);
  const data = await requestOpenAI(body, 0, true, request.apiKey);
  return parseSlidesFromText(extractTextFromResponse(data));
}

async function fetchQuestionAnswer(request, question) {
  const questionPrompt = buildQuestionPrompt(question);
  const body = createOpenAIRequestBody(request.model, questionPrompt, []);
  const data = await requestOpenAI(body, 0, true, request.apiKey);
  return parseSlidesFromText(extractTextFromResponse(data));
}
  const systemText = `You are a renderer assistant. Output only valid JSON and never include any explanatory text or markdown code fences.
Always return exactly one JSON object with a top-level \"slides\" array.
For drawing content, use draw{ ... } syntax exactly as described and output it as a string.`;

function createOpenAIRequestBody(model, promptText, extraContent = []) {
  return {
    model,
    reasoning: { effort: 'medium' },
    input: [
      {
        role: 'system',
        content: [{
          type: 'input_text',
          text: 'Output only valid JSON. No markdown, no explanations, no code fences. Always include a top-level "slides" array.'
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
    max_output_tokens: 20000
  };
}

async function requestOpenAI(body, retryCount = 0, allowRetry = false, apiKey) {
  try {
    console.log('🚀 API 요청 시작...');
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text();
      const errorMsg = `OpenAI API 에러: ${response.status} ${text}`;
      console.error('❌', errorMsg);
      throw new Error(errorMsg);
    }

    console.log('✅ API 응답 받음 (상태:', response.status, ')');
    const data = await response.json();
    console.log('📦 JSON 파싱 완료, 데이터 타입:', typeof data, ', 키:', data ? Object.keys(data).slice(0, 5) : 'null');

    if (data.status === 'incomplete') {
      const reason = data.incomplete_details?.reason || 'unknown';
      console.warn('⚠️ 응답 불완전:', reason);
      if (allowRetry && reason === 'max_output_tokens' && retryCount < 2) {
        console.log('🔄 토큰 제한으로 재시도 중... (시도:', retryCount + 1, ')');
        body.max_output_tokens = 30000;
        return requestOpenAI(body, retryCount + 1, allowRetry, apiKey);
      }
      throw new Error(`응답이 불완전합니다 (${reason}). 더 간단한 문제로 시도하거나, 토큰 제한을 늘려주세요.`);
    }

    return data;
  } catch (error) {
    console.error('💥 requestOpenAI 에러:', error);
    throw error;
  }
}

function buildCombinedPrompt(problem, feedback, hasImage) {
  const problemSource = hasImage ? '문제 이미지가 첨부되어 있습니다.' : '문제 텍스트만 있습니다.';
  return `다음 조건에 맞춰서 문제를 풀이하고 단계별 슬라이드로 정리하세요.

${problemSource}

문제:
${problem || '[이미지 문제]'}

- 가능한 한 간결하게 작성하세요.
- 단순 계산은 자세한 과정 대신 결과 중심으로 제시하세요.
- 논리적 흐름을 유지하고, 필요한 경우에만 중간 과정을 간단히 설명하세요.
- 도형 좌표, 반지름, 점 위치를 정확하게 기술하세요.

${TOOL_GUIDE}
${OUTPUT_INSTRUCTIONS}

- 슬라이드는 단계별로 나누어 작성하세요.
- 가능하면 수식과 그림(draw)을 함께 포함하세요.
- 가능하면 소수보다는 분수, 제곱근 등을 유지하며 수학적으로 정확한 값을 사용하세요.
- 수식 표기 시 첨자를 사용하여 명확하게 표현하세요 (예: x_1, A_{triangle} 등).
- 그림을 그릴 때 여러 요소를 넣어 유저에게 친절한 그림을 그리세요 (예: 점, 선, 원, 각도 표시 등).
- 도형은 정확한 좌표와 관계에 맞춰 작성하세요.
- 마지막 슬라이드는 사용자가 피드백을 입력할 수 있도록 요청 문장을 포함해야 합니다.
${feedback ? `\n사용자 수정 요청:\n${feedback}\n` : ''}`;  
}

function buildQuestionPrompt(question) {
  return `사용자의 질문에 대해 명확하고 친절하게 답변하세요. 필요하면 그림(draw DSL)을 사용해 시각적으로 설명해주세요.

질문:
${question}

${TOOL_GUIDE}
${OUTPUT_INSTRUCTIONS}

- 1~3개 정도의 슬라이드로 답변하세요.
- 그림이 도움이 될 것 같으면 draw를 사용하세요.
- 마지막 슬라이드는 사용자가 추가 질문을 입력할 수 있도록 요청 문장을 포함해야 합니다.`;
}

function extractTextFromResponse(data) {
  console.log('📡 API 응답 구조:', JSON.stringify(data, null, 2).substring(0, 500));
  
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    console.log('✓ output_text에서 추출됨');
    return data.output_text.trim();
  }

  if (Array.isArray(data.output)) {
    const textParts = [];
    for (const item of data.output) {
      if (item.type === 'output_text') {
        textParts.push(item.text || '');
      } else if (Array.isArray(item.content)) {
        for (const contentItem of item.content) {
          if (contentItem.type === 'output_text') textParts.push(contentItem.text || '');
        }
      }
    }
    const joined = textParts.join('\n').trim();
    if (joined) {
      console.log('✓ data.output 배열에서 추출됨');
      return joined;
    }
  }

  if (Array.isArray(data.output) && data.output.length && typeof data.output[0].content === 'string') {
    console.log('✓ data.output[0].content에서 추출됨');
    return data.output[0].content;
  }

  // Handle response where text is in different structure
  if (data.content && typeof data.content === 'string') {
    console.log('✓ data.content에서 추출됨');
    return data.content;
  }

  if (data.text && typeof data.text === 'string') {
    console.log('✓ data.text에서 추출됨');
    return data.text;
  }

  const stringified = JSON.stringify(data, null, 2);
  console.warn('⚠️ 기본 JSON 직렬화 사용');
  return stringified;
}

function parseSlidesFromText(rawText) {
  console.log('📝 원본 텍스트 길이:', rawText.length, '첫 200자:', rawText.substring(0, 200));
  
  const json = extractJson(rawText);
  
  if (json) {
    console.log('JSON 객체 구조:', typeof json, Array.isArray(json) ? '배열' : '객체');
    if (json.slides && Array.isArray(json.slides)) {
      console.log('💯 슬라이드 배열 발견:', json.slides.length, '개');
      const slides = json.slides.map((slide, index) => {
        const items = Array.isArray(slide.items) ? slide.items.map(normalizeSlideItem) : [];
        return {
          title: slide.title || `슬라이드 ${index + 1}`,
          items: items.length ? items : [{ type: 'text', content: slide.content || '(내용 없음)' }]
        };
      });
      console.log('✅ 슬라이드 변환 완료:', slides.length, '슬라이드');
      return slides;
    } else {
      console.warn('⚠️ JSON에 slides 배열이 없음. 최상위 구조:', Object.keys(json));
    }
  } else {
    console.warn('⚠️ JSON 추출 실패');
  }

  // Fallback: treat entire response as single text slide
  console.log('📄 텍스트로 표시합니다');
  return [{ title: '풀이', items: [{ type: 'text', content: rawText }] }];
}

function normalizeSlideItem(item) {
  if (!item || typeof item !== 'object') return { type: 'text', content: decodeEscapedUnicode(String(item)) };
  const type = (item.type || 'text').toLowerCase();
  if (type === 'math' || type === 'draw' || type === 'image') {
    return { type, content: decodeEscapedUnicode(String(item.content || '')) };
  }
  const rawContent = item.content || item.text || item.description || '';
  return { type: 'text', content: decodeEscapedUnicode(String(rawContent)) };
}

function extractJson(text) {
  // First, remove markdown code blocks if present
  let cleanText = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
  
  console.log('🔍 JSON 추출 시도:', cleanText.substring(0, 100));
  
  const jsonStart = cleanText.indexOf('{');
  const jsonArrayStart = cleanText.indexOf('[');
  
  // Determine where JSON actually starts
  let startPos = jsonStart;
  if (jsonArrayStart !== -1 && (jsonStart === -1 || jsonArrayStart < jsonStart)) {
    startPos = jsonArrayStart;
  }
  
  if (startPos === -1) {
    console.warn('⚠️ JSON 시작 위치를 찾을 수 없음 (괄호 없음)');
    return null;
  }

  let depth = 0;
  let inString = false;
  let escape = false;
  const isArray = cleanText[startPos] === '[';
  
  for (let i = startPos; i < cleanText.length; i += 1) {
    const char = cleanText[i];
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
    }
    if (!inString) {
      if (isArray) {
        if (char === '[') depth += 1;
        if (char === ']') depth -= 1;
      } else {
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
      }
      
      if (depth === 0) {
        const candidate = cleanText.slice(startPos, i + 1);
        try {
          const parsed = JSON.parse(candidate);
          console.log('✅ JSON 파싱 성공');
          return parsed;
        } catch (error) {
          console.warn('❌ JSON 파싱 오류:', error.message);
          // Try to find a valid JSON by trimming the end
          for (let j = i; j >= startPos; j--) {
            const trimmedCandidate = cleanText.slice(startPos, j + 1);
            try {
              const parsed = JSON.parse(trimmedCandidate);
              console.log('✅ 트리밍된 JSON 파싱 성공');
              return parsed;
            } catch (error2) {
              // continue
            }
          }
          return null;
        }
      }
    }
  }
  console.warn('⚠️ JSON 구조 불완전 (깊이:', depth, ')');
  return null;
}

function finishSlides(slides) {
  currentSlides = slides;
  currentIndex = 0;
  slidePanel.hidden = false;
  slideCountLabel.textContent = String(slides.length);
  changeSlide(0);
  setStatus('풀이이 생성되었습니다. 슬라이드를 확인하세요.');
}

function addSlidesToCurrent(newSlides) {
  if (!Array.isArray(newSlides) || newSlides.length === 0) return;
  
  // Remove last slide if it contains only feedback request
  if (currentSlides.length > 0) {
    const lastSlide = currentSlides[currentSlides.length - 1];
    if (lastSlide.items && lastSlide.items.length === 1 && lastSlide.items[0].type === 'text') {
      const content = lastSlide.items[0].content.toLowerCase();
      if (content.includes('추가') || content.includes('질문') || content.includes('피드백')) {
        currentSlides.pop();
      }
    }
  }
  
  // Add new slides
  currentSlides = currentSlides.concat(newSlides);
  slideCountLabel.textContent = String(currentSlides.length);
  
  // Stay on last slide before additions
  changeSlide(currentSlides.length - newSlides.length);
}

function changeSlide(nextIndex) {
  if (nextIndex < 0 || nextIndex >= currentSlides.length) return;
  currentIndex = nextIndex;
  const slide = currentSlides[currentIndex];
  slideIndexLabel.textContent = String(currentIndex + 1);
  slideTitle.textContent = slide.title || `슬라이드 ${currentIndex + 1}`;
  slideContent.innerHTML = '';

  if (Array.isArray(slide.items)) {
    slide.items.forEach((item) => renderSlideItem(item, slideContent));
  }

  prevButton.disabled = currentIndex === 0;
  nextButton.disabled = currentIndex === currentSlides.length - 1;

  feedbackPanel.hidden = currentIndex !== currentSlides.length - 1;
}

function renderSlideItem(item, container) {
  if (item.type === 'text') {
    const paragraph = document.createElement('p');
    paragraph.className = 'item-text';
    paragraph.innerHTML = sanitizeText(item.content);
    container.appendChild(paragraph);
    return;
  }

  if (item.type === 'math') {
    const mathWrapper = document.createElement('div');
    mathWrapper.className = 'item-math';
    try {
      // Check if KaTeX is loaded
      if (!katexLoaded || typeof katex === 'undefined') {
        throw new Error('KaTeX library not loaded');
      }

      // Clean up LaTeX content - remove extra backslashes and fix common issues
      let cleanContent = item.content
        .replace(/\\\\/g, '\\')  // Remove double backslashes
        .replace(/\\text\{\s*\}/g, '')  // Remove empty \text{}
        .trim();

      mathWrapper.innerHTML = katex.renderToString(cleanContent, {
        throwOnError: false,
        displayMode: true,
        fleqn: false,
        leqno: false,
        macros: {
          "\\RR": "\\mathbb{R}",
          "\\NN": "\\mathbb{N}",
          "\\ZZ": "\\mathbb{Z}",
          "\\QQ": "\\mathbb{Q}",
          "\\CC": "\\mathbb{C}"
        }
      });
      // Remove KaTeX accessibility helper spans that can render as visible text in some environments
      mathWrapper.querySelectorAll('.katex-html').forEach(el => el.remove());
    } catch (error) {
      console.warn('LaTeX rendering error:', error);
      // Enhanced fallback rendering
      let fallbackContent = item.content;
      
      // Try to render with MathJax if available
      if (typeof MathJax !== 'undefined') {
        try {
          mathWrapper.innerHTML = `\\[${fallbackContent}\\]`;
          MathJax.typesetPromise([mathWrapper]).catch(() => {
            // MathJax fallback failed, use plain text
            mathWrapper.textContent = fallbackContent;
          });
        } catch (mathjaxError) {
          mathWrapper.textContent = fallbackContent;
        }
      } else {
        // Basic text fallback with some formatting
        const formattedContent = fallbackContent
          .replace(/\\\\/g, '\\')
          .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1)/($2)')
          .replace(/\\sqrt\{([^}]+)\}/g, '√($1)')
          .replace(/\\pi/g, 'π')
          .replace(/\\alpha/g, 'α')
          .replace(/\\beta/g, 'β')
          .replace(/\\gamma/g, 'γ')
          .replace(/\\delta/g, 'δ')
          .replace(/\\theta/g, 'θ')
          .replace(/\\infty/g, '∞')
          .replace(/\\sum/g, '∑')
          .replace(/\\int/g, '∫')
          .replace(/\\\(/g, '(')
          .replace(/\\\)/g, ')')
          .replace(/\\\[/g, '[')
          .replace(/\\\]/g, ']');
        
        mathWrapper.textContent = formattedContent;
      }
    }
    container.appendChild(mathWrapper);
    return;
  }

  if (item.type === 'draw') {
    const wrap = document.createElement('div');
    wrap.className = 'draw-canvas-wrap';
    const canvas = document.createElement('canvas');
    canvas.width = 840;
    canvas.height = 520;
    wrap.appendChild(canvas);
    container.appendChild(wrap);
    const commands = parseDrawDSL(item.content);
    renderDraw(canvas, commands);
    return;
  }

  if (item.type === 'image') {
    const img = document.createElement('img');
    img.src = item.content;
    img.alt = '슬라이드 이미지';
    img.style.maxWidth = '100%';
    container.appendChild(img);
    return;
  }

  // Fallback: treat as text if type is unrecognized
  const paragraph = document.createElement('p');
  paragraph.className = 'item-text';
  paragraph.innerHTML = sanitizeText(item.content || JSON.stringify(item, null, 2));
  container.appendChild(paragraph);
}

function decodeEscapedUnicode(text) {
  return text
    .replace(/\\u20d7\s*([A-Za-z]+)/g, (_, letters) => letters + '\u20d7')
    .replace(/\u20d7\s*([A-Za-z]+)/g, (_, letters) => letters + '\u20d7')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function sanitizeText(raw) {
  const decoded = decodeEscapedUnicode(String(raw));
  return decoded
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

function parseDrawDSL(raw) {
  const source = raw.trim();
  const body = source.replace(/^draw\s*\{/i, '').replace(/\}\s*$/, '').trim();
  const lines = [];
  let buffer = '';
  let depth = 0;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    buffer += ch;

    if (ch === '(') {
      depth += 1;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
    }

    const next = body[i + 1];
    if (depth === 0 && ch === ';') {
      lines.push(buffer.slice(0, -1).trim());
      buffer = '';
      continue;
    }

    if (depth === 0 && (ch === '\n' || ch === '\r')) {
      lines.push(buffer.trim());
      buffer = '';
      continue;
    }

    if (depth === 0 && next && /\s/.test(next)) {
      const peek = body.slice(i + 1).trimStart();
      if (/^(?:[a-zA-Z_][a-zA-Z0-9_]*\s*=\s*)?(?:line|segment|ray|circle|point|polygon|midpoint|intersect|text|angle|perpendicular|plot|arrow|vector)\b/i.test(peek)) {
        const trimmed = buffer.trim();
        if (trimmed) {
          lines.push(trimmed);
          buffer = '';
        }
      }
    }
  }

  if (buffer.trim()) lines.push(buffer.trim());

  const shapes = {};
  let anonymousIndex = 0;

  for (const line of lines) {
    const assignMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
    const expr = assignMatch ? assignMatch[2].trim() : line;
    const name = assignMatch ? assignMatch[1] : `shape_${++anonymousIndex}`;

    const command = parseDrawCommand(expr, name, shapes);
    if (command) shapes[command.name] = command;
  }

  return Object.values(shapes);
}

function evaluateMathExpression(expr, x) {
  try {
    // Replace ^ with ** for exponentiation
    let jsExpr = expr.replace(/\^/g, '**');
    
    // Replace common math functions
    jsExpr = jsExpr.replace(/\bsin\b/g, 'Math.sin');
    jsExpr = jsExpr.replace(/\bcos\b/g, 'Math.cos');
    jsExpr = jsExpr.replace(/\btan\b/g, 'Math.tan');
    jsExpr = jsExpr.replace(/\basin\b/g, 'Math.asin');
    jsExpr = jsExpr.replace(/\bacos\b/g, 'Math.acos');
    jsExpr = jsExpr.replace(/\batan\b/g, 'Math.atan');
    jsExpr = jsExpr.replace(/\bsqrt\b/g, 'Math.sqrt');
    jsExpr = jsExpr.replace(/\babs\b/g, 'Math.abs');
    jsExpr = jsExpr.replace(/\blog\b/g, 'Math.log');
    jsExpr = jsExpr.replace(/\bexp\b/g, 'Math.exp');
    jsExpr = jsExpr.replace(/\bpi\b/g, 'Math.PI');
    jsExpr = jsExpr.replace(/\be\b/g, 'Math.E');
    
    // Create a function with x as parameter
    const func = new Function('x', 'Math', `return ${jsExpr};`);
    return func(x, Math);
  } catch (error) {
    console.warn('Error evaluating expression:', expr, error);
    return NaN;
  }
}

function parseDrawCommand(expr, name, shapes) {
  const lineMatch = expr.match(/^line\(\s*\(([-\d.]+)\s*,\s*([-\d.]+)\)\s*,\s*\(([-\d.]+)\s*,\s*([-\d.]+)\)\s*,\s*([^\)]+)\)$/i);
  if (lineMatch) {
    return { type: 'line', name, from: [parseFloat(lineMatch[1]), parseFloat(lineMatch[2])], to: [parseFloat(lineMatch[3]), parseFloat(lineMatch[4])], style: lineMatch[5].trim() };
  }

  const segmentMatch = expr.match(/^segment\(\s*\(([-\d.]+)\s*,\s*([-\d.]+)\)\s*,\s*\(([-\d.]+)\s*,\s*([-\d.]+)\)\s*,\s*([^\)]+)\)$/i);
  if (segmentMatch) {
    return { type: 'segment', name, from: [parseFloat(segmentMatch[1]), parseFloat(segmentMatch[2])], to: [parseFloat(segmentMatch[3]), parseFloat(segmentMatch[4])], style: segmentMatch[5].trim() };
  }

  const rayMatch = expr.match(/^ray\(\s*\(([-\d.]+)\s*,\s*([-\d.]+)\)\s*,\s*\(([-\d.]+)\s*,\s*([-\d.]+)\)\s*,\s*([^\)]+)\)$/i);
  if (rayMatch) {
    return { type: 'ray', name, from: [parseFloat(rayMatch[1]), parseFloat(rayMatch[2])], to: [parseFloat(rayMatch[3]), parseFloat(rayMatch[4])], style: rayMatch[5].trim() };
  }

  const circleMatch = expr.match(/^circle\(\s*\(([-\d.]+)\s*,\s*([-\d.]+)\)\s*,\s*([-\d.]+)\s*,\s*([^\)]+)\)$/i);
  if (circleMatch) {
    return { type: 'circle', name, center: [parseFloat(circleMatch[1]), parseFloat(circleMatch[2])], radius: parseFloat(circleMatch[3]), style: circleMatch[4].trim() };
  }

  const pointMatch = expr.match(/^point\(\s*\(([-\d.]+)\s*,\s*([-\d.]+)\)\s*,\s*"([^"]*)"\s*,\s*([^\)]+)\)$/i);
  if (pointMatch) {
    return { type: 'point', name, pos: [parseFloat(pointMatch[1]), parseFloat(pointMatch[2])], label: pointMatch[3], style: pointMatch[4].trim() };
  }

  const pointLabelMatch = expr.match(/^point\(\s*\(([-\d.]+)\s*,\s*([-.\d]+)\)\s*,\s*"([^"]*)"\)$/i);
  if (pointLabelMatch) {
    return { type: 'point', name, pos: [parseFloat(pointLabelMatch[1]), parseFloat(pointLabelMatch[2])], label: pointLabelMatch[3], style: 'solid' };
  }

  const pointSimpleMatch = expr.match(/^point\(\s*\(([-\d.]+)\s*,\s*([-\d.]+)\)\s*,\s*([^\)]+)\)$/i);
  if (pointSimpleMatch) {
    return { type: 'point', name, pos: [parseFloat(pointSimpleMatch[1]), parseFloat(pointSimpleMatch[2])], label: '', style: pointSimpleMatch[3].trim() };
  }

  const polygonMatch = expr.match(/^polygon\(\s*([\[\(].+[\]\)])\s*,\s*([^\)]+)\)$/i);
  if (polygonMatch) {
    const coords = polygonMatch[1].replace(/\[|\]/g, '').trim();
    const points = coords.split(/\)\s*,\s*\(/).map((seg) => {
      const cleaned = seg.replace(/[\(\)]/g, '').trim();
      const [x, y] = cleaned.split(/\s*,\s*/).map((n) => parseFloat(n));
      return [x, y];
    });
    return { type: 'polygon', name, points, style: polygonMatch[2].trim() };
  }

  const midpointMatch = expr.match(/^midpoint\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*,\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)$/i);
  if (midpointMatch) {
    return { type: 'midpoint', name, a: midpointMatch[1], b: midpointMatch[2] };
  }

  const intersectMatch = expr.match(/^intersect\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*,\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)$/i);
  if (intersectMatch) {
    return { type: 'intersect', name, a: intersectMatch[1], b: intersectMatch[2] };
  }

  const textMatch = expr.match(/^text\(\s*\(([-\d.]+)\s*,\s*([-\d.]+)\)\s*,\s*"([^"]*)"(?:\s*,\s*([\d.]+))?\)$/i);
  if (textMatch) {
    return { type: 'text', name, pos: [parseFloat(textMatch[1]), parseFloat(textMatch[2])], label: textMatch[3], size: parseFloat(textMatch[4] || '16') };
  }

  const angleMatch = expr.match(/^angle\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*,\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*,\s*([^\)]+)\)$/i);
  if (angleMatch) {
    return { type: 'angle', name, line1: angleMatch[1], line2: angleMatch[2], style: angleMatch[3].trim() };
  }

  const perpendicularMatch = expr.match(/^perpendicular\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*,\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*,\s*([^\)]+)\)$/i);
  if (perpendicularMatch) {
    return { type: 'perpendicular', name, line: perpendicularMatch[1], point: perpendicularMatch[2], style: perpendicularMatch[3].trim() };
  }

  const plotMatch = expr.match(/^plot\(\s*"([^"]+)"\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([^\)]*)\)$/i);
  if (plotMatch) {
    return { type: 'plot', name, expression: plotMatch[1], minX: parseFloat(plotMatch[2]), maxX: parseFloat(plotMatch[3]), style: plotMatch[4].trim() || 'solid' };
  }

  const arrowMatch = expr.match(/^arrow\(\s*\(([-\d.]+)\s*,\s*([\-\d.]+)\)\s*,\s*\(([-\d.]+)\s*,\s*([\-\d.]+)\)\s*(?:,\s*([^\)]+))?\)$/i);
  if (arrowMatch) {
    return { type: 'arrow', name, from: [parseFloat(arrowMatch[1]), parseFloat(arrowMatch[2])], to: [parseFloat(arrowMatch[3]), parseFloat(arrowMatch[4])], style: (arrowMatch[5] || 'solid').trim() };
  }

  const vectorMatch = expr.match(/^vector\(\s*\(([-\d.]+)\s*,\s*([\-\d.]+)\)\s*,\s*\(([-\d.]+)\s*,\s*([\-\d.]+)\)\s*(?:,\s*([^\)]+))?\)$/i);
  if (vectorMatch) {
    return { type: 'arrow', name, from: [parseFloat(vectorMatch[1]), parseFloat(vectorMatch[2])], to: [parseFloat(vectorMatch[3]), parseFloat(vectorMatch[4])], style: (vectorMatch[5] || 'solid').trim() };
  }

  return { type: 'unknown', name, content: expr };
}

function renderDraw(canvas, commands) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!commands || !commands.length) return;

  const shapes = buildShapeMap(commands);
  const bounds = computeBounds(commands);
  const mapper = createCoordinateMapper(bounds, canvas.width, canvas.height, 40);

  // Ensure white background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const shape of commands) {
    drawShape(ctx, shape, shapes, mapper);
  }
}

function buildShapeMap(commands) {
  const map = {};
  commands.forEach((shape) => {
    if (shape.type === 'midpoint') {
      const a = map[shape.a] || null;
      const b = map[shape.b] || null;
      if (a && b && a.pos && b.pos) {
        shape.pos = [(a.pos[0] + b.pos[0]) / 2, (a.pos[1] + b.pos[1]) / 2];
      }
    }
    if (shape.type === 'intersect') {
      const a = map[shape.a];
      const b = map[shape.b];
      if (a && b) {
        const point = computeIntersectionPoint(a, b);
        if (point) shape.pos = point;
      }
    }
    if (shape.type === 'angle') {
      const line1 = map[shape.line1];
      const line2 = map[shape.line2];
      if (line1 && line2) {
        const angleData = computeAngleArc(line1, line2);
        if (angleData) {
          shape.center = angleData.center;
          shape.startAngle = angleData.startAngle;
          shape.endAngle = angleData.endAngle;
          shape.radius = angleData.radius;
        }
      }
    }
    if (shape.type === 'perpendicular') {
      const line = map[shape.line];
      const point = map[shape.point];
      if (line && point && point.pos) {
        const foot = computePerpendicularFoot(line, point.pos);
        if (foot) {
          shape.from = point.pos;
          shape.to = foot;
        }
      }
    }
    if (shape.type === 'line' || shape.type === 'segment' || shape.type === 'ray' || shape.type === 'arrow') {
      map[shape.name] = shape;
    } else if (shape.type === 'circle' || shape.type === 'point' || shape.type === 'text') {
      map[shape.name] = shape;
      if (shape.type === 'point' || shape.type === 'text') shape.pos = shape.pos || shape.center || null;
    } else if (shape.type === 'polygon') {
      map[shape.name] = shape;
    } else if (shape.type === 'plot') {
      // Generate plot points
      const points = [];
      const steps = 200; // Number of points to plot
      const stepSize = (shape.maxX - shape.minX) / steps;
      for (let i = 0; i <= steps; i++) {
        const x = shape.minX + i * stepSize;
        const y = evaluateMathExpression(shape.expression, x);
        if (isFinite(y)) {
          points.push([x, y]);
        }
      }
      shape.points = points;
      map[shape.name] = shape;
    } else if (shape.type === 'midpoint' || shape.type === 'intersect' || shape.type === 'angle' || shape.type === 'perpendicular') {
      if (shape.pos || shape.from || shape.center) map[shape.name] = shape;
    }
  });
  return map;
}

function computeBounds(commands) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const extract = (point) => {
    if (!Array.isArray(point) || point.length < 2) return;
    minX = Math.min(minX, point[0]);
    minY = Math.min(minY, point[1]);
    maxX = Math.max(maxX, point[0]);
    maxY = Math.max(maxY, point[1]);
  };

  commands.forEach((shape) => {
    if (shape.from) extract(shape.from);
    if (shape.to) extract(shape.to);
    if (shape.center) extract(shape.center);
    if (shape.pos) extract(shape.pos);
    if (shape.points) shape.points.forEach(extract);
    if (shape.type === 'circle' && shape.center && typeof shape.radius === 'number') {
      const [cx, cy] = shape.center;
      const r = Math.abs(shape.radius);
      extract([cx - r, cy]);
      extract([cx + r, cy]);
      extract([cx, cy - r]);
      extract([cx, cy + r]);
    }
    // Include angle arc bounds
    if (shape.type === 'angle' && shape.center && shape.radius) {
      const [cx, cy] = shape.center;
      const r = shape.radius;
      extract([cx - r, cy - r]);
      extract([cx + r, cy + r]);
    }
  });

  if (!isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  }
  if (maxX === minX) {
    minX -= 2;
    maxX += 2;
  }
  if (maxY === minY) {
    minY -= 2;
    maxY += 2;
  }

  return { minX, minY, maxX, maxY };
}

function createCoordinateMapper(bounds, width, height, margin) {
  const plotWidth = width - margin * 2;
  const plotHeight = height - margin * 2;
  const xScale = plotWidth / (bounds.maxX - bounds.minX);
  const yScale = plotHeight / (bounds.maxY - bounds.minY);
  const scale = Math.min(xScale, yScale);

  return function map(point) {
    const x = margin + (point[0] - bounds.minX) * scale;
    const y = height - margin - (point[1] - bounds.minY) * scale;
    return [x, y];
  };
}

function drawShape(ctx, shape, shapes, map) {
  const style = normalizeStyle(shape.style || (shape.type === 'angle' ? 'blue' : 'solid'));
  const stroke = style.color || ((shape.type === 'line' || shape.type === 'segment' || shape.type === 'ray') ? '#7f7f7f' : '#0f172a');
  // Ensure stroke is not white to avoid invisible shapes
  const safeStroke = (stroke === '#ffffff' || stroke.toLowerCase() === 'white') ? '#0f172a' : stroke;
  const fill = style.fill || 'transparent';
  ctx.strokeStyle = safeStroke;
  ctx.fillStyle = fill;
  ctx.lineWidth = style.width;
  ctx.setLineDash(style.dash);

  if (shape.type === 'line' || shape.type === 'ray') {
    const [x1, y1] = map(shape.from);
    const [x2, y2] = map(shape.to);
    drawExtendedLine(ctx, x1, y1, x2, y2, shape.type === 'ray');
    if (style.arrow) drawArrowHead(ctx, x1, y1, x2, y2);
  }

  if (shape.type === 'segment') {
    const [x1, y1] = map(shape.from);
    const [x2, y2] = map(shape.to);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    if (style.arrow) drawArrowHead(ctx, x1, y1, x2, y2);
  }

  if (shape.type === 'arrow') {
    const [x1, y1] = map(shape.from);
    const [x2, y2] = map(shape.to);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    drawArrowHead(ctx, x1, y1, x2, y2);
  }

  if (shape.type === 'circle') {
    const [cx, cy] = map(shape.center);
    ctx.beginPath();
    ctx.arc(cx, cy, Math.abs(shape.radius) * getScaleFactor(map), 0, Math.PI * 2);
    ctx.stroke();
    if (style.fill && style.fill !== 'transparent') {
      ctx.fill();
    }
  }

  if (shape.type === 'polygon') {
    const projected = shape.points.map(map);
    if (projected.length > 2) {
      ctx.beginPath();
      ctx.moveTo(projected[0][0], projected[0][1]);
      projected.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.closePath();
      ctx.stroke();
      if (style.fill && style.fill !== 'transparent') ctx.fill();
    }
  }

  if (shape.type === 'point') {
    const [cx, cy] = map(shape.pos);
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fillStyle = style.color || '#0f172a';
    ctx.fill();
    if (shape.label) {
      ctx.fillStyle = style.color || '#0f172a';  // Ensure text is visible
      ctx.font = '14px Inter, sans-serif';
      ctx.fillText(shape.label, cx + 8, cy - 8);
    }
  }

  if (shape.type === 'text') {
    const [cx, cy] = map(shape.pos);
    ctx.fillStyle = style.color || '#0f172a';  // Ensure text is visible on white backgrounds
    ctx.font = `${shape.size || 16}px Inter, sans-serif`;
    ctx.fillText(shape.label || shape.name, cx, cy);
  }

  if (shape.type === 'midpoint' || shape.type === 'intersect') {
    if (shape.pos) {
      const [cx, cy] = map(shape.pos);
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#f8fafc';
      ctx.fill();
      ctx.fillStyle = '#a5b4fc';
      ctx.font = '13px Inter, sans-serif';
      ctx.fillText(shape.name, cx + 8, cy + 4);
    }
  }

  if (shape.type === 'perpendicular') {
    if (shape.from && shape.to) {
      const [x1, y1] = map(shape.from);
      const [x2, y2] = map(shape.to);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }

  if (shape.type === 'angle') {
    if (shape.center && shape.startAngle !== undefined && shape.endAngle !== undefined && shape.radius) {
      const [cx, cy] = map(shape.center);
      const radius = shape.radius * getScaleFactor(map);
      ctx.save();
      ctx.lineWidth = Math.max(ctx.lineWidth, 2.5); // Ensure minimum thickness for visibility
      ctx.beginPath();
      ctx.arc(cx, cy, radius, shape.startAngle, shape.endAngle, shape.anticlockwise || false);
      ctx.stroke();
      ctx.restore();
    }
  }

  if (shape.type === 'plot') {
    if (shape.points && shape.points.length > 1) {
      const projected = shape.points.map(map);
      ctx.beginPath();
      ctx.moveTo(projected[0][0], projected[0][1]);
      for (let i = 1; i < projected.length; i++) {
        ctx.lineTo(projected[i][0], projected[i][1]);
      }
      ctx.stroke();
    }
  }

  if (shape.type === 'unknown') {
    ctx.fillStyle = '#f97316';
    ctx.font = '13px Inter, sans-serif';
    ctx.fillText(shape.content, 20, 20);
  }
}

function normalizeStyle(styleText) {
  // Default colors that are visible on a white canvas
  const style = { color: '', fill: 'transparent', width: 2, dash: [], arrow: false };
  if (!styleText) return style;
  const tokens = styleText.toLowerCase().split(/\s*[,:]\s*|\s+/).filter(Boolean);
  tokens.forEach((token) => {
    if (token === 'dashed') style.dash = [6, 6];
    if (token === 'dotted' || token === 'dot') style.dash = [2, 4];
    if (token === 'solid') style.dash = [];
    if (token === 'bold') style.width = 3.5;
    if (token === 'thin') style.width = 1.2;
    // Brighter, more visible colors against dark background
    if (token === 'red') style.color = '#ff6b6b';
    if (token === 'blue') style.color = '#74c0fc';
    if (token === 'green') style.color = '#69db7c';
    if (token === 'yellow') style.color = '#ffd43b';
    if (token === 'purple') style.color = '#da77f2';
    if (token === 'orange') style.color = '#ff922b';
    if (token === 'cyan') style.color = '#4dabf7';
    if (token === 'magenta') style.color = '#f783ac';
    if (token === 'gray' || token === 'grey') style.color = '#adb5bd';
    if (token.startsWith('fill')) {
      const parts = token.split(':');
      if (parts[1]) {
        style.fill = parts[1];
      } else {
        // Default fill with some transparency
        style.fill = 'rgba(255, 255, 255, 0.1)';
      }
    }
    if (token === 'arrow') style.arrow = true;
  });
  return style;
}

function getScaleFactor(map) {
  const [x1, y1] = map([0, 0]);
  const [x2] = map([1, 0]);
  return Math.abs(x2 - x1);
}

function drawExtendedLine(ctx, x1, y1, x2, y2, isRay) {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const dx = x2 - x1;
  const dy = y2 - y1;
  let start = [x1, y1];
  let end = [x2, y2];

  if (Math.abs(dx) < 1e-4) {
    start = [x1, 0];
    end = [x1, height];
    if (isRay && dy < 0) end = [x1, 0];
  } else {
    const slope = dy / dx;
    const intercept = y1 - slope * x1;
    const p1 = [0, intercept];
    const p2 = [width, slope * width + intercept];
    start = p1;
    end = p2;
    if (isRay) {
      const dot = (x2 - x1) * (end[0] - x1) + (y2 - y1) * (end[1] - y1);
      if (dot < 0) end = [0, intercept];
    }
  }

  ctx.beginPath();
  ctx.moveTo(start[0], start[1]);
  ctx.lineTo(end[0], end[1]);
  ctx.stroke();
}

function computeIntersectionPoint(a, b) {
  const l1 = normalizeLineShape(a);
  const l2 = normalizeLineShape(b);
  if (!l1 || !l2) return null;

  const [x1, y1] = l1.from;
  const [x2, y2] = l1.to;
  const [x3, y3] = l2.from;
  const [x4, y4] = l2.to;
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-6) return null;
  const px = ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / denom;
  const py = ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / denom;
  return [px, py];
}

function normalizeLineShape(shape) {
  if (shape.type === 'line' || shape.type === 'segment' || shape.type === 'ray' || shape.type === 'arrow') {
    return shape;
  }
  return null;
}

function drawArrowHead(ctx, x1, y1, x2, y2, size = 12) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.save();
  ctx.translate(x2, y2);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-size, size * 0.55);
  ctx.lineTo(-size, -size * 0.55);
  ctx.closePath();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fill();
  ctx.restore();
}

function computeAngleArc(line1, line2) {
  const intersection = computeIntersectionPoint(line1, line2);
  if (!intersection) return null;

  const [cx, cy] = intersection;
  const vector1 = getAngleDirectionVector(line1, intersection);
  const vector2 = getAngleDirectionVector(line2, intersection);
  if (!vector1 || !vector2) return null;

  const angle1 = Math.atan2(vector1[1], vector1[0]);
  const angle2 = Math.atan2(vector2[1], vector2[0]);

  const normalized1 = normalizeAngle(angle1);
  const normalized2 = normalizeAngle(angle2);
  let startAngle = normalized1;
  let endAngle = normalized2;
  let anticlockwise = false;

  let delta = endAngle - startAngle;
  if (delta < 0) delta += Math.PI * 2;
  if (delta > Math.PI) {
    anticlockwise = true;
    [startAngle, endAngle] = [endAngle, startAngle];
    delta = Math.PI * 2 - delta;
  }

  const dist1 = Math.hypot(vector1[0], vector1[1]);
  const dist2 = Math.hypot(vector2[0], vector2[1]);
  const radius = Math.max(Math.min(dist1, dist2) * 0.35, 10);

  return { center: [cx, cy], startAngle, endAngle, radius, anticlockwise };
}

function getAngleDirectionVector(line, intersection) {
  const [cx, cy] = intersection;
  const [x1, y1] = line.from;
  const [x2, y2] = line.to;
  const dx1 = x1 - cx;
  const dy1 = y1 - cy;
  const dx2 = x2 - cx;
  const dy2 = y2 - cy;
  const len1 = Math.hypot(dx1, dy1);
  const len2 = Math.hypot(dx2, dy2);
  if (len1 < 1e-6 && len2 < 1e-6) return null;
  return len1 >= len2 ? [dx1, dy1] : [dx2, dy2];
}

function normalizeAngle(angle) {
  return angle < 0 ? angle + Math.PI * 2 : angle;
}

function computePerpendicularFoot(line, point) {
  const [x1, y1] = line.from;
  const [x2, y2] = line.to;
  const [px, py] = point;
  
  // Vector from line start to end
  const dx = x2 - x1;
  const dy = y2 - y1;
  
  // Vector from line start to point
  const dxp = px - x1;
  const dyp = py - y1;
  
  // Project point onto line
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return null; // Degenerate line
  
  const t = (dxp * dx + dyp * dy) / lenSq;
  
  // Foot of perpendicular
  const fx = x1 + t * dx;
  const fy = y1 + t * dy;
  
  return [fx, fy];
}
