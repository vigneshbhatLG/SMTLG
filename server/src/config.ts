import dotenv from "dotenv";
dotenv.config();

export const config = {
  port: process.env.PORT || 5000,
  jira: {
    clientId: process.env.JIRA_CLIENT_ID!,
    clientSecret: process.env.JIRA_CLIENT_SECRET!,
    redirectUri: process.env.JIRA_REDIRECT_URI!
  },
  mongoUri: process.env.MONGO_URI,
  teams: {
    webhookUrl: process.env.TEAMS_WEBHOOK_URL_INTERNAL || '',
    cronSchedule: process.env.TEAMS_CRON_SCHEDULE || '30 16 * * 1-5',
    reopenWebhookUrl: process.env.TEAMS_WEBHOOK_URL_INTERNAL || '',
    reopenCronSchedule: process.env.TEAMS_REOPEN_CRON_SCHEDULE || '0 9 * * 1-5',
    dueDateChangeWebhookUrl: process.env.TEAMS_WEBHOOK_URL_PLS || '',
    dueDateChangeCronSchedule: process.env.TEAMS_DUEDATE_CHANGE_CRON_SCHEDULE || '45 16 * * 1-5',
    parkedWebhookUrl: process.env.TEAMS_WEBHOOK_URL_PLS || '',
    parkedCronSchedule: process.env.TEAMS_PARKED_CRON_SCHEDULE || '0 10 * * 1-5',
  },
  email: {
    host: process.env.SMTP_HOST || 'lgekrhqmh01.lge.com',
    port: Number(process.env.SMTP_PORT) || 25,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'sprint-analytics@lge.com',
    managerEmail: process.env.MANAGER_EMAIL || 'prakash.n@lge.com',
    cronSchedule: process.env.EMAIL_CRON_SCHEDULE || '0 8 * * 3',
    mailtrapToken: process.env.MAILTRAP_TOKEN || 'df2eb2603201e0af692addf6dfe0ac8b',
  }
};
