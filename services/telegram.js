import { Telegraf } from 'telegraf';
import db from './database.js';
import { generateArticle, generateNewTopics } from './gemini.js';

function sanitizeHtmlForTelegram(html) {
  if (!html) return '';

  let clean = html;

  // Pre-process common structural tags that we want to convert to text formatting before tokenizing
  clean = clean.replace(/<br\s*\/?>/gi, '\n');
  clean = clean.replace(/<p>/gi, '');
  clean = clean.replace(/<\/p>/gi, '\n\n');
  clean = clean.replace(/<li>/gi, '• ');
  clean = clean.replace(/<\/li>/gi, '\n');
  clean = clean.replace(/<\/?ul>/gi, '');
  clean = clean.replace(/<\/?ol>/gi, '');
  clean = clean.replace(/<h[1-6]>/gi, '<b>');
  clean = clean.replace(/<\/h[1-6]>/gi, '</b>\n\n');

  // Tokenize the HTML by splitting into tags and text
  // The regex matches HTML tags: <...>.
  const tagRegex = /(<\/?[a-zA-Z0-9:-]+(?:\s+[a-zA-Z0-9:-]+(?:=(?:"[^"]*"|'[^']*'|[^>\s]+))?)*\s*\/?>)/g;
  
  const parts = clean.split(tagRegex);
  const allowedTags = ['b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'a', 'code', 'pre', 'span', 'tg-spoiler', 'blockquote'];

  const processedParts = parts.map((part, index) => {
    // If it's a tag (odd indices in split when using capturing parenthesis)
    if (index % 2 === 1) {
      const isClosing = part.startsWith('</');
      // Extract tag name
      const tagNameMatch = part.match(/<\/?([a-zA-Z0-9:-]+)/);
      if (!tagNameMatch) return '';
      
      const tagName = tagNameMatch[1].toLowerCase();
      
      if (!allowedTags.includes(tagName)) {
        return ''; // strip unallowed tags
      }

      if (isClosing) {
        return `</${tagName}>`;
      }

      // Parse attributes for allowed tags (like href for a, language for code/pre)
      if (tagName === 'a') {
        const hrefMatch = part.match(/href=(?:"([^"]*)"|'([^']*)'|([^>\s]+))/i);
        const href = hrefMatch ? (hrefMatch[1] || hrefMatch[2] || hrefMatch[3]) : '';
        // Escape URL ampersands if any
        const escapedHref = href.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<a href="${escapedHref}">`;
      }

      if (tagName === 'code') {
        const classMatch = part.match(/class=(?:"([^"]*)"|'([^']*)'|([^>\s]+))/i);
        const className = classMatch ? (classMatch[1] || classMatch[2] || classMatch[3]) : '';
        if (className) {
          return `<code class="${className}">`;
        }
        return '<code>';
      }

      if (tagName === 'blockquote') {
        const expandable = part.toLowerCase().includes('expandable');
        return expandable ? '<blockquote expandable>' : '<blockquote>';
      }

      // Return simple tag
      return `<${tagName}>`;
    } else {
      // It's text, so escape HTML entities
      return part
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
  });

  let result = processedParts.join('');

  // Replace multiple sequential newlines with at most 2
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
}



class TelegramService {
  constructor() {
    this.bot = null;
    this.isBotRunning = false;
  }

  init() {
    try {
      db.log('Telegram', 'Initializing Telegram bot service...');
      const config = db.getConfig();
      const token = config.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN;
      
      if (!token) {
        db.log('Telegram', 'Bot token not provided. Bot services are suspended until token is configured.', 'warn');
        return false;
      }

      if (this.isBotRunning) {
        this.destroy();
      }

      this.bot = new Telegraf(token);
      this.setupHandlers();
      
      db.log('Telegram', 'Bot handlers configured. Launching polling...');
      // Start polling in background
      this.bot.launch()
        .then(() => {
          this.isBotRunning = true;
          db.log('Telegram', 'Bot started polling successfully');
        })
        .catch(err => {
          db.log('Telegram', `Failed to launch bot: ${err.message}`, 'error');
        });

      // Enable graceful stop
      process.once('SIGINT', () => this.destroy());
      process.once('SIGTERM', () => this.destroy());
      return true;
    } catch (error) {
      db.log('Telegram', `Error in init: ${error.message}`, 'error');
      return false;
    }
  }

  destroy() {
    if (this.bot && this.isBotRunning) {
      try {
        this.bot.stop('SIGTERM');
        this.isBotRunning = false;
        db.log('Telegram', 'Bot stopped polling');
      } catch (err) {
        db.log('Telegram', `Error stopping bot: ${err.message}`, 'error');
      }
    }
  }

  restart() {
    db.log('Telegram', 'Restarting Telegram bot services...');
    this.destroy();
    return this.init();
  }

  // Check if message sender is authenticated admin
  isAdmin(ctx) {
    const config = db.getConfig();
    const senderChatId = ctx.chat.id.toString();
    
    if (config.adminChatId && config.adminChatId === senderChatId) {
      return true;
    }
    
    return false;
  }

  setupHandlers() {
    // Help command
    this.bot.start((ctx) => {
      ctx.reply(
        '🤖 <b>Привет! Я бот-автогенератор экспертного контента.</b>\n\n' +
        'Чтобы управлять каналом, вам нужно авторизоваться. Отправьте команду:\n' +
        '<code>/auth [ваш_пароль]</code>\n\n' +
        '<i>Дефолтный пароль задан в настройках панели или .env файле.</i>',
        { parse_mode: 'HTML' }
      );
    });

    // Auth command
    this.bot.command('auth', (ctx) => {
      const config = db.getConfig();
      const messageText = ctx.message.text.trim();
      const parts = messageText.split(/\s+/);
      
      if (parts.length < 2) {
        return ctx.reply('⚠️ Пожалуйста, укажите пароль. Пример: <code>/auth admin</code>', { parse_mode: 'HTML' });
      }

      const passwordInput = parts[1];
      const correctPassword = config.adminPassword || process.env.ADMIN_PASSWORD || 'admin';

      if (passwordInput === correctPassword) {
        db.updateConfig({ adminChatId: ctx.chat.id.toString() });
        ctx.reply(
          '✅ <b>Авторизация успешна!</b>\n\n' +
          'Вы привязали этот чат в качестве администраторской панели.\n' +
          'Вам доступны следующие команды:\n' +
          '• /status — Текущее состояние системы\n' +
          '• /drafts — Список готовых черновиков\n' +
          '• /generate_next — Сгенерировать статью на следующую тему\n' +
          '• /view [id] — Посмотреть содержимое черновика\n' +
          '• /publish [id] — Опубликовать черновик в канал\n' +
          '• /help — Список команд',
          { parse_mode: 'HTML' }
        );
        db.log('Telegram', `User ${ctx.chat.username || ctx.chat.id} authenticated as Admin`);
      } else {
        ctx.reply('❌ Неверный пароль. Доступ заблокирован.');
        db.log('Telegram', `Failed authentication attempt by ${ctx.chat.username || ctx.chat.id}`, 'warn');
      }
    });

    // Help command
    this.bot.command('help', (ctx) => {
      if (!this.isAdmin(ctx)) return ctx.reply('🔒 Вы не авторизованы. Используйте /auth [пароль]');
      
      ctx.reply(
        '📋 <b>Доступные команды управления:</b>\n\n' +
        '• /status — Информация о подключении к Telegram и Gemini\n' +
        '• /drafts — Список черновиков в системе\n' +
        '• /generate_next — Генерация черновика на очередную неиспользованную тему\n' +
        '• /view [id] — Вывести текст черновика\n' +
        '• /publish [id] — Мгновенная публикация черновика в канал\n' +
        '• /auth [пароль] — Смена привязанного админ-аккаунта',
        { parse_mode: 'HTML' }
      );
    });

    // Status command
    this.bot.command('status', (ctx) => {
      if (!this.isAdmin(ctx)) return ctx.reply('🔒 Вы не авторизованы.');

      const config = db.getConfig();
      const posts = db.getPosts();
      const topics = db.getTopics();
      
      const draftsCount = posts.filter(p => p.status === 'draft').length;
      const scheduledCount = posts.filter(p => p.status === 'scheduled').length;
      const publishedCount = posts.filter(p => p.status === 'published').length;
      const totalTopics = topics.length;
      const usedTopics = topics.filter(t => t.used).length;

      ctx.reply(
        `📊 <b>Текущий статус автопилота:</b>\n\n` +
        `• <b>Канал для публикаций:</b> <code>${config.telegramChannelId || 'Не настроен'}</code>\n` +
        `• <b>Автопостинг:</b> <code>${config.autoPost ? 'ВКЛЮЧЕН' : 'ВЫКЛЮЧЕН'}</code>\n` +
        `• <b>Дни публикаций:</b> <code>${config.postingDays.map(d => ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'][d]).join(', ')} в ${config.postingTime}</code>\n\n` +
        `📈 <b>Статистика тем и постов:</b>\n` +
        `• Темы: ${usedTopics} / ${totalTopics} использовано\n` +
        `• Черновики в очереди: ${draftsCount}\n` +
        `• Запланировано публикаций: ${scheduledCount}\n` +
        `• Опубликовано статей: ${publishedCount}`,
        { parse_mode: 'HTML' }
      );
    });

    // Drafts command
    this.bot.command('drafts', (ctx) => {
      if (!this.isAdmin(ctx)) return ctx.reply('🔒 Вы не авторизованы.');

      const posts = db.getPosts().filter(p => p.status === 'draft' || p.status === 'scheduled');
      
      if (posts.length === 0) {
        return ctx.reply('📝 Нет активных черновиков или запланированных постов.');
      }

      let response = '📝 <b>Список активных постов:</b>\n\n';
      posts.forEach(p => {
        const timeInfo = p.status === 'scheduled' ? ` 📅 Scheduled: ${p.scheduledAt.split('T')[0]}` : '';
        response += `▫️ <b>[${p.status.toUpperCase()}]</b> ID: <code>${p.id}</code>\n` +
                    `📝 ${p.title}${timeInfo}\n` +
                    `🔍 Посмотреть: /view_${p.id}\n` +
                    `🚀 Опубликовать: /publish_${p.id}\n\n`;
      });

      ctx.reply(response, { parse_mode: 'HTML' });
    });

    // View handler (works both as /view ID or action links /view_ID)
    const handleView = async (ctx, postId) => {
      if (!this.isAdmin(ctx)) return ctx.reply('🔒 Вы не авторизованы.');

      const post = db.getPost(postId);
      if (!post) {
        return ctx.reply('❌ Пост с таким ID не найден.');
      }

      ctx.reply(
        `📄 <b>Черновик: ${post.title}</b>\n` +
        `ID: <code>${post.id}</code> | Статус: <b>${post.status.toUpperCase()}</b>\n` +
        `Created: ${post.createdAt.split('T')[0]}\n` +
        `-----------------------------------------\n\n` +
        post.content + '\n\n' +
        `-----------------------------------------\n` +
        `🚀 Чтобы опубликовать эту статью прямо сейчас, введите:\n` +
        `/publish_${post.id}`,
        { parse_mode: 'HTML' }
      );
    };

    this.bot.command('view', (ctx) => {
      const parts = ctx.message.text.split(/\s+/);
      if (parts.length < 2) return ctx.reply('⚠️ Укажите ID поста. Пример: /view post_12345');
      handleView(ctx, parts[1]);
    });

    // RegExp handler for shortcut commands like /view_post_12345
    this.bot.hears(/^\/view_(.+)$/, (ctx) => {
      handleView(ctx, ctx.match[1]);
    });

    // Publish handler (works both as /publish ID or action links /publish_ID)
    const handlePublish = async (ctx, postId) => {
      if (!this.isAdmin(ctx)) return ctx.reply('🔒 Вы не авторизованы.');

      ctx.reply('⏳ Публикую статью в канал...');
      try {
        const success = await this.publishPost(postId);
        if (success) {
          ctx.reply('🎉 Статья успешно опубликована в вашем канале!');
        } else {
          ctx.reply('❌ Ошибка при публикации. Проверьте логи в панели управления.');
        }
      } catch (err) {
        ctx.reply(`❌ Ошибка: ${err.message}`);
      }
    };

    this.bot.command('publish', (ctx) => {
      const parts = ctx.message.text.split(/\s+/);
      if (parts.length < 2) return ctx.reply('⚠️ Укажите ID поста. Пример: /publish post_12345');
      handlePublish(ctx, parts[1]);
    });

    this.bot.hears(/^\/publish_(.+)$/, (ctx) => {
      handlePublish(ctx, ctx.match[1]);
    });

    // Inline button query handler
    this.bot.action(/^publish:(.+)$/, async (ctx) => {
      const postId = ctx.match[1];
      
      // Check if user is admin
      if (!this.isAdmin(ctx)) {
        return ctx.answerCbQuery('🔒 Доступ ограничен.');
      }

      const post = db.getPost(postId);
      if (!post) {
        return ctx.answerCbQuery('❌ Статья не найдена.');
      }

      if (post.status === 'published') {
        return ctx.answerCbQuery('📢 Статья уже опубликована!');
      }

      await ctx.answerCbQuery('⏳ Публикую в канал...');
      
      const success = await this.publishPost(postId);
      if (success) {
        const timeNow = new Date().toLocaleTimeString('ru-RU');
        try {
          await ctx.editMessageText(
            ctx.callbackQuery.message.text + `\n\n✅ <b>Опубликовано в канал в ${timeNow}</b>`,
            { parse_mode: 'HTML' }
          );
        } catch (e) {
          ctx.reply(`✅ Статья «${post.title}» успешно опубликована.`);
        }
      } else {
        ctx.reply('❌ Ошибка при публикации.');
      }
    });

    // Topic Approval Actions
    this.bot.action(/^approve_topic:(.+)$/, async (ctx) => {
      const topicId = ctx.match[1];
      if (!this.isAdmin(ctx)) return ctx.answerCbQuery('🔒 Доступ ограничен.');

      const success = db.updateTopicStatus(topicId, 'approved');
      if (success) {
        await ctx.answerCbQuery('✅ Тема утверждена!');
        try {
          await ctx.editMessageText(
            ctx.callbackQuery.message.text + `\n\n✅ <b>Тема утверждена! Статья будет подготовлена по расписанию.</b>`,
            { parse_mode: 'HTML' }
          );
        } catch (e) {
          ctx.reply('✅ Тема утверждена.');
        }
      } else {
        ctx.answerCbQuery('❌ Тема не найдена.');
      }
    });

    this.bot.action(/^reject_topic:(.+)$/, async (ctx) => {
      const topicId = ctx.match[1];
      if (!this.isAdmin(ctx)) return ctx.answerCbQuery('🔒 Доступ ограничен.');

      const success = db.updateTopicStatus(topicId, 'rejected');
      if (success) {
        await ctx.answerCbQuery('❌ Тема отклонена.');
        try {
          await ctx.editMessageText(
            ctx.callbackQuery.message.text + `\n\n❌ <b>Тема отклонена.</b>`,
            { parse_mode: 'HTML' }
          );
        } catch (e) {
          ctx.reply('❌ Тема отклонена.');
        }
      } else {
        ctx.answerCbQuery('❌ Тема не найдена.');
      }
    });

    // Propose topics command (manual trigger)
    this.bot.command('propose_topics', async (ctx) => {
      if (!this.isAdmin(ctx)) return ctx.reply('🔒 Вы не авторизованы.');
      
      ctx.reply('⏳ Запрашиваю у Gemini 5 новых экспертных тем на утверждение...');
      
      try {
        const topics = db.getTopics();
        
        // Generate new topics
        const newTopics = await generateNewTopics(topics, 5);
        
        for (const t of newTopics) {
          const added = db.addTopic(t); // saved as pending status
          await this.sendTopicToAdmin(added);
        }
        
        ctx.reply('✅ 5 тем сгенерированы и отправлены на утверждение!');
      } catch (err) {
        ctx.reply(`❌ Ошибка генерации тем: ${err.message}`);
      }
    });

    // Generate Next topic draft command
    this.bot.command('generate_next', async (ctx) => {
      if (!this.isAdmin(ctx)) return ctx.reply('🔒 Вы не авторизованы.');

      ctx.reply('⏳ Запускаю генерацию следующей экспертной статьи через Gemini...');
      
      try {
        // Find next approved, unused topic
        const topics = db.getTopics();
        const nextTopic = topics.find(t => t.status === 'approved' && !t.used);
        
        if (!nextTopic) {
          return ctx.reply('🎯 Нет свободных утвержденных тем! Вы можете получить новые темы по команде /propose_topics.');
        }

        ctx.reply(`📝 Тема: «${nextTopic.title}»\nВыполняю консалтинговый анализ...`);
        
        const draft = await generateArticle(nextTopic);
        
        const newPost = db.savePost({
          id: 'post_' + Date.now(),
          topicId: nextTopic.id,
          title: draft.title,
          content: draft.content,
          status: 'draft'
        });

        // Send draft to admin with inline button immediately!
        await this.sendDraftToAdmin(newPost);
        ctx.reply(`✅ Статья сгенерирована и отправлена на утверждение с кнопкой публикации!`);
      } catch (err) {
        ctx.reply(`❌ Ошибка генерации: ${err.message}`);
      }
    });
  }

  /**
   * Sends a draft to the admin chat with an inline "Publish" button
   */
  async sendDraftToAdmin(post) {
    try {
      const config = db.getConfig();
      const adminChatId = config.adminChatId || process.env.ADMIN_CHAT_ID;
      
      if (!adminChatId) {
        db.log('Telegram', `Cannot send draft ${post.id} to admin: Admin chat ID is not registered.`, 'warn');
        return false;
      }

      if (!this.bot) {
        const token = config.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN;
        if (!token) return false;
        this.bot = new Telegraf(token);
      }

      let sanitizedContent = sanitizeHtmlForTelegram(post.content);
      
      let messageText = `📝 <b>Предложение статьи на утверждение:</b>\n\n` +
                          `<b>Тема:</b> ${post.title}\n` +
                          `<b>Раздел:</b> ${post.topicId}\n` +
                          `-----------------------------------------\n\n` +
                          sanitizedContent + `\n\n` +
                          `-----------------------------------------`;

      if (messageText.length > 4000) {
        const allowedLength = 4000 - (messageText.length - sanitizedContent.length);
        const plainText = sanitizedContent.replace(/<[^>]*>/g, '');
        const truncatedText = plainText.substring(0, allowedLength - 150) + 
                             '\n\n... [Статья сокращена для предпросмотра. Полный HTML-текст доступен в веб-панели]';
        
        messageText = `📝 <b>Предложение статьи на утверждение (Текст сокращен для предпросмотра):</b>\n\n` +
                          `<b>Тема:</b> ${post.title}\n` +
                          `<b>Раздел:</b> ${post.topicId}\n` +
                          `-----------------------------------------\n\n` +
                          truncatedText + `\n\n` +
                          `-----------------------------------------`;
      }

      await this.bot.telegram.sendMessage(adminChatId, messageText, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🚀 Опубликовать в канал', callback_data: `publish:${post.id}` }
            ]
          ]
        }
      });

      db.log('Telegram', `Draft "${post.title}" sent to admin for approval`);
      return true;
    } catch (error) {
      db.log('Telegram', `Failed to send draft to admin: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * Sends a topic proposal card to the admin chat with inline Approve/Reject buttons
   */
  async sendTopicToAdmin(topic) {
    try {
      const config = db.getConfig();
      const adminChatId = config.adminChatId || process.env.ADMIN_CHAT_ID;
      
      if (!adminChatId) {
        db.log('Telegram', `Cannot send topic ${topic.id} to admin: Admin chat ID is not registered.`, 'warn');
        return false;
      }

      if (!this.bot) {
        const token = config.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN;
        if (!token) return false;
        this.bot = new Telegraf(token);
      }

      const messageText = `🎯 <b>Предложение новой темы для канала:</b>\n\n` +
                          `<b>Раздел:</b> <code>${topic.block}</code>\n` +
                          `<b>Тема:</b> <u>${topic.title}</u>\n\n` +
                          `<b>О чем писать:</b> ${topic.description}`;

      await this.bot.telegram.sendMessage(adminChatId, messageText, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Утвердить тему', callback_data: `approve_topic:${topic.id}` },
              { text: '❌ Отклонить', callback_data: `reject_topic:${topic.id}` }
            ]
          ]
        }
      });

      db.log('Telegram', `Topic proposal "${topic.title}" sent to admin`);
      return true;
    } catch (error) {
      db.log('Telegram', `Failed to send topic to admin: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * Publishes a post by its ID to the target channel
   */
  async publishPost(postId) {
    try {
      const post = db.getPost(postId);
      if (!post) {
        db.log('Telegram', `Cannot publish: post ${postId} not found`, 'error');
        return false;
      }

      const config = db.getConfig();
      const channelId = config.telegramChannelId || process.env.TELEGRAM_CHANNEL_ID;
      
      if (!channelId) {
        db.log('Telegram', 'Cannot publish: Target Telegram Channel ID is not configured', 'error');
        return false;
      }

      if (!this.bot) {
        const token = config.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN;
        if (!token) {
          db.log('Telegram', 'Cannot publish: Bot token is missing', 'error');
          return false;
        }
        this.bot = new Telegraf(token);
      }

      const sanitizedContent = sanitizeHtmlForTelegram(post.content);
      db.log('Telegram', `Publishing article: "${post.title}" to channel: ${channelId}`);
      
      // We send the formatted content using HTML parse mode
      await this.bot.telegram.sendMessage(channelId, sanitizedContent, {
        parse_mode: 'HTML',
        disable_web_page_preview: false
      });

      // Update post status in database
      post.status = 'published';
      post.publishedAt = new Date().toISOString();
      db.savePost(post);
      
      db.log('Telegram', `Successfully published post: "${post.title}"`);
      
      // If we have an active admin chat, notify the admin
      if (config.adminChatId) {
        try {
          await this.bot.telegram.sendMessage(
            config.adminChatId, 
            `📢 <b>Пост опубликован в канал!</b>\n\n<b>Тема:</b> ${post.title}\n<b>ID:</b> <code>${post.id}</code>`,
            { parse_mode: 'HTML' }
          );
        } catch (e) {
          // Ignore notification error
        }
      }

      return true;
    } catch (error) {
      db.log('Telegram', `Failed to publish post ${postId}: ${error.message}`, 'error');
      return false;
    }
  }
}

const telegramService = new TelegramService();
export default telegramService;
