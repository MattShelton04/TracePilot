# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in TracePilot, please report it responsibly by following these steps:

1. **Do not open a public issue** — public disclosure of security vulnerabilities can put users at risk.

2. **Report privately** — Contact the maintainer directly via:
   - Email: [Create a private security advisory](https://github.com/MattShelton04/TracePilot/security/advisories/new) on GitHub
   - Or open a private discussion in the repository's Security tab

3. **Include details** — Help us understand and fix the issue by providing:
   - A clear description of the vulnerability
   - Steps to reproduce the issue
   - Potential impact and severity assessment
   - Any suggested fixes (if applicable)

## Security Response Process

When a security vulnerability is reported:

1. We will acknowledge receipt of your report within 48 hours
2. We will investigate and assess the severity of the issue
3. We will work on a fix and determine an appropriate disclosure timeline
4. We will release a patch and security advisory once the fix is ready
5. We will credit the reporter (if desired) in the security advisory

## Supported Versions

As TracePilot is in early development:

- Only the **latest release** receives security updates
- Older versions are not supported
- We recommend always running the most recent version

## Security Considerations

TracePilot is a **local-first application** that:

- Stores all data locally on your machine
- Does not transmit session data to external servers
- Accesses the file system to read Claude Code session logs
- Executes local SQLite queries for indexing and search

### Potential Security Concerns

Users should be aware that:

1. **File System Access**: TracePilot requires read access to your Claude Code sessions directory
2. **Local Database**: Session data is indexed in a local SQLite database
3. **Code Content**: Session transcripts may contain sensitive code, credentials, or API keys
4. **No Encryption**: Local database files are not encrypted at rest

### Security Best Practices

To use TracePilot securely:

- Keep TracePilot updated to the latest version
- Store session data on encrypted volumes when possible
- Review session data before sharing screenshots or exports
- Be cautious about indexing sessions containing credentials or secrets
- Use OS-level permissions to restrict access to the TracePilot data directory

## Known Security Limitations

As documented in the security audit report:

1. **No Input Sanitization**: Search queries are passed directly to SQLite FTS5 without sanitization (acceptable for local-only use)
2. **No Session Encryption**: Session data is stored in plaintext SQLite databases
3. **File System Assumptions**: Trust is placed in the integrity of session log files

These are considered acceptable tradeoffs for a local-first developer tool with no network exposure.

## Questions?

If you have questions about security but not a vulnerability to report, feel free to open a public discussion or issue.

Thank you for helping keep TracePilot secure!
