/** Reflection answers remain conversation threads, and also belong in Stories. */
export function storyScope() {
  return {
    $or: [
      {type: 'story'},
      {type: 'conversation', prompt_type: {$in: ['static', 'ai-generated']}},
    ],
  };
}
