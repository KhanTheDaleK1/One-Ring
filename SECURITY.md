# Security Policy

## Supported versions

One Ring is currently in alpha (0.3.x). Security fixes are provided for the latest release. Older versions may not receive fixes.

## Reporting a vulnerability

Please report suspected vulnerabilities through GitHub Security Advisories on the project's repository. Do not open public issues for undisclosed vulnerabilities.

When reporting, include:

- A description of the issue and its impact.
- Steps to reproduce or a proof of concept.
- Affected version(s) and platform.
- Any suggested mitigation.

We aim to acknowledge reports within 7 days and provide a fix or mitigation timeline. We appreciate coordinated disclosure and will credit reporters who wish to be named (no personal information will be published without consent).

## Security architecture

### Local-only credential storage

- API keys, stream keys, and other secrets are stored locally on the operator machine with restrictive file permissions (0600 files, 0700 directories).
- Secrets are never stored in browser localStorage or transmitted in crash reports.
- Engineer Mode PIN is stored as a salted hash and verified using constant-time comparison.

### Engineer Mode PIN

- Destructive and routing changes are gated behind a PIN-locked Engineer Mode.
- The PIN gate is enforced in the native (Rust) layer, not only in the UI.
- First-run setup requires choosing a PIN.

### LAN-only hardware control protocols

- Hardware control (audio console control, video switcher commands, camera control, IP video routing) operates over the local network only.
- Discovery uses local multicast; control channels bind to local interfaces.
- No hardware control traffic is routed over the public internet by the Software.
- Operators should keep production control networks segmented and firewalled from untrusted networks.

### Sanitized crash reporting

- Crash reporting is opt-in.
- Reports are scrubbed to remove personal information, IP addresses, file system paths, and secrets before transmission.
- Reports contain only non-identifying diagnostic data (version, OS version, stack trace).

### Application hardening

- Restrictive content security policy; http(s)-only sandboxed browser sources.
- Bounded protocol parsers to reduce attack surface.
- Validated import of slide archives and local files, including path and symlink screening.
- Console-free background subprocess execution on Windows.

## Operator hardening recommendations

- Choose a strong, unique Engineer Mode PIN; change it if compromised.
- Keep the production machine and control network off the public internet; use a firewall.
- Verify installer checksums; alpha builds are unsigned.
- Review configured third-party providers and their terms.
- Disable crash reporting if your environment requires it.
- Keep the Software updated.

## Out of scope

- Vulnerabilities in third-party services you configure.
- Issues requiring physical access to an unlocked machine.
- Social engineering.
- Denial of service against local-only services by local users.

## Safe harbor

We will not pursue legal action against researchers who report in good faith, avoid privacy violations and service disruption, and follow coordinated disclosure. Testing must be confined to systems you own or have permission to test.
