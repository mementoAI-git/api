/** Versioned, content-free API growth metrics. Importing this file performs no I/O. */
export interface GrowthInsight {
  key: string;
  name: string;
  description: string;
  query: {
    kind: 'DataTableNode';
    source: {kind: 'HogQLQuery'; query: string};
    full: true;
  };
}

export interface GrowthManifestOptions {
  /** Fixed ISO timestamp for reproducible review; omit for now(). */
  asOf?: string;
}

export const GROWTH_MANIFEST_VERSION = 1;

export function buildGrowthManifest(options: GrowthManifestOptions = {}): {
  version: number;
  name: string;
  description: string;
  insights: GrowthInsight[];
} {
  if (
    options.asOf &&
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(options.asOf)
  ) {
    throw new Error('asOf must be a UTC ISO timestamp');
  }
  const clock = options.asOf ? `toDateTime('${options.asOf}')` : 'now()';
  // Do not apply dashboard date filters: truncating event history changes first occurrence.
  const base = `WITH
  source AS (
    SELECT distinct_id AS user_id, event, timestamp, properties
    FROM events
    WHERE properties.analytics_source = 'api'
      AND properties.analytics_schema_version = 1
      AND properties.environment = 'production'
      AND coalesce(properties.is_test, false) = false
      AND timestamp <= ${clock}
      AND event IN ('growth_account_created', 'growth_invitation_sent',
        'growth_invitation_converted', 'growth_memory_captured',
        'growth_reflection_added', 'growth_conversation_meaningful',
        'growth_connection_activated', 'growth_connection_engaged', 'growth_user_active')
  ),
  accounts AS (
    SELECT user_id, min(timestamp) AS signup_at,
      argMin(properties.acquisition_source, timestamp) AS acquisition_source,
      argMin(properties.inviter_id, timestamp) AS inviter_id
    FROM source WHERE event = 'growth_account_created' GROUP BY user_id
  ),
  users AS (
    SELECT *, if(acquisition_source IN ('invitation', 'referral'), 'invited', 'organic') AS cohort
    FROM accounts
  )`;
  const make = (
    key: string,
    name: string,
    description: string,
    tail: string,
  ): GrowthInsight => ({
    key,
    name,
    description,
    query: {
      kind: 'DataTableNode',
      source: {kind: 'HogQLQuery', query: `${base}${tail}`},
      full: true,
    },
  });
  const retention = `,
  retained AS (
    SELECT u.user_id, max(1) AS retained
    FROM users u INNER JOIN source s ON s.user_id = u.user_id
    WHERE s.event = 'growth_user_active'
      AND s.timestamp >= u.signup_at + INTERVAL 28 DAY
      AND s.timestamp < u.signup_at + INTERVAL 35 DAY
    GROUP BY u.user_id
  )`;
  return {
    version: GROWTH_MANIFEST_VERSION,
    name: 'Memento — authoritative growth analytics v1',
    description:
      'Production API events only. Observed signup cohorts; no historical backfill. Empty or immature denominators produce null rates. Retention lift is association, not causation.',
    insights: [
      make(
        'activation_7d',
        'First memory activation within 7 days',
        'Invited (invitation/referral) vs organic. First persisted memory or reflection after signup; accounts must be at least 7 days old.',
        `,
  first_memory AS (
    SELECT u.user_id, min(s.timestamp) AS first_at, max(1) AS observed
    FROM users u INNER JOIN source s ON s.user_id = u.user_id
    WHERE s.event IN ('growth_memory_captured', 'growth_reflection_added')
      AND s.timestamp >= u.signup_at GROUP BY u.user_id
  )
SELECT u.cohort, count() AS eligible_users,
  countIf(m.observed = 1 AND m.first_at < u.signup_at + INTERVAL 7 DAY) AS activated_users,
  100.0 * countIf(m.observed = 1 AND m.first_at < u.signup_at + INTERVAL 7 DAY) / nullIf(count(), 0) AS activation_pct
FROM users u LEFT JOIN first_memory m ON m.user_id = u.user_id
WHERE u.signup_at <= ${clock} - INTERVAL 7 DAY
GROUP BY u.cohort ORDER BY u.cohort`,
      ),
      make(
        'retention_d30',
        'D30 retention by acquisition cohort',
        'Activity at age >=28 and <35 days, with at least 35 days of observation. API user_active includes qualifying persisted activity.',
        `${retention}
SELECT u.cohort, count() AS eligible_users,
  countIf(r.retained = 1) AS retained_users,
  100.0 * countIf(r.retained = 1) / nullIf(count(), 0) AS retention_pct
FROM users u LEFT JOIN retained r ON r.user_id = u.user_id
WHERE u.signup_at <= ${clock} - INTERVAL 35 DAY
GROUP BY u.cohort ORDER BY u.cohort`,
      ),
      make(
        'invitation_conversion_30d',
        'Unique recipient invitation conversion within 30 days',
        'Addressed email invitations only; public referral-link recipients are unobserved. One recipient key across all senders and resends; any actual matching delivered invitation may convert that recipient. Only first invitations at least 30 days old, excluding existing users. Conversion requires a matching new account and actual invitation conversion.',
        `,
  invites AS (
    SELECT properties.invitee_key AS invitee_key, min(timestamp) AS sent_at
    FROM source WHERE event = 'growth_invitation_sent'
      AND properties.existing_user = false
      AND properties.invitee_key IS NOT NULL
    GROUP BY properties.invitee_key
  ),
  converted AS (
    SELECT i.invitee_key, max(1) AS converted
    FROM invites i INNER JOIN source c ON c.properties.invitee_key = i.invitee_key
    INNER JOIN users u ON u.user_id = c.user_id
    INNER JOIN source receipt ON receipt.properties.invitee_key = i.invitee_key
    WHERE c.event = 'growth_invitation_converted' AND c.properties.existing_user = false
      AND receipt.event = 'growth_invitation_sent' AND receipt.properties.existing_user = false
      AND receipt.user_id = c.properties.inviter_id
      AND receipt.properties.invitation_id = c.properties.invitation_id
      AND receipt.timestamp <= u.signup_at AND receipt.timestamp <= c.timestamp
      AND u.acquisition_source IN ('invitation', 'referral')
      AND c.timestamp >= i.sent_at AND c.timestamp < i.sent_at + INTERVAL 30 DAY
      AND u.signup_at >= i.sent_at AND u.signup_at < i.sent_at + INTERVAL 30 DAY
    GROUP BY i.invitee_key
  )
SELECT count() AS eligible_recipients, countIf(c.converted = 1) AS converted_recipients,
  100.0 * countIf(c.converted = 1) / nullIf(count(), 0) AS conversion_pct
FROM invites i LEFT JOIN converted c ON c.invitee_key = i.invitee_key
WHERE i.sent_at <= ${clock} - INTERVAL 30 DAY`,
      ),
      make(
        'k_factor_30d',
        '30-day cohort K-factor',
        'Attributed new signups in each parent’s first 30 days / observed parent accounts at least 30 days old. Includes validated referral attribution; never guesses historical parent signup dates.',
        `,
  children AS (
    SELECT p.user_id, count() AS signups
    FROM users p INNER JOIN users c ON c.inviter_id = p.user_id
    WHERE c.user_id != p.user_id AND c.acquisition_source IN ('invitation', 'referral')
      AND c.signup_at >= p.signup_at AND c.signup_at < p.signup_at + INTERVAL 30 DAY
    GROUP BY p.user_id
  )
SELECT count() AS eligible_parents, sum(coalesce(c.signups, 0)) AS attributed_signups,
  sum(coalesce(c.signups, 0)) * 1.0 / nullIf(count(), 0) AS k_factor
FROM users p LEFT JOIN children c ON c.user_id = p.user_id
WHERE p.signup_at <= ${clock} - INTERVAL 30 DAY`,
      ),
      make(
        'invitee_to_inviter_30d',
        'Invitee-to-inviter rate within 30 days',
        'Invited new accounts with a delivered direct invitation OR a validated attributed new referral signup within their first 30 days / invited accounts at least 30 days old.',
        `,
  inviters AS (
    SELECT u.user_id, max(1) AS invited
    FROM users u INNER JOIN source s ON s.user_id = u.user_id
    WHERE s.event = 'growth_invitation_sent' AND s.properties.existing_user = false
      AND s.properties.invitee_key IS NOT NULL
      AND s.timestamp >= u.signup_at AND s.timestamp < u.signup_at + INTERVAL 30 DAY
    GROUP BY u.user_id
  ),
  referrers AS (
    SELECT p.user_id, max(1) AS referred
    FROM users p INNER JOIN users c ON c.inviter_id = p.user_id
    WHERE c.user_id != p.user_id AND c.acquisition_source = 'referral'
      AND c.signup_at >= p.signup_at AND c.signup_at < p.signup_at + INTERVAL 30 DAY
    GROUP BY p.user_id
  )
SELECT count() AS eligible_invited_users, countIf(i.invited = 1 OR r.referred = 1) AS became_inviters,
  100.0 * countIf(i.invited = 1 OR r.referred = 1) / nullIf(count(), 0) AS invitee_to_inviter_pct
FROM users u LEFT JOIN inviters i ON i.user_id = u.user_id
LEFT JOIN referrers r ON r.user_id = u.user_id
WHERE u.cohort = 'invited' AND u.signup_at <= ${clock} - INTERVAL 30 DAY`,
      ),
      make(
        'connection_retention_lift',
        'D30 retention: early shared connection association',
        'Connected means the same connection was accepted and had shared engagement after signup and before day 7. Cohort frozen at day 7; D30 requires 35 days. Difference in percentage points and relative lift are association, not causation.',
        `${retention},
  accepted_connections AS (
    SELECT u.user_id, u.signup_at, s.properties.connection_id AS connection_id,
      min(s.timestamp) AS accepted_at
    FROM users u INNER JOIN source s ON s.user_id = u.user_id
    WHERE s.event = 'growth_connection_activated'
      AND s.timestamp >= u.signup_at AND s.timestamp < u.signup_at + INTERVAL 7 DAY
    GROUP BY u.user_id, u.signup_at, s.properties.connection_id
  ),
  connected AS (
    SELECT a.user_id, max(1) AS connected
    FROM accepted_connections a INNER JOIN source s ON s.user_id = a.user_id
    WHERE s.event = 'growth_connection_engaged'
      AND s.properties.connection_id = a.connection_id
      AND s.timestamp >= a.accepted_at AND s.timestamp < a.signup_at + INTERVAL 7 DAY
    GROUP BY a.user_id
  ),
  counts AS (
    SELECT countIf(c.connected = 1) AS connected_users,
      countIf(c.connected = 1 AND r.retained = 1) AS connected_retained,
      countIf(coalesce(c.connected, 0) = 0) AS unconnected_users,
      countIf(coalesce(c.connected, 0) = 0 AND r.retained = 1) AS unconnected_retained
    FROM users u LEFT JOIN connected c ON c.user_id = u.user_id
    LEFT JOIN retained r ON r.user_id = u.user_id
    WHERE u.signup_at <= ${clock} - INTERVAL 35 DAY
  ),
  rates AS (
    SELECT *, connected_retained * 1.0 / nullIf(connected_users, 0) AS connected_rate,
      unconnected_retained * 1.0 / nullIf(unconnected_users, 0) AS unconnected_rate
    FROM counts
  )
SELECT connected_users, connected_retained, unconnected_users, unconnected_retained,
  100.0 * connected_rate AS connected_retention_pct,
  100.0 * unconnected_rate AS unconnected_retention_pct,
  100.0 * (connected_rate - unconnected_rate) AS difference_percentage_points,
  (connected_rate / nullIf(unconnected_rate, 0)) - 1 AS relative_lift
FROM rates`,
      ),
    ],
  };
}

export const growthDashboardManifest = buildGrowthManifest();

if (require.main === module) {
  process.stdout.write(`${JSON.stringify(growthDashboardManifest, null, 2)}\n`);
}
