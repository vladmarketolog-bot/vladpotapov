import 'dotenv/config';
import db from '../services/database.js';
import { generateNewTopics } from '../services/gemini.js';
import telegramService from '../services/telegram.js';

async function run() {
  console.log('🤖 Starting topic proposal CLI script...');
  db.log('CLI-Propose', 'Running daily topic proposal...');

  try {
    const topics = db.getTopics();
    console.log('Fetching new trending topics from Gemini...');
    
    // Propose 5 new topics
    const newTopics = await generateNewTopics(topics, 5);
    console.log(`Successfully generated ${newTopics.length} new topics via Gemini.`);

    for (const t of newTopics) {
      const added = db.addTopic(t); // saves as 'pending'
      console.log(`Saving topic: "${added.title}"`);
      
      console.log('Sending topic card to admin chat in Telegram...');
      await telegramService.sendTopicToAdmin(added);
    }
    
    db.log('CLI-Propose', 'Successfully generated and proposed 5 topics to admin');
    console.log('🎉 Done!');
    process.exit(0);
  } catch (error) {
    db.log('CLI-Propose', `Topic proposal script failed: ${error.message}`, 'error');
    console.error('❌ Error executing script:', error);
    process.exit(1);
  }
}

run();
