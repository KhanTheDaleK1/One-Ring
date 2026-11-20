# Privacy Policy

**Effective as of November 20, 2026.**

One Ring ("One Ring," "we," "us," or "our") is a local-first, offline-capable desktop application for live production and worship operations. This Privacy Policy describes how personal information is handled in connection with One Ring. We do not operate a hosted cloud service, user accounts, or a telemetry backend.

**Index**

- Personal information we collect
- Tracking and other technologies
- How we use personal information
- Retention
- How we share personal information
- Your choices
- Other sites and services
- Security
- International data transfer
- Children
- Changes to this Privacy Policy
- How to contact us
- State privacy rights notice
- Notice to European users

## Personal information we collect

### Information stored locally on your device

One Ring runs on your own computer. The following information is created and stored locally on the operator machine and is not transmitted to us unless you choose to send a crash report (see below):

- Application settings, display assignments, layouts, cue stacks, scenes, and slide decks.
- User-supplied content you import or create, such as song libraries, slide archives, and local Bible files.
- User-supplied credentials and keys, including scripture API keys, AI endpoint keys, and stream keys (for example RTMP/RTMPS/WHIP/SRT destination credentials). These are stored locally with restrictive file permissions and are not included in crash reports.
- Engineer Mode PIN, stored as a salted hash in local application data.
- Local diagnostic logs, which remain on the device.

We do not have access to any of the above unless you voluntarily transmit it to us.

### Information you provide to us

We do not require account registration. We may receive personal information if you:

- Contact us through the project's issue tracker or security reporting channel.
- Submit an opt-in crash report.
- Participate in community discussions or feedback channels you choose to use.

### Automatic data collection

One Ring performs no background telemetry, analytics, advertising, or tracking. The application does not collect device identifiers, usage analytics, or location data in the background.

Network requests occur only when you explicitly trigger them (see "Optional outbound network requests" below). In those cases, the receiving service may log standard request metadata (such as IP address and user agent) under its own privacy policy.

### Optional outbound network requests (operator-initiated)

One Ring makes outbound HTTPS requests only at your explicit request, including:

1. Online lyric index searches, when you search for lyrics.
2. Open-license scripture lookups, when you request a passage from an open scripture API.
3. User-configured scripture providers, when you connect a Crossway ESV API or API.Bible key and request a passage.
4. User-configured AI providers, when you submit a prompt to an AI endpoint you configure.
5. Release and update checks, when you check for updates, which request release metadata over HTTPS.

For items 2 through 4, your request content (for example a scripture reference or prompt text) and any API key you configure are sent to the provider you selected. Those providers are independent third parties; their privacy practices govern that data.

### Crash reports (opt-in)

One Ring includes an optional crash reporter. It is disabled unless you opt in. When enabled and a crash occurs, a sanitized report may be relayed to the project's issue tracker. Sanitization strips personal information, IP addresses, file system paths, and secrets before transmission. Reports include non-identifying diagnostic data such as application version, operating system version, and a stack trace. You can disable crash reporting at any time in Settings.

### Data about others

One Ring does not collect contact details about your friends or contacts.

## Tracking and other technologies

One Ring does not use cookies, web beacons, pixels, or similar tracking technologies for analytics or advertising. The desktop application stores local configuration and cache data on your device to operate offline; this is not tracking.

## How we use personal information

We use personal information only for the following purposes:

- Operating and improving One Ring, including diagnosing crashes you choose to report.
- Responding to support requests or security reports you submit.
- Complying with applicable law and protecting rights, safety, and security.
- Creating aggregated, de-identified data from crash reports for diagnostic purposes. We do not attempt to reidentify such data.

We do not use personal information for marketing, advertising, profiling, or automated decision-making.

## Retention

Personal information you send to us (such as crash reports or support messages) is retained only as long as necessary to fulfill the purpose for which it was collected, including resolving the reported issue and complying with legal obligations. Locally stored data remains on your device until you delete it or uninstall the application.

## How we share personal information

We do not sell personal information. We do not share personal information for cross-context behavioral advertising. We may share personal information in the following limited circumstances:

- Crash reports you opt into are relayed to the project's issue tracker, where they may be visible to maintainers and, depending on the tracker, the public.
- With service providers that help operate the crash-report relay or issue tracker, under appropriate safeguards.
- With professional advisors or authorities when required by law or to protect rights and safety.
- In connection with a merger, acquisition, or asset sale, with notice where feasible.

We do not sell or share personal information within the meaning of state privacy laws.

## Your choices

- Opt out of crash reporting at any time in Settings.
- Do not configure optional online providers if you prefer fully offline operation; core functionality works without network access.
- Delete local data by removing the application's local data directory or uninstalling.
- Decline to provide optional information; required fields are marked where applicable.

## Other sites and services

One Ring may link to or integrate with third-party websites or services that you configure. We do not control those services and are not responsible for their practices. Please read their privacy policies. Examples include scripture providers, AI providers, and lyric index services.

## Security

We employ technical and organizational safeguards designed to protect personal information, including restrictive local file permissions, local-only credential storage, and sanitization of crash reports. However, no system is perfectly secure. See SECURITY.md for details.

## International data transfer

One Ring is developed by contributors who may be located in various countries. If you opt into crash reporting, your report may be transferred to and processed in countries where the issue tracker or relay operates, which may have different privacy protections than your country.

## Children

One Ring is not directed to children under 13 (or 16 where applicable). We do not knowingly collect personal information from children. If you believe a child has provided personal information to us, please contact us and we will delete it.

## Changes to this Privacy Policy

We may update this Privacy Policy from time to time. Material changes will be indicated by updating the effective date and posting the revised policy. Your continued use of One Ring after changes indicates acceptance.

## How to contact us

Questions about this Privacy Policy or privacy rights may be submitted through the project's issue tracker or security reporting channel on its code hosting platform. We do not collect or require personal contact information to use One Ring.

## State privacy rights notice

This section applies to residents of U.S. states with applicable consumer privacy laws.

Your privacy rights may include the right to know, access, correct, and delete personal information we hold about you, and to opt out of the sale or sharing of personal information. We do not sell or share personal information. We do not process personal information for targeted advertising or profiling that produces legal or similarly significant effects. We do not intentionally collect sensitive personal information.

To exercise rights, submit a request through the project's issue tracker or security reporting channel. We may need to verify your identity. Authorized agents may submit requests with appropriate documentation.

We do not discriminate against you for exercising your rights.

Information practices: We collect personal information from the sources and for the purposes described above. Retention criteria are described in the Retention section. We do not attempt to reidentify deidentified information.

Personal information we collect, use, and disclose:

- Categories: locally stored settings and content (device-held, not transmitted); opt-in crash reports (diagnostic data).
- Purposes: service operation, crash diagnosis, support, compliance.
- Disclosure: crash reports to issue tracker (opt-in); otherwise none.
- Sale and share: none.

California residents may also contact the Complaint Assistance Unit of the Division of Consumer Services of the California Department of Consumer Affairs. Nevada residents may contact us to opt out of sale of covered information (we do not sell). Texas residents: we do not sell sensitive personal data.

## Notice to European users

This section applies to individuals in the European Economic Area and the United Kingdom.

Personal information means personal data as defined under the GDPR. The maintainers of One Ring act as controller for personal information we process (such as crash reports and support communications).

Legal bases:

- Crash reporting: your consent (opt-in).
- Security and compliance: legal obligation and legitimate interests.
- Support: legitimate interests.

Your rights include access, correction, deletion, portability, restriction, objection, and withdrawal of consent. Submit requests through the project's issue tracker. You may lodge a complaint with your supervisory authority.

Data may be processed outside Europe, including in countries without an adequacy decision, in connection with crash reporting and issue tracking. We rely on appropriate safeguards where required.

We do not engage in automated decision-making or profiling that produces legal or similarly significant effects.

No sensitive personal information is intentionally collected. Please do not submit sensitive personal information through crash reports or support channels.
