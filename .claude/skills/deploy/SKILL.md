---
name: deploy
description: How FarmHand changes reach the live site and the owner's phone. Use whenever merging to main, finishing a change the owner will test on their phone, or talking about deploying, dev, staging or promote. There is no dev site any more; main is what goes live.
---

# Deploying FarmHand

**There is no dev environment.** The dev site (dev.farmhandmanager.com, the
`~/FarmHand-dev` checkout, the `dev` branch flow and `deploy/promote.sh`) is
gone. Parts of `deploy/README.md`, `deploy/deploy.sh` and
`deploy/deploy.env.example` still describe it; they are out of date. Never
suggest dev, staging or promote.sh, and never ask whether to go through dev.

## How a change goes live

1. Work on a branch, check it (type check, the relevant `npm run verify:*`
   suites, and the running app where it matters), push the branch.
2. When the owner says so, merge it into `main` and push. Ask before
   merging to `main`: that is the live app's code.
3. The owner deploys on the VPS. This session cannot reach the server, so
   tell them to run:

   ```bash
   cd ~/FarmHand
   bash deploy/deploy.sh
   ```

   It pulls `main`, builds, and publishes to farmhandmanager.com. There is
   no service to restart.

4. A new file under `db/migrations/` is a separate step the owner runs
   against the database before deploying (see `deploy/selfhost/README.md`).
   Say so whenever a change adds one; say nothing about it otherwise.

After a deploy the phone gets the new version once the app is reopened.
