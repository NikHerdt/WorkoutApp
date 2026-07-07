# Cloud backup (Google Cloud Storage) setup

The app can back up its entire database (workouts, history, programs, settings,
body weight log) to a GCS bucket after every finished workout, and restore from
it on demand — e.g. after reinstalling or moving to a new phone.

Credentials can be baked into the build (`src/config/cloudSync.local.ts`,
gitignored) or entered in-app (Home → Settings → Cloud backup) — either way
nothing sensitive lives in the repo itself.

## 1. Create the bucket and service account

**Via the GCP web console:**

1. **IAM & Admin → Service Accounts → + Create Service Account.** Name it
   e.g. `workout-app-backup`. Skip granting project-level roles — click
   Continue, then Done.
2. **Cloud Storage → Buckets →** your bucket **→ Permissions tab →**
   **+ Grant access.** Paste the service account's email as the principal
   and assign the **Storage Object Admin** role. This scopes it to this
   bucket only, not the whole project.
3. Back in **Service Accounts**, open the account **→ Keys tab →**
   **Add Key → Create new key → JSON.** A key file downloads — this is
   what goes into the app.

**Or via the gcloud CLI** (replace `MY_PROJECT` and bucket name):

```bash
gcloud config set project MY_PROJECT

# Bucket (pick a region near you) — skip if it already exists
gcloud storage buckets create gs://my-workout-backups \
  --location=us-central1 --uniform-bucket-level-access

# Service account used only by the app
gcloud iam service-accounts create workout-app-backup \
  --display-name="Workout app backup"

# Grant it access to THIS BUCKET ONLY (not the whole project)
gcloud storage buckets add-iam-policy-binding gs://my-workout-backups \
  --member="serviceAccount:workout-app-backup@MY_PROJECT.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"

# Download a JSON key for it
gcloud iam service-accounts keys create workout-backup-key.json \
  --iam-account="workout-app-backup@MY_PROJECT.iam.gserviceaccount.com"
```

Optional but recommended — keep old backups tidy with a lifecycle rule
(e.g. delete history objects older than 180 days):

```bash
cat > lifecycle.json <<'EOF'
{"rule": [{"action": {"type": "Delete"},
           "condition": {"age": 180, "matchesPrefix": ["backups/history/"]}}]}
EOF
gcloud storage buckets update gs://my-workout-backups --lifecycle-file=lifecycle.json
```

## 2. Configure the app

**Option A — baked into the build (recommended for personal use):**

1. Create `src/config/cloudSync.local.ts` (gitignored — never commit it):

   ```ts
   export const CLOUD_SYNC_CONFIG = {
     bucket: 'my-workout-backups', // no gs:// prefix
     serviceAccountJson: `
   { ...paste the full downloaded JSON key here... }
   `,
   };
   ```

   **Important:** this is a JS template literal, not a raw text file — `\n`
   escape sequences get converted to real newlines *while the source is
   parsed*, before `JSON.parse` ever runs on the string. The downloaded key's
   `private_key` field contains many `\n` line breaks, so after pasting it
   in, find-and-replace every `\n` inside the pasted JSON with `\\n`
   (double the backslash). Otherwise the string that reaches `JSON.parse` at
   runtime contains literal newlines instead of the two-character escape
   sequence, which is invalid JSON and fails silently with "cloud sync is
   not configured".

2. Rebuild/reload the app. The Cloud backup row on the Home screen should show
   your bucket with "(built into app)".

**Option B — in-app:**

1. Open the app → **Home → Settings → Cloud backup (GCS) → Configure**.
2. Enter the bucket name and paste the JSON key, then Save.

In-app config always overrides the baked-in file. Either way, tap
**Back up now** to verify it works, and delete `workout-backup-key.json`
from your computer afterwards.

## How it works

- After every finished workout the app uploads:
  - `backups/latest.json` — always the newest full backup (what Restore uses)
  - `backups/history/<timestamp>.json` — an immutable copy per backup
- If the upload fails (offline at the gym), it's marked pending and retried on
  the next app launch and after the next finished workout.
- **Restore…** downloads `backups/latest.json` and **replaces all local data**.
  To roll back to an older snapshot, copy it over latest first:
  `gcloud storage cp gs://my-workout-backups/backups/history/<ts>.json gs://my-workout-backups/backups/latest.json`

## Security notes

- The service account key is stored in the app's private SQLite database on the
  device, and nowhere else. Anyone with the key can read/write the backup
  bucket, which is why the account is scoped to that single bucket.
- If the key leaks, revoke it:
  `gcloud iam service-accounts keys list --iam-account=workout-app-backup@MY_PROJECT.iam.gserviceaccount.com`
  then `gcloud iam service-accounts keys delete <KEY_ID> --iam-account=...`,
  create a new key, and paste it into the app again.
