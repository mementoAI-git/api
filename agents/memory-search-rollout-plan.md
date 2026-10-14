# Description search test-server rollout

Authorized scope: finish and activate app-only description search on the existing development/test backend, initially restricted to the selected test owner and stories/chats. No production rollout or indexing of computer folders is authorized.

1. Isolate search changes from the unrelated People work on the current development baseline; regenerate API contracts in the isolated checkout.
2. Build a Linux helper from the already reviewed DigUp source commit ca6e877be139997ef259e1a5f84881394c46332c, with its pinned llama.cpp and model files. Package the runtime dependencies and license notices. Only the embedding worker command is used.
3. Verify runtime metadata, nonzero vectors, query latency and app retrieval against fictional fixtures in a Linux environment. Do not activate a runtime that fails these checks.
4. Run repository lint, tests and production build gates before pushing the isolated change.
5. Install the verified helper/models on the test server, configure matching API and worker settings and the test-owner allowlist, with photos disabled initially. Deploy through the repository's existing immutable-release process and verify readiness.
6. Check authenticated semantic retrieval in the port-5173 app against saved app content, plus edits/deletions and account privacy. Restore the previous release/disable the feature if activation fails.

Access path: use the existing DEPLOY_SSH_* GitHub Actions secrets and strict known-host verification. Local SSH keys are not required. The preparation workflow checks access and server compatibility without changing the app. Network access to GitHub/Docker is intermittent. No deployment has been performed in this phase.
