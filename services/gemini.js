import { GoogleGenerativeAI } from '@google/generative-ai';
import db from './database.js';

// Get AI Model based on configuration or environment
function getAIClient() {
  const config = db.getConfig();
  const apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    throw new Error('Gemini API key is not configured. Please set it in Settings.');
  }
  
  return new GoogleGenerativeAI(apiKey);
}

/**
 * Builds the comprehensive prompt for generating expert articles
 */
function buildSystemPrompt(blockName, title, description, customInstructions = '') {
  return `
Ты — ведущий международный ИТ-архитектор, enterprise-консультант и партнер в технологической консалтинговой компании уровня Gartner или McKinsey Digital. Твоя аудитория — генеральные директора (CEO), финансовые директора (CFO), технические директора (CTO) и вице-президенты по технологиям крупных компаний.

Твоя задача — написать глубокую, экспертную статью для профессионального Telegram-канала на тему:
«${title}»
Раздел: ${blockName}
Контекст темы: ${description}

${customInstructions ? `Дополнительные требования к содержанию: ${customInstructions}` : ''}

ПРАВИЛА ОФОРМЛЕНИЯ И СТИЛЯ:
1. ГОЛОС И ТОН:
   - Прямой, уверенный, прагматичный, аналитический и слегка провокационный.
   - Избегай банальностей, маркетинговой "воды" и общих фраз. Говори на языке цифр, архитектурных решений, рисков и упущенной выгоды.
   - Пиши на русском языке, но обязательно используй устоявшиеся международные термины в оригинале или в скобках, например: Generative Engine Optimization (GEO), Decision Velocity, App Store Fatigue, Token Maxing, Sovereign R&D contour, Cost Per Lead (CPL), Fan-out requests, JTBD (Jobs-To-Be-Done).

2. СТРОГИЕ ЗАПРЕТЫ (АНТИ-ПАТТЕРНЫ ИИ):
   - НИКАКИХ шаблонных вступлений типа: "В современном мире...", "В эпоху искусственного интеллекта...", "Давайте разберемся...", "Приветствую, дорогие читатели!". Начинай сразу с сути или с жесткого тезиса/проблемы.
   - НИКАКИХ шаблонных выводов типа: "В заключение...", "Подводя итоги, хочется отметить...". Статья должна заканчиваться конкретным стратегическим выводом или планом действий (Takeaway) без вводных клише.
   - МИНИМУМ эмодзи: допускается не более 2-3 эмодзи на весь текст исключительно для разметки списков (например, ⚡ или 🎯). Никаких эмодзи в конце каждого предложения!
   - Никаких общих слов. Если говоришь про расходы — объясни механизм (например, лавинообразный рост рекурсивных API-запросов в многоагентных системах).

3. СТРУКТУРА ТЕКСТА:
   - Заголовок: Сделай его ярким, емким и жирным в Telegram-формате (без слова "Заголовок").
   - Проблема: Опиши рыночную боль или ошибочный подход топ-менеджмента.
   - Технико-экономический анализ: Вскрой суть (как это работает под капотом, почему стандартные CRM/SaaS/SEO-подходы здесь ломаются).
   - Практическое решение: Четкий пошаговый план, архитектурная схема или чек-лист, который СЕО может переслать технической команде.
   - Strategic Takeaway / Вывод для бизнеса: Одно емкое предложение о том, как это сбережет миллионы или создаст конкурентное преимущество.

4. РАЗМЕТКА TELEGRAM:
   - Используй HTML-разметку (<b>жирный</b>, <i>курсив</i>, <code>код/конфиг</code>, <pre>блоки кода</pre>).
   - Разделяй абзацы пустой строкой. Абзацы должны быть короткими (3-5 строк), чтобы текст легко читался с мобильного экрана.
   - Ограничение по объему: строго 1500 - 2300 символов (включая пробелы и HTML-теги). Это критическое требование из-за жестких лимитов Telegram (максимум 4096 символов на сообщение). Пиши лаконично, убирай любую "воду", концентрируйся на сути.
`;
}

/**
 * Generates an article based on a topic
 */
export async function generateArticle(topic, customInstructions = '') {
  try {
    const ai = getAIClient();
    
    // Using gemini-2.5-flash for content generation
    let modelName = 'gemini-2.5-flash';
    db.log('Gemini', `Initializing generation for: "${topic.title}" using ${modelName}`);
    
    const model = ai.getGenerativeModel({ model: modelName });

    const systemPrompt = buildSystemPrompt(topic.block, topic.title, topic.description, customInstructions);
    
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: systemPrompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2548,
      }
    });

    const response = await result.response;
    let text = response.text();

    // Clean up any potential markdown headings if they slipped through
    // Convert Markdown bold (**text**) to HTML bold (<b>text</b>) if the model ignored HTML format
    if (text.includes('**')) {
      text = text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
    }
    
    // Return structured object
    return {
      title: topic.title,
      content: text.trim()
    };
  } catch (error) {
    db.log('Gemini', `Generation error: ${error.message}`, 'error');
    throw error;
  }
}

/**
 * Refines an existing draft based on user feedback
 */
export async function refineArticle(title, content, feedback) {
  try {
    const ai = getAIClient();
    const model = ai.getGenerativeModel({ model: 'gemini-2.5-flash' });

    db.log('Gemini', `Refining draft: "${title}" based on feedback: "${feedback}"`);

    const prompt = `
Перед тобой черновик статьи для Telegram-канала:
Название: "${title}"

Текущий текст статьи:
---
${content}
---

Пользователь дал следующую обратную связь и просит доработать текст:
«${feedback}»

Твоя задача — переписать или скорректировать статью с учетом этих замечаний.
Сохраняй прежние правила:
- HTML-разметка (<b>жирный</b>, <i>курсив</i>, <code>код</code>).
- Профессиональный, авторитетный тон (без воды, без банальных вступлений/выводов).
- Telegram-форматирование с короткими абзацами.
- Использование профессиональных английских терминов.
- Максимум 2-3 эмодзи.
`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: 2548,
      }
    });

    const response = await result.response;
    let text = response.text();

    if (text.includes('**')) {
      text = text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
    }

    return text.trim();
  } catch (error) {
    db.log('Gemini', `Refinement error: ${error.message}`, 'error');
    throw error;
  }
}

/**
 * Proposes new trending topics using Gemini
 */
export async function generateNewTopics(existingTopics = [], count = 5) {
  try {
    const ai = getAIClient();
    const model = ai.getGenerativeModel({ model: 'gemini-2.5-flash' });
    
    db.log('Gemini', `Generating ${count} new expert topics...`);

    const titlesList = existingTopics.map(t => `- ${t.title}`).join('\n');

    const prompt = `
Ты — опытный шеф-редактор, контент-стратег и ведущий аналитик в нише ИИ для бизнеса (Agentic AI, Enterprise AI, AI Governance, Generative Engine Optimization).
Твоя задача — предложить ровно ${count} новых, актуальных и глубоких тем для публикаций в экспертном Telegram-канале для топ-менеджеров (CEO, CFO, CTO).

Ниши канала:
1. Макроэкономика ИИ и управление капиталом (AI Governance, ROI от внедрения, скрытые затраты, CPT против CPL).
2. Generative Engine Optimization (GEO) и ИИ-поисковики (оптимизация сайтов под Perplexity, ChatGPT Search, сущности вместо ключевиков).
3. Эволюция CRM (системы решений, AI-агенты для удержания клиентов, Progressive Web Apps вместо App Store).
4. Инфраструктурный суверенитет (no vendor lock-in, развертывание локальных SLM в собственном защищенном R&D контуре).

Вот список тем, которые УЖЕ БЫЛИ использованы или запланированы (не дублируй их! Темы должны быть новыми, но развивать эти идеи):
${titlesList}

ДЛЯ КАЖДОЙ ТЕМЫ ПРЕДЛОЖИ:
1. Точное название раздела (Блок).
2. Заголовок статьи (яркий, экспертный, привлекающий CFO/CEO).
3. Краткое описание (2-3 предложения): о чем писать, в чем технико-экономический прецедент или боль бизнеса, и какое решение/чек-лист будет предложено.

ВЫВЕДИ РЕЗУЛЬТАТ СТРОГО В ФОРМАТЕ JSON (массив объектов), без каких-либо дополнительных слов, разметки markdown или пояснений.
Формат ответа:
[
  {
    "block": "Название блока",
    "title": "Заголовок темы",
    "description": "Что раскрыть в статье..."
  },
  ...
]
`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.8,
        responseMimeType: "application/json"
      }
    });

    const response = await result.response;
    const text = response.text().trim();
    
    // Parse topics
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new Error('Response is not a valid JSON array');
    }

    return parsed.slice(0, count);
  } catch (error) {
    db.log('Gemini', `Topic generation failed: ${error.message}`, 'error');
    throw error;
  }
}
