# Security policy

## Supported versions

| Version | Supported |
|---|---|
| 1.x (latest release and the `main` branch / hosted site) | Yes |
| Older versions | No |

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

- Use GitHub's private reporting: **Security → Advisories → Report a vulnerability**
  (<https://github.com/adam1442/kekenik-vfx/security/advisories/new>), or
- email **hossein.r.1442@gmail.com** with the subject "Kekenik VFX security".

Include a description, steps to reproduce, the browser and version, and the potential impact. You will get an acknowledgement within
about a week, and we will keep you informed while a fix is prepared. Please allow reasonable time for a fix before public disclosure.

## Scope

Kekenik VFX is a static, client-side application. Relevant issues include cross-site scripting through project or asset files, unsafe
parsing of imported files (images, models, projects), and supply-chain problems in dependencies or workflows. The application sends no
data to any server, so reports about server-side components do not apply.
