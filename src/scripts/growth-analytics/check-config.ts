/**
 * Says whether growth analytics (PostHog signup and activity events) is
 * switched on with this server's settings, naming any setting that is
 * missing or invalid. Never prints values. Always exits 0: it warns, it
 * doesn't block a deploy.
 *
 * On a server (compiled build):
 *   DOTENV_CONFIG_PATH=/path/to/.env MEMENTO_ENV=prod NODE_ENV=production \
 *     npm run growth:check-config:prod
 *
 * Pass --github to print GitHub Actions warning annotations.
 */
import 'dotenv/config';
import {
  growthAnalyticsProblems,
  growthAnalyticsWarnings,
  resolveAnalyticsEnvironment,
} from '../../services/growth-analytics/core';

export function growthConfigReport(
  env: NodeJS.ProcessEnv,
  github = false,
): string[] {
  const warn = (text: string) =>
    github ? `::warning::${text}` : `WARNING: ${text}`;
  const problems = growthAnalyticsProblems(env);
  if (problems.length)
    return problems.map(problem =>
      warn(`Growth analytics is off, signups are not tracked: ${problem}`),
    );
  return [
    `Growth analytics is on (environment "${resolveAnalyticsEnvironment(env)}")`,
    ...growthAnalyticsWarnings(env).map(warning =>
      warn(`Growth analytics: ${warning}`),
    ),
  ];
}

if (require.main === module) {
  for (const line of growthConfigReport(
    process.env,
    process.argv.includes('--github'),
  ))
    console.log(line);
}
