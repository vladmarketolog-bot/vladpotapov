import 'dotenv/config';
import db from '../services/database.js';
import { generateArticle } from '../services/gemini.js';
import telegramService from '../services/telegram.js';

async function run() {
  console.log('🤖 Starting daily draft generation CLI script...');
  db.log('CLI-Drafting', 'Running daily approved topic drafting...');

  try {
    const topics = db.getTopics();
    const unusedApproved = topics.filter(t => t.status === 'approved' && !t.used);

    if (unusedApproved.length === 0) {
      db.log('CLI-Drafting', 'No unused approved topics remaining in database.', 'warn');
      console.log('⚠️ No unused approved topics to draft. Please approve some topics in database.json!');
      process.exit(0);
    }

    const countToDraft = Math.min(2, unusedApproved.length);
    console.log(`Found ${unusedApproved.length} approved unused topics. Drafting ${countToDraft} article(s)...`);

    for (let i = 0; i < countToDraft; i++) {
      const topicToUse = unusedApproved[i];
      console.log(`[${i+1}/${countToDraft}] Generating draft for: "${topicToUse.title}"...`);

      const draft = await generateArticle(topicToUse);
      
      const newPost = {
        id: 'post_' + (Date.now() + i),
        topicId: topicToUse.id,
        title: draft.title,
        content: draft.content,
        status: 'draft',
        scheduledAt: null,
        publishedAt: null
      };

      db.savePost(newPost); // automatically marks the topic as used!
      
      console.log(`Sending draft "${newPost.title}" to admin chat...`);
      await telegramService.sendDraftToAdmin(newPost);
    }

    db.log('CLI-Drafting', `Successfully auto-drafted and notified admin of ${countToDraft} draft(s)`);
    console.log('🎉 Done!');
    process.exit(0);
  } catch (error) {
    db.log('CLI-Drafting', `Drafting script failed: ${error.message}`, 'error');
    console.error('❌ Error executing script:', error);
    process.exit(1);
  }
}

run();
