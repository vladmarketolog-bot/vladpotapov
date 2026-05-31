import cronPkg from 'node-cron';
import db from './database.js';
import telegramService from './telegram.js';
import { generateArticle } from './gemini.js';

class SchedulerService {
  constructor() {
    this.jobs = [];
  }

  init() {
    try {
      db.log('Scheduler', 'Initializing scheduler service...');

      // 1. Minute job: Check for scheduled posts that need publishing (manually scheduled via web panel)
      const publishJob = cronPkg.schedule('* * * * *', async () => {
        await this.checkAndPublishScheduled();
      });
      this.jobs.push(publishJob);

      // 2. Daily job: Perform auto-drafting of 2 articles at 12:00 local time
      const autoScheduleJob = cronPkg.schedule('0 12 * * *', async () => {
        await this.runDailyAutoDrafting();
      });
      this.jobs.push(autoScheduleJob);

      // 3. Daily job: Propose 5 new expert topics to admin at 09:00 AM local time
      const autoTopicJob = cronPkg.schedule('0 9 * * *', async () => {
        await this.runDailyTopicProposal();
      });
      this.jobs.push(autoTopicJob);

      db.log('Scheduler', 'Scheduler service started (1-min queue check, daily 09:00 topic proposals, daily 12:00 drafts)');
    } catch (error) {
      db.log('Scheduler', `Failed to start scheduler: ${error.message}`, 'error');
    }
  }

  /**
   * Publishes any post scheduled for now or in the past (manually scheduled via web panel)
   */
  async checkAndPublishScheduled() {
    const posts = db.getPosts();
    const now = new Date();

    const duePosts = posts.filter(post => {
      if (post.status !== 'scheduled' || !post.scheduledAt) return false;
      const scheduleTime = new Date(post.scheduledAt);
      return scheduleTime <= now;
    });

    if (duePosts.length > 0) {
      db.log('Scheduler', `Found ${duePosts.length} post(s) due for publishing`);
      for (const post of duePosts) {
        try {
          await telegramService.publishPost(post.id);
        } catch (err) {
          db.log('Scheduler', `Error publishing scheduled post ${post.id}: ${err.message}`, 'error');
        }
      }
    }
  }

  /**
   * Daily job that drafts 2 articles and sends them to admin for approval at 12:00 PM
   */
  async runDailyAutoDrafting() {
    db.log('Scheduler', 'Starting daily 12:00 auto-drafting pass (generating 2 articles)...');
    
    const config = db.getConfig();
    // Check if admin chat ID is registered
    if (!config.adminChatId) {
      db.log('Scheduler', 'Skipping daily drafting: No admin chat ID registered. Please authenticate via Telegram bot first.', 'warn');
      return;
    }

    const topics = db.getTopics();
    // Filter to ONLY use topics that are approved and not yet used
    const unusedTopics = topics.filter(t => t.status === 'approved' && !t.used);

    if (unusedTopics.length === 0) {
      db.log('Scheduler', 'Skipping daily drafting: No unused approved topics remaining in content-plan.', 'warn');
      return;
    }

    // Determine how many topics to draft (max 2)
    const countToDraft = Math.min(2, unusedTopics.length);
    db.log('Scheduler', `Found ${unusedTopics.length} approved unused topics. Drafting ${countToDraft} article(s)...`);

    for (let i = 0; i < countToDraft; i++) {
      const topicToUse = unusedTopics[i];
      db.log('Scheduler', `Generating draft [${i+1}/${countToDraft}] for topic: "${topicToUse.title}"...`);

      try {
        // Generate via Gemini
        const draft = await generateArticle(topicToUse);
        
        // Save as draft in database
        const newPost = {
          id: 'post_' + (Date.now() + i), // avoid duplicate timestamp IDs
          topicId: topicToUse.id,
          title: draft.title,
          content: draft.content,
          status: 'draft',
          scheduledAt: null,
          publishedAt: null
        };
        
        db.savePost(newPost);
        
        // Send to admin chat for approval with inline buttons!
        await telegramService.sendDraftToAdmin(newPost);
        db.log('Scheduler', `Successfully auto-drafted and sent to admin: "${draft.title}"`);
      } catch (error) {
        db.log('Scheduler', `Failed to auto-draft topic ${topicToUse.id}: ${error.message}`, 'error');
      }
    }
  }

  /**
   * Daily job that generates 5 new topics and sends them to admin for approval at 09:00 AM
   */
  async runDailyTopicProposal() {
    db.log('Scheduler', 'Starting daily 09:00 AM topic proposal pass...');
    
    const config = db.getConfig();
    if (!config.adminChatId) {
      db.log('Scheduler', 'Skipping daily topic proposal: No admin chat ID registered. Run /auth in Telegram first.', 'warn');
      return;
    }

    try {
      const { generateNewTopics } = await import('./gemini.js');
      const topics = db.getTopics();
      
      db.log('Scheduler', 'Querying Gemini for 5 new trending topics...');
      const newTopics = await generateNewTopics(topics, 5);
      
      for (const t of newTopics) {
        const added = db.addTopic(t); // saved as pending status
        await telegramService.sendTopicToAdmin(added);
      }
      
      db.log('Scheduler', 'Successfully proposed 5 new topics to admin');
    } catch (error) {
      db.log('Scheduler', `Failed to run daily topic proposal: ${error.message}`, 'error');
    }
  }

  /**
   * Calculates the next time slot based on postingDays and postingTime
   * (Retained as auxiliary utility helper)
   */
  calculateNextAvailableSlot(startDate, existingPosts) {
    const config = db.getConfig();
    const days = config.postingDays; // Array of numbers e.g. [1, 3, 5]
    const [hours, minutes] = config.postingTime.split(':').map(Number);

    if (!days || days.length === 0) {
      return null;
    }

    let checkDate = new Date(startDate);
    checkDate.setHours(hours, minutes, 0, 0);
    
    const scheduledTimes = existingPosts
      .filter(p => p.status === 'scheduled' && p.scheduledAt)
      .map(p => new Date(p.scheduledAt).getTime());

    for (let i = 0; i < 30; i++) {
      if (i === 0 && checkDate <= startDate) {
        checkDate.setDate(checkDate.getDate() + 1);
        continue;
      }

      const dayOfWeek = checkDate.getDay();
      if (days.includes(dayOfWeek)) {
        const slotTime = checkDate.getTime();
        const hourDiff = 60 * 60 * 1000;
        
        const isConflict = scheduledTimes.some(t => Math.abs(t - slotTime) < hourDiff);
        if (!isConflict) {
          return new Date(checkDate);
        }
      }
      checkDate.setDate(checkDate.getDate() + 1);
    }
    return null;
  }
}

const schedulerService = new SchedulerService();
export default schedulerService;
