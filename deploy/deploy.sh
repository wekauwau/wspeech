#!/bin/bash
# GCP Deployment Script for TTS Platform
# Usage: ./deploy.sh <project-id> <region>

set -e

PROJECT_ID=${1:?"Usage: $0 <project-id> <region>"}
REGION=${2:?"Usage: $0 <project-id> <region>"}
INSTANCE_NAME="tts-db"
CONNECTOR_NAME="tts-vpc-connector"
API_SERVICE_ACCOUNT="tts-api-sa"
WORKER_SERVICE_ACCOUNT="tts-worker-sa"
AUDIO_BUCKET="${PROJECT_ID}-tts-audio"

echo "Deploying TTS Platform to GCP Project: $PROJECT_ID, Region: $REGION"

# Enable required APIs
echo "Enabling required APIs..."
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  redis.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  vpcaccess.googleapis.com \
  --project=$PROJECT_ID

# Create Cloud SQL instance
echo "Creating Cloud SQL instance..."
gcloud sql instances create $INSTANCE_NAME \
  --project=$PROJECT_ID \
  --region=$REGION \
  --database-version=POSTGRES_17 \
  --tier=db-f1-micro \
  --storage-size=10GB \
  --storage-auto-increase \
  --backup-start-time=02:00 \
  --no-assign-ip \
  --network=default \
  || echo "Cloud SQL instance already exists"

# Create database
echo "Creating database..."
gcloud sql databases create wspeech \
  --instance=$INSTANCE_NAME \
  --project=$PROJECT_ID \
  || echo "Database already exists"

# Create VPC Access Connector
echo "Creating VPC Access Connector..."
gcloud compute networks vpc-access connectors create $CONNECTOR_NAME \
  --project=$PROJECT_ID \
  --region=$REGION \
  --network=default \
  --range=10.8.0.0/28 \
  || echo "VPC Access Connector already exists"

# Create service accounts
echo "Creating service accounts..."
gcloud iam service-accounts create $API_SERVICE_ACCOUNT \
  --display-name="TTS API Service Account" \
  --project=$PROJECT_ID \
  || echo "API service account already exists"

gcloud iam service-accounts create $WORKER_SERVICE_ACCOUNT \
  --display-name="TTS Worker Service Account" \
  --project=$PROJECT_ID \
  || echo "Worker service account already exists"

# Grant IAM roles
echo "Granting IAM roles..."
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${API_SERVICE_ACCOUNT}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${API_SERVICE_ACCOUNT}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${API_SERVICE_ACCOUNT}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${WORKER_SERVICE_ACCOUNT}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${WORKER_SERVICE_ACCOUNT}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${WORKER_SERVICE_ACCOUNT}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"

# Create Cloud Storage bucket
echo "Creating Cloud Storage bucket..."
gsutil mb -p $PROJECT_ID -l $REGION gs://$AUDIO_BUCKET/ \
  || echo "Storage bucket already exists"

# Create secrets
echo "Creating secrets..."
echo -n "postgres://wspeech:$(openssl rand -hex 16)@//cloudsql/${PROJECT_ID}:${REGION}:${INSTANCE_NAME}/wspeech" | \
  gcloud secrets create database-url --data-file=- --project=$PROJECT_ID \
  || echo "Secret database-url already exists"

echo -n "rediss://:$(openssl rand -hex 16)@//cloudsql/${PROJECT_ID}:${REGION}:${INSTANCE_NAME}/wspeech" | \
  gcloud secrets create redis-url --data-file=- --project=$PROJECT_ID \
  || echo "Secret redis-url already exists"

echo -n "$(openssl rand -hex 32)" | \
  gcloud secrets create jwt-secret --data-file=- --project=$PROJECT_ID \
  || echo "Secret jwt-secret already exists"

echo -n "sk_test_$(openssl rand -hex 24)" | \
  gcloud secrets create stripe-secret-key --data-file=- --project=$PROJECT_ID \
  || echo "Secret stripe-secret-key already exists"

echo -n "whsec_$(openssl rand -hex 24)" | \
  gcloud secrets create stripe-webhook-secret --data-file=- --project=$PROJECT_ID \
  || echo "Secret stripe-webhook-secret already exists"

echo "GCP infrastructure setup complete!"
echo ""
echo "Next steps:"
echo "1. Set up Cloud SQL Auth Proxy for local development"
echo "2. Deploy API: gcloud run services deploy tts-api --source ./docker --region $REGION"
echo "3. Deploy Worker: gcloud run services deploy tts-worker --source ./docker --region $REGION"
echo "4. Configure Stripe webhook endpoint: https://tts-api-<hash>-$REGION.run.app/v1/billing/webhook"
