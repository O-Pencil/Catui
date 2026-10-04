# Security Policy

## Supported Versions

We release patches for security vulnerabilities for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability within Catui, please report it responsibly.

### How to Report

**Please DO NOT report security vulnerabilities through public GitHub issues.**

Instead, please report them through one of the following methods:

1. **GitHub Private Vulnerability Reporting** (Recommended)
   - Go to the [Security tab](https://github.com/O-Pencil/Catui/security/advisories/new) of the repository
   - Click "Report a vulnerability"
   - Fill out the vulnerability reporting form

2. **Email** (if GitHub private reporting is unavailable)
   - Send an email to `security@o-pencil.org` with:
     - Description of the vulnerability
     - Steps to reproduce
     - Potential impact
     - Any suggested fixes (if applicable)

### What to Include

A good vulnerability report should include:

- Type of vulnerability (e.g., SQL injection, XSS, etc.)
- Full paths of source file(s) related to the vulnerability
- Location of the affected source code (tag/branch/commit or direct link)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce
- Proof-of-concept or exploit code (if possible)
- Impact assessment: how this vulnerability could be exploited

## Response Timeline

We aim to respond to vulnerability reports within:

- **Initial response**: 24-48 hours
- **Assessment and timeline**: 3-5 business days
- **Patch availability**: Depending on severity, patches may be released in:
  - Critical: 7 days
  - High: 14 days
  - Medium: 30 days
  - Low: Next scheduled release

## Disclosure Policy

We follow a **coordinated disclosure** process:

1. Reporter submits vulnerability details
2. We confirm receipt and begin investigation
3. We develop and test a fix
4. We coordinate disclosure with reporter
5. We release the patch and publicly disclose

## Security Best Practices for Users

When using Catui:

- Never commit API keys or credentials to version control
- Use environment variables for sensitive configuration
- Keep your installation updated
- Review the permissions granted to Catui

## Security Updates

Security updates will be announced through:

- GitHub Security Advisories
- Release notes on GitHub Releases

Thank you for helping keep Catui and its users safe!
