export interface Env {
  DB: D1Database;
  ENVIRONMENT: 'development' | 'staging' | 'production';
  DRIVE_ROOT_FOLDER_ID: string;
  PUBLIC_ORIGIN: string;
  DRIVE_SERVICE_ACCOUNT_JSON: string;
  SESSION_HMAC_KEY: string;
  DATA_ENCRYPTION_KEY: string;
  ADMIN_BOOTSTRAP_HASH: string;
}
