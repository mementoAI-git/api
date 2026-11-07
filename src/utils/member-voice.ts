/**
 * Text shown to a member must speak to them. "users" stays allowed, since a
 * member can talk about the people who use something they made.
 */
const THIRD_PERSON =
  /\bthe (user|host|member)\b|\buser's\b|^\s*(user|host|member)\b/i;

export function speaksToMember(text: string): boolean {
  return !THIRD_PERSON.test(text);
}
