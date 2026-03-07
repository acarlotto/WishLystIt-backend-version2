# Deploy WishLyst Backend to Google Cloud Run

## Prerequisites

1. **Google Cloud CLI** – [Install gcloud](https://cloud.google.com/sdk/docs/install)
2. **Enable APIs** – Run Cloud Build and Cloud Run:
   ```bash
   gcloud services enable run.googleapis.com cloudbuild.googleapis.com
   ```
3. **Authenticate**:
   ```bash
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   ```

## Required Environment Variables

Configure these in Cloud Run (Cloud Console → Cloud Run → your service → Edit & Deploy → Variables & Secrets):

| Variable | Description |
|----------|-------------|
| `MONGO_URI` | MongoDB connection string |
| `RESEND_API_KEY` | Resend email API key |
| `GCP_CLIENT_EMAIL` | Google Service Account client email (for Sheets API) |
| `GCP_PRIVATE_KEY` | Google Service Account private key (use Secret Manager for sensitive data) |
| `SPREADSHEET_ID` | Google Sheets spreadsheet ID |

> **Note:** Cloud Run sets `PORT` automatically (8080). Do not override it.

## Deployment Options

### Option 1: One-command deploy (recommended)

```bash
export GCP_PROJECT_ID=your-project-id
export GCP_REGION=us-central1   # or your preferred region
./deploy.sh
```

### Option 2: Manual steps

```bash
# Set your project
export PROJECT_ID=your-project-id
export REGION=us-central1
export SERVICE_NAME=wishlystit-backend

# Build the container
gcloud builds submit --tag gcr.io/${PROJECT_ID}/${SERVICE_NAME}

# Deploy (replace PLACEHOLDERs with real values or set via Cloud Console after)
gcloud run deploy ${SERVICE_NAME} \
  --image gcr.io/${PROJECT_ID}/${SERVICE_NAME} \
  --platform managed \
  --region ${REGION} \
  --allow-unauthenticated \
  --set-env-vars "MONGO_URI=your-mongo-uri,RESEND_API_KEY=your-key,GCP_CLIENT_EMAIL=your-email,SPREADSHEET_ID=your-id" \
  --project ${PROJECT_ID}
```

### Option 3: Use Secret Manager for sensitive values

For `GCP_PRIVATE_KEY` and other secrets:

1. Create secrets in Secret Manager
2. Deploy with:
   ```bash
   gcloud run deploy wishlystit-backend \
     --image gcr.io/PROJECT_ID/wishlystit-backend \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated \
     --set-env-vars "MONGO_URI=...,RESEND_API_KEY=...,GCP_CLIENT_EMAIL=...,SPREADSHEET_ID=..." \
     --set-secrets "GCP_PRIVATE_KEY=GCP_PRIVATE_KEY:latest"
   ```

## After Deployment

1. **Set environment variables** in the Cloud Run console if you used placeholders
2. **Verify** the service URL (shown after deploy or in the console)
3. **Test** with: `curl https://your-service-url.run.app/`
