#!/bin/bash
# Deploy WishLyst backend to Google Cloud Run
# Prerequisites: gcloud CLI installed and authenticated
# Run: gcloud auth login && gcloud config set project YOUR_PROJECT_ID

set -e

# Configuration - UPDATE THESE
PROJECT_ID="${GCP_PROJECT_ID:-your-gcp-project-id}"
REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-wishlystit-backend}"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "Building and deploying ${SERVICE_NAME} to Cloud Run..."
echo "Project: ${PROJECT_ID}"
echo "Region: ${REGION}"

# Build the container image
gcloud builds submit --tag "${IMAGE_NAME}" --project "${PROJECT_ID}"

# Deploy to Cloud Run
# Set env vars via Cloud Console after first deploy, or add: --set-env-vars "KEY=value,..."
gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE_NAME}" \
  --platform managed \
  --region "${REGION}" \
  --allow-unauthenticated \
  --project "${PROJECT_ID}"

echo ""
echo "Deployment complete!"
echo "Set env vars in Cloud Console: Cloud Run > ${SERVICE_NAME} > Edit & Deploy > Variables & Secrets"
echo "Required: MONGO_URI, RESEND_API_KEY, GCP_CLIENT_EMAIL, GCP_PRIVATE_KEY, SPREADSHEET_ID"
