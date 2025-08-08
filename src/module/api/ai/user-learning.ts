import { createUserContent } from "@google/genai";
import gemini, { GEMINI_MODEL } from "../../../services/gemini";
import User from "../../database/model/user";
import { extractJson } from "../../../utils/helpers";

export async function extractAllUserInsights(user_id: string, userMessage: string, aiResponse: string): Promise<void> {
  const user = await User.findById(user_id)
  const existingContext = user?.context || {};
  const comprehensivePrompt = `Analyze this conversation exchange and extract comprehensive user insights. Return ONLY a valid JSON object:

{
Return ONLY a valid JSON object with NEW insights:

{
  "important_notes": ["Only NEW important notes not already covered"],
  "key_preferences": ["Only NEW preferences not already listed"],
  "emotional_state_trends": ["Only NEW emotional patterns"],
  "goals_and_aspirations": ["Only NEW goals not already mentioned"]
}

EXISTING CONTEXT:
Important Notes: ${existingContext.important_notes?.join(', ') || 'None'}
Key Preferences: ${existingContext.key_preferences?.join(', ') || 'None'}
Emotional Trends: ${existingContext.emotional_state_trends?.join(', ') || 'None'}
Goals: ${existingContext.goals_and_aspirations?.join(', ') || 'None'}

EXTRACTION GUIDELINES:
- important_notes: Focus on personality traits, life experiences, values, beliefs, relationships, goals, fears, achievements, or significant events
- key_preferences: Focus on likes, dislikes, hobbies, interests, work preferences, lifestyle choices, food preferences, entertainment choices, etc.
- emotional_state_trends: Focus on emotional patterns, mood indicators, stress levels, energy levels, emotional triggers
- goals_and_aspirations: Focus on future-oriented statements, dreams, plans, career goals, personal milestones

EXTRACTION RULES:
- Be specific and actionable - avoid generic statements
- Extract only meaningful insights that would help personalize future interactions
- If no meaningful insights are found for a category, return an empty array
- Focus on information that would help create a more personalized experience
- Combine related insights rather than creating multiple similar entries

Focus on information that would help create a more personalized and understanding relationship.`;

  try {
    const conversationText = `User: ${userMessage}\n\nAI: ${aiResponse}`;

    const contents = createUserContent([
      comprehensivePrompt,
      { text: conversationText }
    ]);

    const response = await gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents
    });

    const insights = extractJson(response.text);
    // Prepare update data
    const updateData: any = {};

    // Add all types of insights using $addToSet to avoid duplicates
    if (insights.important_notes && insights.important_notes.length > 0) {
      updateData['$addToSet'] = {
        'context.important_notes': { $each: insights.important_notes }
      };
    }

    if (insights.key_preferences && insights.key_preferences.length > 0) {
      if (!updateData['$addToSet']) updateData['$addToSet'] = {};
      updateData['$addToSet']['context.key_preferences'] = { $each: insights.key_preferences };
    }

    if (insights.emotional_state_trends && insights.emotional_state_trends.length > 0) {
      if (!updateData['$addToSet']) updateData['$addToSet'] = {};
      updateData['$addToSet']['context.emotional_state_trends'] = { $each: insights.emotional_state_trends };
    }

    if (insights.goals_and_aspirations && insights.goals_and_aspirations.length > 0) {
      if (!updateData['$addToSet']) updateData['$addToSet'] = {};
      updateData['$addToSet']['context.goals_and_aspirations'] = { $each: insights.goals_and_aspirations };
    }

    // Update user in database if we have insights
    if (Object.keys(updateData).length > 0) {
      await User.findByIdAndUpdate(user._id, updateData);
    }

  } catch (error) {
    console.error('Error extracting user insights:', error);
  }
}

