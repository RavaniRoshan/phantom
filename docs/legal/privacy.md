# Privacy notice (beta)

**Last updated:** 2026-11-18

## What stays on your device
- Run history, step logs, screenshots and artifacts are stored locally under
  `~/.phantom/` by default. Phantom does not upload them to us.
- API keys are stored in Windows Credential Manager, one encrypted blob; they
  are never written to `config.toml`, logs, or support bundles.

## What leaves your device
- Task text, current screen text and screenshots are sent **only** to the model
  provider you choose, using your own API key (BYOK). We do not operate a model
  proxy. Review that provider's data policy before use.
- Gemini free tier states submitted content may be used to improve its products.
  The app asks for explicit consent before enabling a free-tier key; paid tiers
  are not used for product improvement.
- Optional, opt-in telemetry contains counters (task counts, latency, errors)
  and never screenshots or prompt text.

## Screenshots and sensitive data
A screenshot can capture anything visible in the VM, including personal or
special-category data (GDPR Art. 9). Configure the VM with only the apps needed
for the task, review screenshots before sharing, and use the retention setting
(History → delete after N days / delete all).

## Your choices
- Privacy → screenshot capture on/off, retention period, delete-all.
- Telemetry opt-in (off by default).
- Provider choice and EEA paid-tier handling: in the EEA/CH/UK, use a paid-tier
  key when making the API client available to others; legal review is pending.

## Contact
Privacy questions: privacy@phantom.local (replace before public beta).
