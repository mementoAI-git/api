Password recovery integration tests use an isolated Redis, never the application database.

```sh
docker run --rm -d --name memento-auth-recovery-test -p 127.0.0.1:16389:6379 redis:7-alpine
npm run test:auth:redis
docker stop memento-auth-recovery-test
```

Tests flush DB 1 on that test instance. Do not point these tests at shared Redis.

Deploy the API routes `/auth/recovery/send-code` and `/auth/recovery/verify-code` and the new mail template before releasing the web UI. Existing UUID reset links remain supported through `/auth/set-password`.
