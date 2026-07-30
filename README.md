# Star Cineplex ticket monitor

This GitHub Actions project checks every listed Star Cineplex theatre every ten
minutes. It sends one Discord notification when **2 August 2026** becomes
available, then records that the notification was sent to avoid repeated alerts.

## Set up

1. Create an empty GitHub repository.
2. Upload all files and folders from this project to the repository root.
3. In Discord, open the target channel's settings, then **Integrations →
   Webhooks → New Webhook → Copy Webhook URL**.
4. In the GitHub repository, open **Settings → Secrets and variables →
   Actions → New repository secret**.
5. Name the secret `DISCORD_WEBHOOK_URL` and paste the Discord webhook URL as
   its value.
6. Open the repository's **Actions** tab, choose **Check Cineplex tickets**,
   and click **Run workflow** once to test it.

The scheduled workflow then runs automatically. GitHub schedules can sometimes
start a few minutes late.

## Important notes

- Never place the Discord webhook URL directly in a file or commit.
- The monitor checks the date labels shown after guest login; it does not buy,
  reserve, or select tickets.
- Cineplex may change its website. If all locations begin failing, inspect the
  latest GitHub Actions run log.
- To receive another alert after the first notification, change the cache key
  `cineplex-2-aug-2026-alerted-v1` in
  `.github/workflows/check-tickets.yml`.
# cineplex-discord-monitor
