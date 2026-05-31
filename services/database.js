import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'database.json');

// Default initial database content
const DEFAULT_TOPICS = [
  {
    id: "topic_token_maxing",
    block: "Блок 1. Макроэкономика ИИ и управление капиталом",
    title: "Кризис «Token Maxing»: Почему крупный бизнес сжигает годовые AI-бюджеты за три месяца и как остановить утечку маржи",
    description: "Анализ рыночного прецедента, когда компании бездумно внедряют агентные воронки и сталкиваются с лавинообразным ростом стоимости API-запросов. Решение: переход на оптимизированные локальные связки и жесткие семантические границы для ИИ-агентов, экономящие миллионы.",
    status: "approved",
    used: false
  },
  {
    id: "topic_decision_velocity",
    block: "Блок 1. Макроэкономика ИИ и управление капиталом",
    title: "Эра автономного исполнения: Почему метрика «Стоимость за лид» (CPL) уступает место «Скорости принятия решений» (Decision Velocity)",
    description: "Объяснение, почему побеждает CRM-система, способная без трения и участия человека квалифицировать, прогреть и довести клиента до сделки за секунды, пока он не потерял фокус, вместо залива рынка трафиком.",
    status: "approved",
    used: false
  },
  {
    id: "topic_digital_isolation",
    block: "Блок 2. GEO (Generative Engine Optimization)",
    title: "Цифровая изоляция: Как новые протоколы безопасности и клиентский JavaScript делают ваш бренд невидимым для ИИ-поисковиков (Perplexity, ChatGPT Search)",
    description: "Технико-стратегический пост про автоблокировки ИИ-ботов на уровне Cloudflare и тяжелый JS-рендеринг, скрывающие цены от краулеров. СЕО-чек-лист для технического директора.",
    status: "approved",
    used: false
  },
  {
    id: "topic_digital_entities",
    block: "Блок 2. GEO (Generative Engine Optimization)",
    title: "От ключевых слов к цифровым сущностям: Что такое Fan-out запросы и почему ИИ-ассистенты игнорируют ваше старое семантическое ядро",
    description: "Как поисковые модели разбивают запросы на подзапросы. Проектирование контента по JTBD, чтобы ИИ считывал компанию как авторитетную «сущность» и выдавал ссылку на PWA.",
    status: "approved",
    used: false
  },
  {
    id: "topic_salesforce_trap",
    block: "Блок 3. Эволюция CRM",
    title: "Ловушка Salesforce и SAP: Почему классические CRM хранят данные, но не понимают причин решений, и как это уничтожает LTV",
    description: "Традиционные CRM — это 'системы учета'. Будущее за 'системами решений'. Agentic AI фиксирует контекст и историю поведения клиента, защищая базу от оттока при смене менеджеров.",
    status: "approved",
    used: false
  },
  {
    id: "topic_app_store_fatigue",
    block: "Блок 3. Эволюция CRM",
    title: "App Store Fatigue: Математика отказа от нативных приложений в пользу экосистемных Progressive Web Apps (PWAs)",
    description: "Сухие цифры конверсии стоимости установки нативного приложения против запуска PWA в один тап без паролей из ИИ-выдачи с удержанием внутри CRM.",
    status: "approved",
    used: false
  },
  {
    id: "topic_ai_dependence",
    block: "Блок 4. Инфраструктурный суверенитет",
    title: "Риски ИИ-зависимости: Почему Enterprise-сегмент выбирает суверенный R&D-контур вместо проприетарных SaaS-платформ",
    description: "Опасность хранения коммерческих тайн на сторонних платформах. Преимущества развертывания сетей AI-агентов в собственном защищенном контуре (например, Yandex Cloud).",
    status: "approved",
    used: false
  }
];

class Database {
  constructor() {
    this.data = {
      config: {
        telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
        telegramChannelId: process.env.TELEGRAM_CHANNEL_ID || '',
        geminiApiKey: process.env.GEMINI_API_KEY || '',
        adminPassword: process.env.ADMIN_PASSWORD || 'admin',
        postingTime: '10:00', // Default posting time (HH:MM)
        postingDays: [1, 3, 5], // Mon, Wed, Fri (0=Sun, 1=Mon, etc.)
        autoPost: false // Auto publish scheduled posts via cron
      },
      topics: [...DEFAULT_TOPICS],
      posts: [],
      logs: []
    };
    this.init();
  }

  init() {
    try {
      if (fs.existsSync(DB_PATH)) {
        const fileContent = fs.readFileSync(DB_PATH, 'utf-8');
        const parsed = JSON.parse(fileContent);
        
        // Merge with defaults to ensure schema consistency
        this.data.config = { ...this.data.config, ...parsed.config };
        
        // Use loaded topics if they exist, otherwise seed them
        if (parsed.topics && parsed.topics.length > 0) {
          this.data.topics = parsed.topics;
        } else {
          this.data.topics = [...DEFAULT_TOPICS];
        }
        
        this.data.posts = parsed.posts || [];
        this.data.logs = parsed.logs || [];
      } else {
        this.save();
        this.log('System', 'Database initialized from default configuration');
      }
    } catch (error) {
      console.error('Database initialization failed, using memory fallback:', error);
    }
  }

  save() {
    try {
      // Create parent directories if they don't exist
      const dir = path.dirname(DB_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(DB_PATH, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (error) {
      console.error('Failed to write database file:', error);
    }
  }

  getConfig() {
    return this.data.config;
  }

  updateConfig(newConfig) {
    this.data.config = { ...this.data.config, ...newConfig };
    this.save();
    this.log('System', 'Configuration updated successfully');
    return this.data.config;
  }

  getTopics() {
    return this.data.topics;
  }

  addTopic(topic) {
    const newTopic = {
      id: 'topic_' + Date.now(),
      block: topic.block || 'Пользовательские темы',
      title: topic.title,
      description: topic.description,
      status: topic.status || 'pending', // Default is pending
      used: false
    };
    this.data.topics.push(newTopic);
    this.save();
    this.log('System', `Added new topic: "${newTopic.title}" (Status: ${newTopic.status})`);
    return newTopic;
  }

  updateTopicStatus(topicId, status) {
    const topic = this.data.topics.find(t => t.id === topicId);
    if (topic) {
      topic.status = status;
      this.save();
      this.log('System', `Topic "${topic.title}" status updated to: ${status}`);
      return true;
    }
    return false;
  }

  markTopicUsed(topicId, used = true) {
    const topic = this.data.topics.find(t => t.id === topicId);
    if (topic) {
      topic.used = used;
      this.save();
    }
  }

  getPosts() {
    return this.data.posts;
  }

  getPost(id) {
    return this.data.posts.find(p => p.id === id);
  }

  savePost(post) {
    const idx = this.data.posts.findIndex(p => p.id === post.id);
    if (idx !== -1) {
      this.data.posts[idx] = { ...this.data.posts[idx], ...post, updatedAt: new Date().toISOString() };
      this.log('System', `Updated post: "${post.title}" (Status: ${post.status})`);
    } else {
      const newPost = {
        id: post.id || 'post_' + Date.now(),
        topicId: post.topicId || 'custom',
        title: post.title,
        content: post.content,
        status: post.status || 'draft',
        scheduledAt: post.scheduledAt || null,
        publishedAt: post.publishedAt || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      this.data.posts.push(newPost);
      this.log('System', `Created new post: "${newPost.title}" (Status: ${newPost.status})`);
      if (newPost.topicId !== 'custom') {
        this.markTopicUsed(newPost.topicId, true);
      }
    }
    this.save();
    return post;
  }

  deletePost(id) {
    const post = this.getPost(id);
    if (post) {
      this.data.posts = this.data.posts.filter(p => p.id !== id);
      if (post.topicId !== 'custom') {
        // Mark topic as unused again
        this.markTopicUsed(post.topicId, false);
      }
      this.save();
      this.log('System', `Deleted post: "${post.title}"`);
      return true;
    }
    return false;
  }

  getLogs(limit = 100) {
    return this.data.logs.slice(-limit).reverse();
  }

  log(source, message, level = 'info') {
    const logEntry = {
      timestamp: new Date().toISOString(),
      source,
      message,
      level
    };
    this.data.logs.push(logEntry);
    
    // Keep logs within bounds (last 500)
    if (this.data.logs.length > 500) {
      this.data.logs.shift();
    }
    this.save();
    console.log(`[${logEntry.timestamp}] [${source}] [${level.toUpperCase()}] ${message}`);
  }

  clearLogs() {
    this.data.logs = [];
    this.save();
    this.log('System', 'Logs cleared');
  }
}

const db = new Database();
export default db;
