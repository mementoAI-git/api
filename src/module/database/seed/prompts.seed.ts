import fs from 'fs';
import path from 'path';
import { connectMongodb } from '../connection';
import Prompt from '../model/prompt';

async function seedPrompts() {
  await connectMongodb();

  const filePath = path.join(__dirname, '../data/prompts.json');
  const promptsRaw = fs.readFileSync(filePath, 'utf-8');
  const prompts = JSON.parse(promptsRaw);

  // Remove all existing prompts (optional, comment out if not desired)
  // await Prompt.deleteMany({});

  // Insert new prompts
  await Prompt.insertMany(prompts);

  console.log('Prompts seeded successfully!');
  process.exit(0);
}

seedPrompts().catch((err) => {
  console.error('Error seeding prompts:', err);
  process.exit(1);
}); 